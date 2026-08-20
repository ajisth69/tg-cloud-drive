/* ═══════════════════════════════════════════════════════════════════════════
   PhotoViewer — gallery viewer with spring physics (60/120 fps in WebView)
   ─────────────────────────────────────────────────────────────────────────────
   Stack: React + TypeScript, inline styles (no animation libraries).
   The spring physics are 100% custom (rAF + analytic solution of the
   critically damped oscillator): zero dependencies, zero jank.

   PERFORMANCE CONTRACTS (WebView):
   1. Zero React re-renders during gestures and springs: all motion state
      lives in REFS and is written directly onto `style.transform`
      (translate3d/scale → compositor/GPU) inside a SINGLE rAF call.
   2. `touch-action: none` on the container: the WebView does not compete
      with the gesture and the device does not steal the touch (no native
      scroll/zoom).
   3. Active elements carry `will-change: transform` → own layer on the
      compositor; layouts are never read inside the motion loop (metrics
      are captured once when each gesture starts).

   GESTURE STATE MACHINE (interlocking — requirement 3):
   ─────────────────────────────────────────────────────────────────────────────
       touchstart (1 finger)
              │
              ▼
        ┌ "pending" ─────────────────────────────┐
        │        │                               │
        │  zoom > 1                              │  zoom == 1
        │        │                               │
        │        ▼                               ▼
        │   "pan" (free panning)      |dx|>10 and |dx|>1.3·|dy|?
        │        │                          │              │
        │        │ touches the edge          ├─► "page"    │ (vertical → cancels)
        │        │  and keeps pushing?       │  (carousel) │
        │        └──► "page" (edge-release)  │             │
        │             (transfers momentum)   │             │
        │                                    │             │
        └── 2nd finger ──► "pinch" ──► on releasing a finger ──► "pan"

   INTERLOCK RULE (zoom > 1): horizontal swipe NEVER pages while there is
   room to pan; only when pan is locked at the edge does the drag excess
   (with its velocity) transfer to the carousel.

   PHYSICS:
   · Critically damped spring (ω = SPRING_OMEGA): analytic solution
     x(t) = (x0 + (v0 + ω·x0)·t)·e^(−ω·t) → no overshoot, no numerical
     instability, settles in ~350 ms. The launch velocity (fling/edge-
     release) is injected as v0.
   · Exponential rubber-banding: beyond the bounds resistance grows
     exponentially (asymptote), and on release the spring returns to the bound.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/* ─────────────── Physics constants (tunable) ─────────────── */
const MAX_ZOOM = 4; // hard maximum zoom
const MIN_ZOOM = 1; // minimum zoom (fit scale)
const DOUBLE_TAP_ZOOM = 2.5; // double-tap zoom
const SPRING_OMEGA = 14; // natural frequency (critically damped)
const SPRING_SETTLE_PX = 0.5; // position ε to declare "settled"
const SPRING_SETTLE_V = 0.02; // velocity ε (px/ms)
const PAGE_VELOCITY_THRESHOLD = 0.35; // px/ms — minimum fling to page
const PAGE_DISTANCE_FRACTION = 0.25; // 25% of the dragged width to page
const PAGE_EDGE_RESIST = 0.3; // resistance when dragging past the edges
const DIRECTION_THRESHOLD = 10; // px to resolve the gesture direction
const DIRECTION_SLANT = 1.3; // |dx| must exceed 1.3·|dy| to be horizontal
const EDGE_ENGAGE_PX = 8; // minimum excess over the edge for edge-release
const RUBBER_SCALE_LIMIT = 0.4; // rubber asymptote in scale (sub-zoom)
const RUBBER_SCALE_MAX_LIMIT = 0.8; // rubber asymptote above MAX_ZOOM
const VEL_EMA = 0.7; // velocity smoothing factor (moving average)
const TAP_MAX_MOVE = 10; // max px to count as a tap
const TAP_MAX_MS = 300; // max duration of a tap
const DOUBLE_TAP_MAX_MS = 300; // window between taps
const DOUBLE_TAP_MAX_DIST = 40; // spread between taps

/* ─────────────── Types ─────────────── */
interface Photo {
  id: string;
  src: string;
  kind?: "image" | "other";
}

type Phase = "idle" | "pending" | "pan" | "pinch" | "page";
type SpringKey = "dragX" | "scale" | "x" | "y";

interface Spring {
  x: number; // current position
  v: number; // current velocity (px/ms)
  target: number;
  active: boolean;
}

interface PhotoViewerProps {
  photos: Photo[];
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  onTap?: () => void;
  className?: string;
}

/* ─────────────── Math ─────────────── */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Exponential rubber-band: applies progressive resistance to the excess.
 * The "resisted" drag tends asymptotically toward `limit` without reaching it.
 *   resisted = sign(excess) · limit · (1 − e^(−|excess|/limit))
 */
function rubberBand(excess: number, limit: number): number {
  const l = Math.max(limit, 1e-3);
  return Math.sign(excess) * l * (1 - Math.exp(-Math.abs(excess) / l));
}

/** Clamp + rubber: passes freely inside the bound; outside, exponential resistance. */
function clampWithRubber(v: number, bound: number, rubberLimit: number): number {
  if (Math.abs(v) <= bound) return v;
  const clamped = clamp(v, -bound, bound);
  return clamped + rubberBand(v - clamped, rubberLimit);
}

/** Pan bounds for a given zoom (image margin over the viewport). */
function panBounds(iw: number, ih: number, cw: number, ch: number, scale: number) {
  return {
    maxX: Math.max(0, (iw * scale - cw) / 2),
    maxY: Math.max(0, (ih * scale - ch) / 2),
  };
}

/**
 * CRITICALLY DAMPED SPRING STEP (exact analytic solution):
 *   a = −ω²·(x − target) − 2ω·v
 *   x(t) = target + (x0 + (v0 + ω·x0)·t)·e^(−ω·t)
 *   v(t) = (v0 − ω·(v0 + ω·x0)·t)·e^(−ω·t)
 * where x0/v0 are the position/velocity RELATIVE to the target.
 * Returns `false` when it converges (settled).
 */
function stepSpring(s: Spring, dt: number): boolean {
  const x0 = s.x - s.target;
  const v0 = s.v;
  const t = dt;
  const decay = Math.exp(-SPRING_OMEGA * t);
  s.x = s.target + (x0 + (v0 + SPRING_OMEGA * x0) * t) * decay;
  s.v = (v0 - SPRING_OMEGA * (v0 + SPRING_OMEGA * x0) * t) * decay;
  return Math.abs(s.x - s.target) > SPRING_SETTLE_PX || Math.abs(s.v) > SPRING_SETTLE_V;
}

/** Focal pinch anchoring: the initial midpoint stays fixed under the fingers. */
function anchoredPan(
  start: { midX: number; midY: number; pan: { x: number; y: number }; scale: number },
  midX: number,
  midY: number,
  nextScale: number,
  cw: number,
  ch: number
) {
  const cx = cw / 2;
  const cy = ch / 2;
  const qx = start.midX - cx - start.pan.x; // distance to center in image space
  const qy = start.midY - cy - start.pan.y;
  return {
    x: midX - cx - (qx / start.scale) * nextScale,
    y: midY - cy - (qy / start.scale) * nextScale,
  };
}

/* ─────────────────────────── COMPONENT ─────────────────────────── */
export default function PhotoViewer({ photos, initialIndex = 0, onIndexChange, onTap, className }: PhotoViewerProps) {
  /* React state: ONLY what changes between gestures. Motion does not go through here. */
  const [index, setIndex] = useState(() => clamp(initialIndex, 0, Math.max(0, photos.length - 1)));
  const indexRef = useRef(index);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle"); // only for will-change/UI

  /* ── Motion state: 100% in refs (zero re-renders) ── */
  const draftRef = useRef({ scale: 1, x: 0, y: 0, dragX: 0 });
  const springsRef = useRef<Record<SpringKey, Spring>>({
    dragX: { x: 0, v: 0, target: 0, active: false },
    scale: { x: 1, v: 0, target: 1, active: false },
    x: { x: 0, v: 0, target: 0, active: false },
    y: { x: 0, v: 0, target: 0, active: false },
  });
  const phaseRef = useRef<Phase>("idle");
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);

  /* Metrics and elements (captured at the start of each gesture, never in the loop). */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const metricsRef = useRef({ cw: 0, ch: 0, iw: 0, ih: 0 });
  const widthRef = useRef(0);
  const slideElsRef = useRef(new Map<string, HTMLDivElement>());
  const slideOffsetRef = useRef(new Map<string, number>());

  /* Gesture baselines. */
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; pan0: { x: number; y: number } } | null>(null);
  const pinchStartRef = useRef<{
    dist: number; scale: number; midX: number; midY: number;
    pan: { x: number; y: number }; cw: number; ch: number; iw: number; ih: number;
  } | null>(null);
  const pageStartRef = useRef<{ x: number; dragX0: number } | null>(null);
  const tapRef = useRef<{ x: number; y: number; t: number } | null>(null);

  /* Velocity (px/ms) smoothed by exponential moving average. */
  const velRef = useRef({ vx: 0, vy: 0, lastX: 0, lastY: 0, lastT: 0 });
  /* Pinch scale velocity (to inject momentum into the spring). */
  const scaleVelRef = useRef({ vs: 0, lastDist: 0, lastT: 0 });

  /* ─────────── Style application (single DOM write gate) ─────────── */

  const apply = useCallback(() => {
    const d = draftRef.current;
    const img = imgRef.current;
    if (img) {
      img.style.transform = `translate3d(${d.x}px, ${d.y}px, 0) scale(${d.scale})`;
    }
    const w = widthRef.current || 1;
    slideElsRef.current.forEach((el, id) => {
      const offset = slideOffsetRef.current.get(id) ?? 0;
      el.style.transform = `translate3d(${offset * w + d.dragX}px, 0, 0)`;
    });
  }, []);

  /* ─────────── Spring engine (single rAF loop) ─────────── */

  /* Page change commit: new index, transform reset (zoom 1). */
  const commitIndex = useCallback(
    (dir: 1 | -1) => {
      const prev = indexRef.current;
      const next = clamp(prev + dir, 0, Math.max(0, photos.length - 1));
      if (next === prev) return;
      indexRef.current = next;
      setIndex(next);
      draftRef.current = { scale: 1, x: 0, y: 0, dragX: 0 };
      setImageLoaded(false);
      onIndexChange?.(next);
    },
    [onIndexChange, photos.length]
  );

  const tick = useCallback(
    (now: number) => {
      const dt = clamp((now - lastFrameRef.current) / 1000, 0.001, 0.05);
      lastFrameRef.current = now;
      const springs = springsRef.current;
      let anyActive = false;

      for (const key of ["dragX", "scale", "x", "y"] as SpringKey[]) {
        const s = springs[key];
        if (!s.active) continue;
        if (stepSpring(s, dt)) {
          anyActive = true;
        } else {
          s.active = false;
        }
      }

      /* When the scale spring converges, the pan bounds change:
         re-clamps x/y with springs if they ended up outside the new bounds. */
      if (!springs.scale.active) {
        const b = panBounds(metricsRef.current.iw, metricsRef.current.ih, metricsRef.current.cw, metricsRef.current.ch, draftRef.current.scale);
        for (const key of ["x", "y"] as const) {
          const s = springs[key];
          if (!s.active) continue;
          const bound = key === "x" ? b.maxX : b.maxY;
          const clamped = clamp(s.target, -bound, bound);
          if (Math.abs(s.target - clamped) > SPRING_SETTLE_PX) {
            s.target = clamped;
            anyActive = true;
          }
        }
      }

      /* Syncs the draft with the spring position (mirror for the render). */
      if (springs.dragX.active) draftRef.current.dragX = springs.dragX.x;
      if (springs.scale.active) draftRef.current.scale = springs.scale.x;
      if (springs.x.active) draftRef.current.x = springs.x.x;
      if (springs.y.active) draftRef.current.y = springs.y.x;

      apply();

      if (anyActive) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        /* End of the page spring: decides the index commit. */
        if (springs.dragX.x !== 0) {
          const dir: 1 | -1 = springs.dragX.x > 0 ? -1 : 1;
          springs.dragX.x = 0;
          commitIndex(dir);
        }
      }
    },
    [apply, commitIndex]
  );

  /** Starts a spring from (position, velocity) toward target. */
  const startSpring = useCallback((key: SpringKey, from: number, velocity: number, target: number) => {
    const s = springsRef.current[key];
    s.x = from;
    s.v = velocity;
    s.target = target;
    s.active = true;
    if (rafRef.current === null) {
      lastFrameRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  /** Cancels all springs (when starting a gesture). */
  const stopSprings = useCallback(() => {
    for (const key of Object.keys(springsRef.current) as SpringKey[]) {
      springsRef.current[key].active = false;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /* ═══════════════ VELOCITY TRACKING (for flings and momentum) ═══════════════ */

  const trackVelocity = useCallback((clientX: number, clientY: number) => {
    const v = velRef.current;
    const now = performance.now();
    const dt = now - v.lastT;
    if (dt > 0 && v.lastT !== 0) {
      const instX = (clientX - v.lastX) / dt;
      const instY = (clientY - v.lastY) / dt;
      v.vx = v.vx === 0 ? instX : v.vx * VEL_EMA + instX * (1 - VEL_EMA);
      v.vy = v.vy === 0 ? instY : v.vy * VEL_EMA + instY * (1 - VEL_EMA);
    }
    v.lastX = clientX;
    v.lastY = clientY;
    v.lastT = now;
  }, []);

  const trackScaleVelocity = useCallback((dist: number) => {
    const sv = scaleVelRef.current;
    const now = performance.now();
    const dt = now - sv.lastT;
    if (dt > 0 && sv.lastT !== 0) {
      const inst = (dist - sv.lastDist) / dt;
      sv.vs = sv.vs === 0 ? inst : sv.vs * VEL_EMA + inst * (1 - VEL_EMA);
    }
    sv.lastDist = dist;
    sv.lastT = now;
  }, []);

  const resetVelocity = useCallback(() => {
    velRef.current = { vx: 0, vy: 0, lastX: 0, lastY: 0, lastT: 0 };
    scaleVelRef.current = { vs: 0, lastDist: 0, lastT: 0 };
  }, []);

  /* ═══════════════ DOUBLE TAP → FOCAL ZOOM (with spring) ═══════════════ */
  const zoomAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const m = metricsRef.current;
      const midX = clientX - rect.left;
      const midY = clientY - rect.top;
      const d = draftRef.current;

      if (d.scale > 1) {
        /* Already zoomed in → return to identity. */
        startSpring("scale", d.scale, 0, 1);
        startSpring("x", d.x, 0, 0);
        startSpring("y", d.y, 0, 0);
        return;
      }
      /* Focal zoom: anchors the touched point (equivalent to a pinch from scale 1). */
      const { x, y } = anchoredPan(
        { midX, midY, pan: { x: 0, y: 0 }, scale: 1 },
        midX, midY, DOUBLE_TAP_ZOOM, m.cw, m.ch
      );
      const b = panBounds(m.iw, m.ih, m.cw, m.ch, DOUBLE_TAP_ZOOM);
      startSpring("scale", 1, 0, DOUBLE_TAP_ZOOM);
      startSpring("x", 0, 0, clamp(x, -b.maxX, b.maxX));
      startSpring("y", 0, 0, clamp(y, -b.maxY, b.maxY));
    },
    [startSpring]
  );

  /* ═══════════════════════ GESTURE INPUT (TouchEvents) ═══════════════════════ */

  const beginGesture = useCallback(() => {
    stopSprings();
    resetVelocity();
  }, [resetVelocity, stopSprings]);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  /* Starts PAN from a point (1 finger): baseline = current transform. */
  const startPan = useCallback(
    (clientX: number, clientY: number) => {
      panStartRef.current = { x: clientX, y: clientY, pan0: { x: draftRef.current.x, y: draftRef.current.y } };
      setPhaseBoth("pan");
    },
    [setPhaseBoth]
  );

  /* Starts PINCH (2 fingers): state snapshot for the focal anchoring. */
  const startPinch = useCallback(
    (e: React.TouchEvent) => {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const rect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      const m = metricsRef.current;
      pinchStartRef.current = {
        dist: Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY),
        scale: draftRef.current.scale,
        midX: (t0.clientX + t1.clientX) / 2 - rect.left,
        midY: (t0.clientY + t1.clientY) / 2 - rect.top,
        pan: { x: draftRef.current.x, y: draftRef.current.y },
        cw: m.cw,
        ch: m.ch,
        iw: m.iw,
        ih: m.ih,
      };
      setPhaseBoth("pinch");
    },
    [setPhaseBoth]
  );

  /* Starts PAGE from a horizontal drag (zoom 1) or the edge excess. */
  const startPage = useCallback(
    (clientX: number, dragX: number) => {
      pageStartRef.current = { x: clientX, dragX0: dragX };
      draftRef.current.dragX = dragX;
      setPhaseBoth("page");
      apply();
    },
    [apply, setPhaseBoth]
  );

  /* ── TouchStart ── */
  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if ((e.target as HTMLElement).closest?.("button, input, select, textarea, a")) return;
      e.stopPropagation();
      beginGesture();

      if (e.touches.length >= 2) {
        startPinch(e);
        return;
      }
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY, t: performance.now() };

      if (phaseRef.current === "pinch") {
        /* Remaining finger after a pinch → keeps panning from the current position. */
        startPan(t.clientX, t.clientY);
        return;
      }
      setPhaseBoth("pending");
      trackVelocity(t.clientX, t.clientY);
    },
    [beginGesture, setPhaseBoth, startPan, startPinch, trackVelocity]
  );

  /* ── TouchMove ── */
  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      const ph = phaseRef.current;
      if (ph === "pinch" && e.touches.length >= 2) {
        /* ── PINCH: focal zoom with rubber on scale and pan ── */
        const s = pinchStartRef.current;
        if (!s) return;
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
        if (dist === 0) return;
        trackScaleVelocity(dist);

        let next = s.scale * (dist / s.dist);
        /* Rubber on scale: below 1 or above MAX_ZOOM → exponential resistance. */
        if (next < MIN_ZOOM) next = MIN_ZOOM - rubberBand(MIN_ZOOM - next, RUBBER_SCALE_LIMIT);
        else if (next > MAX_ZOOM) next = MAX_ZOOM + rubberBand(next - MAX_ZOOM, RUBBER_SCALE_MAX_LIMIT);

        /* Focal anchoring: the fingers' midpoint stays fixed under the pinch. */
        const midX = (t0.clientX + t1.clientX) / 2 - (containerRef.current?.getBoundingClientRect().left ?? 0);
        const midY = (t0.clientY + t1.clientY) / 2 - (containerRef.current?.getBoundingClientRect().top ?? 0);
        const { x, y } = anchoredPan(s, midX, midY, next, s.cw, s.ch);

        /* Pan bounded for the new zoom (+ rubber at the edges). */
        const b = panBounds(s.iw, s.ih, s.cw, s.ch, next);
        draftRef.current.scale = next;
        draftRef.current.x = clampWithRubber(x, b.maxX, Math.max(b.maxX, 40));
        draftRef.current.y = clampWithRubber(y, b.maxY, Math.max(b.maxY, 40));
        apply();
        return;
      }

      if (ph === "pinch") return; // waiting for enough fingers to remain

      const t = e.touches[0];
      trackVelocity(t.clientX, t.clientY);

      if (ph === "pan") {
        /* ── PAN (zoom > 1): free movement with bounds ── */
        const s = panStartRef.current;
        if (!s) return;
        const z = draftRef.current.scale;
        const desiredX = s.pan0.x + (t.clientX - s.x);
        const desiredY = s.pan0.y + (t.clientY - s.y);
        const b = panBounds(metricsRef.current.iw, metricsRef.current.ih, metricsRef.current.cw, metricsRef.current.ch, z);
        const clampedX = clamp(desiredX, -b.maxX, b.maxX);
        draftRef.current.x = clampWithRubber(desiredX, b.maxX, Math.max(b.maxX, 40));
        draftRef.current.y = clampWithRubber(desiredY, b.maxY, Math.max(b.maxY, 40));
        apply();

        /* ── EDGE-RELEASE (requirement 3): when pan locks at the horizontal
           edge and the user keeps pushing, the excess (with its momentum)
           transfers to the carousel. ── */
        const excess = desiredX - clampedX;
        if (Math.abs(excess) >= EDGE_ENGAGE_PX) {
          startPage(t.clientX, excess);
        }
        return;
      }

      if (ph === "page") {
        /* ── PAGE: the track follows the finger (with rubber at the edges). ── */
        const s = pageStartRef.current;
        if (!s) return;
        let dragX = s.dragX0 + (t.clientX - s.x);
        const dir: 1 | -1 = dragX < 0 ? 1 : -1;
        const next = index + dir;
        const hasNeighbor = next >= 0 && next < photos.length;
        if (!hasNeighbor) dragX = s.dragX0 + (t.clientX - s.x) * PAGE_EDGE_RESIST;
        draftRef.current.dragX = dragX;
        apply();
        return;
      }

      if (ph === "pending") {
        /* ── DIRECTION RESOLUTION (interlocking) ── */
        const s = touchStartRef.current;
        if (!s) return;
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;

        /* KEY RULE: zoom > 1 → absolute priority to PANNING.
           Horizontal swipe only pages when zoom == 1. */
        if (draftRef.current.scale > 1) {
          startPan(t.clientX, t.clientY);
          return;
        }
        /* zoom == 1: the clearly horizontal drag goes to the carousel. */
        if (Math.abs(dx) > DIRECTION_THRESHOLD && Math.abs(dx) > Math.abs(dy) * DIRECTION_SLANT) {
          startPage(t.clientX, dx);
          return;
        }
        /* Vertical movement: the gesture is cancelled (possible scroll). */
        if (Math.abs(dy) > DIRECTION_THRESHOLD) {
          touchStartRef.current = null;
          setPhaseBoth("idle");
        }
      }
    },
    [apply, index, photos.length, setPhaseBoth, startPage, startPan, trackScaleVelocity, trackVelocity]
  );

  /* ── TouchEnd / TouchCancel ── */
  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      const ph = phaseRef.current;

      if (ph === "pinch" && e.touches.length >= 1) {
        /* One finger remaining → pan from the current position (with the pinch transform). */
        if (e.touches.length === 1) {
          const t = e.touches[0];
          startPan(t.clientX, t.clientY);
          trackVelocity(t.clientX, t.clientY);
        }
        return;
      }

      if (ph === "pinch") {
        /* END OF PINCH: spring back to the bounds (scale and pan). */
        setPhaseBoth("idle");
        const d = draftRef.current;
        if (d.scale < MIN_ZOOM) {
          startSpring("scale", d.scale, scaleVelRef.current.vs, MIN_ZOOM);
        } else if (d.scale > MAX_ZOOM) {
          startSpring("scale", d.scale, scaleVelRef.current.vs, MAX_ZOOM);
        }
        const b = panBounds(metricsRef.current.iw, metricsRef.current.ih, metricsRef.current.cw, metricsRef.current.ch, clamp(d.scale, MIN_ZOOM, MAX_ZOOM));
        if (Math.abs(d.x) > b.maxX) startSpring("x", d.x, velRef.current.vx, clamp(d.x, -b.maxX, b.maxX));
        if (Math.abs(d.y) > b.maxY) startSpring("y", d.y, velRef.current.vy, clamp(d.y, -b.maxY, b.maxY));
        pinchStartRef.current = null;
        return;
      }

      if (ph === "pan") {
        /* END OF PAN: if it ended in the rubber zone, the spring returns it to the bound. */
        setPhaseBoth("idle");
        const d = draftRef.current;
        const b = panBounds(metricsRef.current.iw, metricsRef.current.ih, metricsRef.current.cw, metricsRef.current.ch, d.scale);
        if (Math.abs(d.x) > b.maxX) startSpring("x", d.x, velRef.current.vx, clamp(d.x, -b.maxX, b.maxX));
        if (Math.abs(d.y) > b.maxY) startSpring("y", d.y, velRef.current.vy, clamp(d.y, -b.maxY, b.maxY));
        panStartRef.current = null;
        return;
      }

      if (ph === "page") {
        /* END OF PAGE: navigation decision with spring physics.
           - If |dragX| > 25% of the width, OR there is a fling (|v| > threshold
             and in the drag's direction) → spring to ∓width (photo exits).
           - Otherwise → spring back to 0 (elastic bounce-back).
           NOTE: the target slide sits at `-dir * w` (neighbor offset + dragX
           = dir·w + (-dir·w) = 0), so the spring goes to `-dir * w`. */
        setPhaseBoth("idle");
        const w = widthRef.current || 1;
        const dragX = draftRef.current.dragX;
        const vx = velRef.current.vx;
        const dir: 1 | -1 | 0 = dragX < 0 ? 1 : dragX > 0 ? -1 : 0;
        const fling = dir !== 0 && Math.abs(vx) > PAGE_VELOCITY_THRESHOLD && vx * dir < 0;
        const hasNeighbor = dir !== 0 && index + dir >= 0 && index + dir < photos.length;
        if (dir !== 0 && hasNeighbor && (Math.abs(dragX) > w * PAGE_DISTANCE_FRACTION || fling)) {
          startSpring("dragX", dragX, vx, -dir * w);
        } else if (dragX !== 0) {
          startSpring("dragX", dragX, vx, 0);
        }
        pageStartRef.current = null;
        touchStartRef.current = null;
        return;
      }

      if (ph === "pending") {
        /* ── TAP / DOUBLE TAP (no movement) ── */
        setPhaseBoth("idle");
        const s = touchStartRef.current;
        touchStartRef.current = null;
        if (!s || performance.now() - s.t > TAP_MAX_MS) return;
        const changed = e.changedTouches[0];
        const dx = changed.clientX - s.x;
        const dy = changed.clientY - s.y;
        if (Math.hypot(dx, dy) > TAP_MAX_MOVE) return;

        const now = performance.now();
        const last = tapRef.current;
        if (last && now - last.t < DOUBLE_TAP_MAX_MS && Math.hypot(changed.clientX - last.x, changed.clientY - last.y) < DOUBLE_TAP_MAX_DIST) {
          tapRef.current = null;
          zoomAtPoint(changed.clientX, changed.clientY);
        } else {
          tapRef.current = { x: changed.clientX, y: changed.clientY, t: now };
          onTap?.();
        }
      }
    },
    [index, onTap, photos.length, setPhaseBoth, startPan, startSpring, trackVelocity, zoomAtPoint]
  );

  const onTouchCancel = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      const ph = phaseRef.current;
      setPhaseBoth("idle");
      if (ph === "page") {
        const dragX = draftRef.current.dragX;
        if (dragX !== 0) startSpring("dragX", dragX, 0, 0);
      }
      if (ph === "pan" || ph === "pinch") {
        const d = draftRef.current;
        const b = panBounds(metricsRef.current.iw, metricsRef.current.ih, metricsRef.current.cw, metricsRef.current.ch, d.scale);
        if (Math.abs(d.x) > b.maxX) startSpring("x", d.x, 0, clamp(d.x, -b.maxX, b.maxX));
        if (Math.abs(d.y) > b.maxY) startSpring("y", d.y, 0, clamp(d.y, -b.maxY, b.maxY));
      }
      touchStartRef.current = null;
      panStartRef.current = null;
      pinchStartRef.current = null;
      pageStartRef.current = null;
    },
    [setPhaseBoth, startSpring]
  );

  /* ── Mouse support (desktop): pan + page, no pinch. ── */
  const mouseRef = useRef<{ x: number; y: number; phase: "pending" | "pan" | "page" | null } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if (mouseRef.current) return;
      e.preventDefault();
      beginGesture();
      touchStartRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      mouseRef.current = { x: e.clientX, y: e.clientY, phase: "pending" };
      setPhaseBoth("pending");
    },
    [beginGesture, setPhaseBoth]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const m = mouseRef.current;
      if (!m) return;
      trackVelocity(e.clientX, e.clientY);
      const dx = e.clientX - m.x;
      const dy = e.clientY - m.y;
      const ph = m.phase;
      if (ph === "pending") {
        if (draftRef.current.scale > 1) {
          m.phase = "pan";
          startPan(e.clientX, e.clientY);
          return;
        }
        if (Math.abs(dx) > DIRECTION_THRESHOLD && Math.abs(dx) > Math.abs(dy) * DIRECTION_SLANT) {
          m.phase = "page";
          startPage(e.clientX, dx);
          return;
        }
        return;
      }
      if (ph === "pan") {
        const s = panStartRef.current;
        if (!s) return;
        const z = draftRef.current.scale;
        const desiredX = s.pan0.x + (e.clientX - s.x);
        const desiredY = s.pan0.y + (e.clientY - s.y);
        const b = panBounds(metricsRef.current.iw, metricsRef.current.ih, metricsRef.current.cw, metricsRef.current.ch, z);
        const clampedX = clamp(desiredX, -b.maxX, b.maxX);
        draftRef.current.x = clampWithRubber(desiredX, b.maxX, Math.max(b.maxX, 40));
        draftRef.current.y = clampWithRubber(desiredY, b.maxY, Math.max(b.maxY, 40));
        apply();
        const excess = desiredX - clampedX;
        if (Math.abs(excess) >= EDGE_ENGAGE_PX) {
          m.phase = "page";
          startPage(e.clientX, excess);
        }
        return;
      }
      if (ph === "page") {
        const s = pageStartRef.current;
        if (!s) return;
        let dragX = s.dragX0 + (e.clientX - s.x);
        const dir: 1 | -1 = dragX < 0 ? 1 : -1;
        const hasNeighbor = index + dir >= 0 && index + dir < photos.length;
        if (!hasNeighbor) dragX = s.dragX0 + (e.clientX - s.x) * PAGE_EDGE_RESIST;
        draftRef.current.dragX = dragX;
        apply();
      }
    },
    [apply, index, photos.length, startPage, startPan, trackVelocity]
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const m = mouseRef.current;
      if (!m) return;
      mouseRef.current = null;
      const ph = m.phase;
      if (ph === "page") {
        setPhaseBoth("idle");
        const w = widthRef.current || 1;
        const dragX = draftRef.current.dragX;
        const vx = velRef.current.vx;
        const dir: 1 | -1 | 0 = dragX < 0 ? 1 : dragX > 0 ? -1 : 0;
        const fling = dir !== 0 && Math.abs(vx) > PAGE_VELOCITY_THRESHOLD && vx * dir < 0;
        const hasNeighbor = dir !== 0 && index + dir >= 0 && index + dir < photos.length;
        if (dir !== 0 && hasNeighbor && (Math.abs(dragX) > w * PAGE_DISTANCE_FRACTION || fling)) {
          startSpring("dragX", dragX, vx, -dir * w);
        } else if (dragX !== 0) {
          startSpring("dragX", dragX, vx, 0);
        }
        pageStartRef.current = null;
        touchStartRef.current = null;
        return;
      }
      if (ph === "pan") {
        setPhaseBoth("idle");
        const d = draftRef.current;
        const b = panBounds(metricsRef.current.iw, metricsRef.current.ih, metricsRef.current.cw, metricsRef.current.ch, d.scale);
        if (Math.abs(d.x) > b.maxX) startSpring("x", d.x, velRef.current.vx, clamp(d.x, -b.maxX, b.maxX));
        if (Math.abs(d.y) > b.maxY) startSpring("y", d.y, velRef.current.vy, clamp(d.y, -b.maxY, b.maxY));
        panStartRef.current = null;
        return;
      }
      /* Mouse tap */
      setPhaseBoth("idle");
      const s = touchStartRef.current;
      touchStartRef.current = null;
      if (s && performance.now() - s.t < TAP_MAX_MS && Math.hypot(e.clientX - s.x, e.clientY - s.y) < TAP_MAX_MOVE) {
        onTap?.();
      }
    },
    [index, onTap, photos.length, setPhaseBoth, startSpring]
  );

  /* ═══════════════ Metrics and image ═══════════════ */

  /* Container measurement (ResizeObserver) — outside the gesture loop. */
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      metricsRef.current.cw = rect.width;
      metricsRef.current.ch = rect.height;
      widthRef.current = rect.width;
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  /* Repositions slides and image after each index change (new refs). */
  useLayoutEffect(() => {
    indexRef.current = index;
    apply();
  }, [index, apply]);

  /* On image load: base metrics at scale 1 for the pan bounds. */
  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
    const img = imgRef.current;
    const m = metricsRef.current;
    if (!img) return;
    if (draftRef.current.scale === 1) {
      const rect = img.getBoundingClientRect();
      m.iw = rect.width;
      m.ih = rect.height;
    } else if (img.naturalWidth > 0) {
      const fit = Math.min(m.cw / img.naturalWidth, m.ch / img.naturalHeight);
      m.iw = img.naturalWidth * fit;
      m.ih = img.naturalHeight * fit;
    }
  }, []);

  /* Cleanup on unmount. */
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      tapRef.current = null;
    };
  }, []);

  /* ═════════════════════════════ RENDER ═════════════════════════════ */
  const slides = [index - 1, index, index + 1];
  const gestureActive = phase !== "idle";

  return (
    <div
      ref={containerRef}
      className={className}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "relative",
        overflow: "hidden",
        touchAction: "none", // requirement 2: the WebView does not fight the gesture
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
        cursor: gestureActive ? "grabbing" : "default",
      }}
    >
      {slides.map((i) => {
        if (i < 0 || i >= photos.length) return null;
        const photo = photos[i];
        const isActive = i === index;
        return (
          <div
            key={photo.id}
            ref={(el) => {
              if (el) {
                slideElsRef.current.set(photo.id, el);
                slideOffsetRef.current.set(photo.id, i - index);
              } else {
                slideElsRef.current.delete(photo.id);
                slideOffsetRef.current.delete(photo.id);
              }
            }}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: `translate3d(${(i - index) * (widthRef.current || 1)}px, 0, 0)`,
              willChange: "transform",
            }}
          >
            {isActive ? (
              photo.kind === "other" ? (
                <div style={{ position: "absolute", inset: 0 }} />
              ) : (
                <>
                  {!imageLoaded && (
                    <div
                      style={{
                        position: "absolute",
                        width: 192,
                        height: 192,
                        borderRadius: 16,
                        background: "rgba(255,255,255,0.04)",
                      }}
                    />
                  )}
                  <img
                    ref={imgRef}
                    src={photo.src}
                    alt=""
                    draggable={false}
                    decoding="async"
                    onLoad={handleImageLoad}
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      objectFit: "contain",
                      transform: "translate3d(0px, 0px, 0) scale(1)",
                      willChange: "transform",
                      opacity: imageLoaded ? 1 : 0,
                    }}
                  />
                </>
              )
            ) : photo.kind === "other" ? (
              /* Non-image neighbor (video, audio, PDF, ...): the commit navigates
                 the modal to that file; here only the space is reserved. */
              <div style={{ position: "absolute", inset: 0 }} />
            ) : (
              /* Neighbor: light preload (async decoding, without blocking the UI
                 thread). Memory: only 3 slides exist in the DOM; out of range,
                 React unmounts them by key. */
              <img
                src={photo.src}
                alt=""
                draggable={false}
                decoding="async"
                loading="eager"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}