/* ═══════════════════════════════════════════════════════════════
   GESTURE CONTROLLER (Pinch / Pan / Swipe) — 60 fps
   ───────────────────────────────────────────────────────────────
   State machine (requirement #3 — gesture exclusion):

       pointerdown (1 finger)
              │
              ▼
        ┌─ "pending" ─────────────────┐
        │        │                    │
        │   zoom > 1                  │  zoom == 1
        │        │                    │
        │        ▼                    ▼
        │   "pan"             |dx| > threshold and horizontal?
        │     │                       │
        │     │ (optional:           ├─► "swipe" (carousel)
        │     │  edge-exceed)        │
        │     └── excess ≥ threshold ─┤
        │                  └───────► "swipe" (drag over the edge)
        │
        └── 2nd finger ──► "pinch" ──► on lifting a finger ──► "pan"

   ARBITRATION RULES:
   · zoom == 1  → the horizontal gesture is SWIPE (changes page).
   · zoom > 1   → the gesture is PAN (image panning takes priority).
                  Swipe is DISABLED unless `allowEdgeSwipeWhenZoomed` is
                  active: it only engages when the finger crosses the image
                  edge (excess).

   PERFORMANCE (requirement #4 — no jank):
   · During the gesture it writes DIRECTLY to `img.style.transform`
     (compositor path). Zero React re-renders per movement.
   · Viewport metrics are captured ONCE when the gesture starts
     (a single getBoundingClientRect per gesture). Never inside the loop.
   · React only syncs when the gesture FINISHES (commit).
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { anchoredPan, clamp, clampPan, fitScale, panBounds, transformCss } from "./math";
import { identityTransform, type GestureKind, type Transform2D, type ViewportMetrics } from "./types";

/* ── Gesture thresholds (tunable per call if needed) ── */
const TAP_MAX_MOVE = 10; // max px of movement to count as a tap
const TAP_MAX_MS = 300; // max duration of a tap
const DOUBLE_TAP_MAX_MS = 300; // window between the two taps
const DOUBLE_TAP_MAX_DIST = 40; // max spread between the two taps

export interface GestureControllerOptions {
  /** Viewer surface (receives the pointer capture and viewport metrics). */
  surfaceRef: RefObject<HTMLDivElement | null>;
  /** Active <img> that receives the transform (null for video). */
  imgRef: RefObject<HTMLImageElement | null>;
  /** Base metrics (viewport + image at scale 1), updated on load. */
  metricsRef: RefObject<ViewportMetrics>;
  /** Maximum allowed zoom (pinch and double tap). */
  maxZoom?: number;
  /** Threshold (px) to resolve swipe direction at zoom 1. */
  directionThreshold?: number;
  /** Minimum excess over the edge to engage the edge-exceed swipe (px). */
  edgeExceedThreshold?: number;
  /** Enables swiping while zoomed when the image edge is crossed. */
  allowEdgeSwipeWhenZoomed?: boolean;
  /** Fires when the phase changes (useful for will-change / UI). */
  onGestureStart?: (kind: GestureKind) => void;
  /** Fires when any gesture ends. */
  onGestureEnd?: () => void;
  /** Horizontal carousel drag (dx accumulated since the start). */
  onSwipeDrag?: (dx: number) => void;
  /**
   * End of the swipe. `dir`: 1 = next (leftward drag),
   * -1 = previous, 0 = no direction (spring-back).
   */
  onSwipeEnd?: (velocityX: number, dir: 1 | -1 | 0) => void;
  /** Single tap (immediate). NOTE: with double tap, the 1st tap also fires this. */
  onTap?: () => void;
  /** Double tap → zoom to the point (screen coordinates). */
  onDoubleTap?: (clientX: number, clientY: number) => void;
}

export interface GestureController {
  /** Current phase (only changes on transitions → minimal re-renders). */
  phase: GestureKind;
  /** Committed transform (mirror for React / initial render). */
  transform: Transform2D;
  /** Handlers to attach to the container. */
  handlers: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
  };
  /** Call from the <img>'s onLoad: measures the base metrics at scale 1. */
  onImageLoaded: () => void;
  /** Resets the transform (e.g. when switching items). */
  reset: (t?: Transform2D) => void;
  /** Double-tap zoom at a point: 1 → 2.5 (anchored), and vice versa. */
  zoomAt: (clientX: number, clientY: number) => void;
}

export function useGestureController(options: GestureControllerOptions): GestureController {
  const {
    surfaceRef,
    imgRef,
    metricsRef,
    maxZoom = 5,
    directionThreshold = 10,
    edgeExceedThreshold = 40,
    allowEdgeSwipeWhenZoomed = false,
    onGestureStart,
    onGestureEnd,
    onSwipeDrag,
    onSwipeEnd,
    onTap,
    onDoubleTap,
  } = options;

  /* ── Public state: only updated on transitions and commits ── */
  const [phase, setPhase] = useState<GestureKind>("idle");
  const [transform, setTransform] = useState<Transform2D>(identityTransform());

  /* ── Internal gesture state: refs (no re-renders per movement) ── */
  const phaseRef = useRef<GestureKind>("idle");
  const transformRef = useRef<Transform2D>(identityTransform());
  const surfaceRectRef = useRef<{ left: number; top: number }>({ left: 0, top: 0 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pendingRef = useRef<{ x0: number; y0: number; x1: number; y1: number; t0: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; pan0: Transform2D } | null>(null);
  const pinchRef = useRef<{
    dist: number; scale: number; midX: number; midY: number;
    pan: Transform2D; cw: number; ch: number; iw: number; ih: number;
  } | null>(null);
  const swipeRef = useRef<{
    startX: number; lastX: number; lastT: number;
    velX: number; dragX: number; engaged: boolean;
  } | null>(null);
  const edgeSwipeRef = useRef(false);
  const tapRef = useRef<{ x: number; y: number; t: number } | null>(null);

  /** Changes the phase in ref and state (single source of truth). */
  const setPhaseBoth = useCallback((p: GestureKind) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  /**
   * Writes the transform directly onto the <img>.
   * GPU path: the browser does NOT re-layout or re-render React.
   */
  const apply = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    img.style.transform = transformCss(transformRef.current);
  }, [imgRef]);

  /** Commit: syncs React state when the gesture ends. */
  const commit = useCallback(() => {
    setTransform({ ...transformRef.current });
  }, []);

  /** Enters pan using the current transform and finger as the baseline. */
  const enterPanFromPoint = useCallback(
    (rx: number, ry: number) => {
      panRef.current = { x: rx, y: ry, pan0: { ...transformRef.current } };
      setPhaseBoth("pan");
      onGestureStart?.("pan");
    },
    [onGestureStart, setPhaseBoth]
  );

  /** Enters pinch with 2 fingers: state snapshot for the anchoring. */
  const enterPinch = useCallback(() => {
    const m = metricsRef.current;
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return;
    const a = pts[0];
    const b = pts[1];
    pinchRef.current = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      scale: transformRef.current.scale,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      pan: { ...transformRef.current },
      cw: m.cw,
      ch: m.ch,
      iw: m.iw,
      ih: m.ih,
    };
    setPhaseBoth("pinch");
    onGestureStart?.("pinch");
  }, [metricsRef, onGestureStart, setPhaseBoth]);

  /** Smoothed instantaneous velocity (moving average) for fling detection. */
  const updateSwipeVelocity = useCallback((clientX: number) => {
    const sw = swipeRef.current;
    if (!sw) return;
    const now = performance.now();
    const dt = now - sw.lastT;
    if (dt > 0) {
      const inst = (clientX - sw.lastX) / dt; // px/ms
      sw.velX = sw.velX === 0 ? inst : sw.velX * 0.7 + inst * 0.3;
    }
    sw.lastX = clientX;
    sw.lastT = now;
  }, []);

  /** Pinch: anchored focal zoom + pan bounded for the new scale. */
  const updatePinch = useCallback(() => {
    const s = pinchRef.current;
    if (!s) return;
    const pts = [...pointersRef.current.values()];
    if (pts.length < 2) return;
    const a = pts[0];
    const b = pts[1];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist === 0) return;
    const next = clamp(s.scale * (dist / s.dist), 1, maxZoom);
    let t: Transform2D;
    if (next <= 1) {
      // Below 1 there is no zoom: identity transform.
      t = { ...identityTransform(), rotation: s.pan.rotation };
    } else {
      const { x, y } = anchoredPan(s, (a.x + b.x) / 2, (a.y + b.y) / 2, next, s.cw, s.ch);
      t = clampPan(
        { scale: next, x, y, rotation: s.pan.rotation },
        panBounds(s.iw, s.ih, s.cw, s.ch, next)
      );
    }
    transformRef.current = t;
    apply();
  }, [apply, maxZoom]);

  /**
   * Pan (zoom > 1): free movement with bounds.
   * If `allowEdgeSwipeWhenZoomed`, crossing the edge engages the
   * carousel swipe (edge-exceed).
   */
  const updatePan = useCallback(
    (e: ReactPointerEvent, rx: number, ry: number) => {
      const s = panRef.current;
      const m = metricsRef.current;
      if (!s) return;
      const z = transformRef.current.scale;
      const desiredX = s.pan0.x + (rx - s.x);
      const desiredY = s.pan0.y + (ry - s.y);
      const bounds = panBounds(m.iw, m.ih, m.cw, m.ch, z);
      const nx = clamp(desiredX, -bounds.maxX, bounds.maxX);
      const ny = clamp(desiredY, -bounds.maxY, bounds.maxY);

      if (allowEdgeSwipeWhenZoomed && !edgeSwipeRef.current) {
        // Excess = what the finger tries to drag BEYOND the edge.
        const excess = desiredX - nx;
        if (Math.abs(excess) >= edgeExceedThreshold) {
          edgeSwipeRef.current = true;
          swipeRef.current = {
            startX: rx, lastX: e.clientX, lastT: performance.now(),
            velX: 0, dragX: excess, engaged: true,
          };
          setPhaseBoth("swipe");
          onGestureStart?.("swipe");
          onSwipeDrag?.(excess);
        }
      }

      transformRef.current = { ...transformRef.current, x: nx, y: ny };
      apply();
    },
    [allowEdgeSwipeWhenZoomed, apply, edgeExceedThreshold, metricsRef, onGestureStart, onSwipeDrag, setPhaseBoth]
  );

  /**
   * Swipe:
   * · zoom 1 → drags the carousel with the finger (dx from the start).
   * · edge-exceed → recomputes the real excess; if it falls below the
   *   threshold (hysteresis), it disengages and returns to pan.
   */
  const updateSwipe = useCallback(
    (e: ReactPointerEvent, rx: number) => {
      const sw = swipeRef.current;
      if (!sw) return;
      if (sw.engaged) {
        const s = panRef.current;
        const m = metricsRef.current;
        if (!s) return;
        const z = transformRef.current.scale;
        const bounds = panBounds(m.iw, m.ih, m.cw, m.ch, z);
        const desiredX = s.pan0.x + (rx - s.x);
        const nx = clamp(desiredX, -bounds.maxX, bounds.maxX);
        const excess = desiredX - nx;
        if (Math.abs(excess) < edgeExceedThreshold) {
          edgeSwipeRef.current = false;
          swipeRef.current = null;
          transformRef.current = { ...transformRef.current, x: nx };
          apply();
          setPhaseBoth("pan");
          onGestureStart?.("pan");
          return;
        }
        updateSwipeVelocity(e.clientX);
        sw.dragX = excess;
        onSwipeDrag?.(excess);
        return;
      }
      updateSwipeVelocity(e.clientX);
      sw.dragX = rx - sw.startX;
      onSwipeDrag?.(sw.dragX);
    },
    [apply, edgeExceedThreshold, metricsRef, onGestureStart, onSwipeDrag, setPhaseBoth, updateSwipeVelocity]
  );

  /** Tap / double-tap detection (only runs if the finger did not move). */
  const handleTap = useCallback(
    (p: { x0: number; y0: number; x1: number; y1: number; t0: number }) => {
      const now = performance.now();
      const last = tapRef.current;
      if (last && now - last.t < DOUBLE_TAP_MAX_MS && Math.hypot(p.x0 - last.x, p.y0 - last.y) < DOUBLE_TAP_MAX_DIST) {
        tapRef.current = null;
        const rect = surfaceRectRef.current;
        onDoubleTap?.((p.x0 + p.x1) / 2 + rect.left, (p.y0 + p.y1) / 2 + rect.top);
        return;
      }
      tapRef.current = { x: p.x0, y: p.y0, t: now };
      onTap?.();
    },
    [onDoubleTap, onTap]
  );

  /** Ends the current gesture: commits the transform or closes the swipe. */
  const endCurrentGesture = useCallback(
    (cancelled: boolean) => {
      const ph = phaseRef.current;
      const p = pendingRef.current;
      pointersRef.current.clear();
      pendingRef.current = null;

      if (ph === "swipe") {
        const sw = swipeRef.current;
        const dragX = sw?.dragX ?? 0;
        const dir: 1 | -1 | 0 = dragX < 0 ? 1 : dragX > 0 ? -1 : 0;
        edgeSwipeRef.current = false;
        swipeRef.current = null;
        setPhaseBoth("idle");
        onGestureEnd?.();
        onSwipeEnd?.(sw?.velX ?? 0, cancelled ? 0 : dir);
        return;
      }
      if (ph === "pan" || ph === "pinch") {
        commit();
        setPhaseBoth("idle");
        onGestureEnd?.();
        return;
      }
      if (ph === "pending") {
        setPhaseBoth("idle");
        onGestureEnd?.();
        if (
          p && !cancelled &&
          performance.now() - p.t0 < TAP_MAX_MS &&
          Math.hypot(p.x1 - p.x0, p.y1 - p.y0) < TAP_MAX_MOVE
        ) {
          handleTap(p);
        }
      }
    },
    [commit, handleTap, onGestureEnd, onSwipeEnd, setPhaseBoth]
  );

  /* ═══════════════════ Public handlers (Pointer Events) ═══════════════════ */

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Ignores interactions over controls (video buttons, sliders, etc.).
      if ((e.target as HTMLElement).closest?.("button, input, select, textarea, a")) return;
      e.stopPropagation();
      const surface = surfaceRef.current;
      if (!surface) return;
      surface.setPointerCapture?.(e.pointerId);
      // The gesture's ONLY layout read (container metrics).
      const rect = surface.getBoundingClientRect();
      surfaceRectRef.current = { left: rect.left, top: rect.top };
      const rx = e.clientX - rect.left;
      const ry = e.clientY - rect.top;
      pointersRef.current.set(e.pointerId, { x: rx, y: ry });

      const ph = phaseRef.current;
      if (pointersRef.current.size === 2) {
        if (ph !== "pinch") enterPinch();
        return;
      }
      if (ph === "pinch") {
        // Remaining finger after lifting one from a pinch → continues as pan.
        enterPanFromPoint(rx, ry);
        return;
      }
      if (ph === "idle" || ph === "pending") {
        pendingRef.current = { x0: rx, y0: ry, x1: rx, y1: ry, t0: performance.now() };
        if (ph === "idle") {
          setPhaseBoth("pending");
          onGestureStart?.("pending");
        }
      }
    },
    [enterPanFromPoint, enterPinch, onGestureStart, setPhaseBoth, surfaceRef]
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      e.stopPropagation();
      const rect = surfaceRectRef.current;
      const rx = e.clientX - rect.left;
      const ry = e.clientY - rect.top;
      const p = pointersRef.current.get(e.pointerId);
      if (p) pointersRef.current.set(e.pointerId, { x: rx, y: ry });

      const ph = phaseRef.current;
      if (ph === "pinch") {
        updatePinch();
        return;
      }
      if (ph === "pan") {
        updatePan(e, rx, ry);
        return;
      }
      if (ph === "swipe") {
        updateSwipe(e, rx);
        return;
      }
      if (ph === "pending") {
        const pend = pendingRef.current;
        if (!pend) return;
        pend.x1 = rx;
        pend.y1 = ry;
        if (pointersRef.current.size >= 2) {
          enterPinch();
          return;
        }
        const dx = rx - pend.x0;
        const dy = ry - pend.y0;
        // REQUIREMENT #3: with zoom the swipe does NOT activate; pan takes priority.
        if (transformRef.current.scale > 1) {
          enterPanFromPoint(rx, ry);
          return;
        }
        // Zoom 1: resolves swipe only if the movement is clearly horizontal
        // (prevents gesture stealing when vertical scrolling).
        if (Math.abs(dx) > directionThreshold && Math.abs(dx) > Math.abs(dy) * 1.3) {
          swipeRef.current = {
            startX: pend.x0, lastX: e.clientX, lastT: performance.now(),
            velX: 0, dragX: dx, engaged: false,
          };
          setPhaseBoth("swipe");
          onGestureStart?.("swipe");
          onSwipeDrag?.(dx);
        }
      }
    },
    [directionThreshold, enterPanFromPoint, enterPinch, onGestureStart, onSwipeDrag, setPhaseBoth, updatePan, updatePinch, updateSwipe]
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      e.stopPropagation();
      pointersRef.current.delete(e.pointerId);
      const ph = phaseRef.current;
      if (ph === "pinch" && pointersRef.current.size >= 1) {
        if (pointersRef.current.size === 1) {
          const rem = [...pointersRef.current.values()][0];
          enterPanFromPoint(rem.x, rem.y);
        }
        return;
      }
      endCurrentGesture(false);
    },
    [endCurrentGesture, enterPanFromPoint]
  );

  const onPointerCancel = useCallback(
    (e: ReactPointerEvent) => {
      e.stopPropagation();
      pointersRef.current.delete(e.pointerId);
      if (phaseRef.current === "pinch" && pointersRef.current.size >= 1) return;
      endCurrentGesture(true);
    },
    [endCurrentGesture]
  );

  /* ── Cleanup on unmount ── */
  useEffect(
    () => () => {
      tapRef.current = null;
    },
    []
  );

  /* ═══════════════════ Public API ═══════════════════ */

  /**
   * Called from the active <img>'s onLoad. Measures the base metrics
   * (width/height at scale 1) to compute the pan bounds.
   * If the image loads already zoomed, it uses the natural dimensions.
   */
  const onImageLoaded = useCallback(() => {
    const img = imgRef.current;
    const m = metricsRef.current;
    if (!img) return;
    if (transformRef.current.scale === 1) {
      const rect = img.getBoundingClientRect();
      m.iw = rect.width;
      m.ih = rect.height;
    } else if (img.naturalWidth > 0) {
      const fit = fitScale(img.naturalWidth, img.naturalHeight, m.cw, m.ch);
      m.iw = img.naturalWidth * fit;
      m.ih = img.naturalHeight * fit;
    }
  }, [imgRef, metricsRef]);

  /** Reset (when switching items): identity by default. */
  const reset = useCallback(
    (t?: Transform2D) => {
      transformRef.current = t ? { ...t } : identityTransform();
      apply();
      setTransform({ ...transformRef.current });
    },
    [apply]
  );

  /**
   * Double tap: 1 → 2.5x anchored at the point (and vice versa).
   * Applied with a CSS transition (idle phase) → smooth GPU animation.
   */
  const zoomAt = useCallback(
    (clientX: number, clientY: number) => {
      const m = metricsRef.current;
      const surface = surfaceRef.current;
      if (!surface || m.cw <= 0 || m.iw <= 0) return;
      const rect = surface.getBoundingClientRect();
      const midX = clientX - rect.left;
      const midY = clientY - rect.top;
      const cur = transformRef.current;
      if (cur.scale > 1) {
        const t = { ...identityTransform(), rotation: cur.rotation };
        transformRef.current = t;
        apply();
        setTransform({ ...t });
        return;
      }
      const target = Math.min(2.5, maxZoom);
      const { x, y } = anchoredPan(
        { midX, midY, pan: identityTransform(), scale: 1 },
        midX, midY, target, m.cw, m.ch
      );
      const t = clampPan(
        { scale: target, x, y, rotation: cur.rotation },
        panBounds(m.iw, m.ih, m.cw, m.ch, target)
      );
      transformRef.current = t;
      apply();
      setTransform({ ...t });
    },
    [apply, maxZoom, metricsRef, surfaceRef]
  );

  return {
    phase,
    transform,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    onImageLoaded,
    reset,
    zoomAt,
  };
}