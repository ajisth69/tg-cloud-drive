/* ═══════════════════════════════════════════════════════════════
   HORIZONTAL CAROUSEL (PageView/Swipe)
   ───────────────────────────────────────────────────────────────
   Track state:
   · dragX     — track offset in px (follows the finger).
   · settling  — true while the track animates to its final position.
   · dir       — direction of the transition in progress (1 = next).

   Lifecycle of a swipe:
   begin() → drag(dx) × N → end(velX, dir) → [transition] → finish()
     │                        │
     │  (gesture engage)      ├─ navigates: dragX = dir * width
     │                        └─ rejects: dragX = 0 (spring-back)

   Memory: only 3 slides are mounted (previous, current, next);
   the rest never exists in the DOM. Transitions happen with
   `transform: translate3d` (GPU) — no reflows.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from "react";

export interface CarouselOptions {
  /** Total number of carousel items. */
  count: number;
  /** Current index (source of truth: the parent). */
  index: number;
  /** Called when the transition to a neighbor COMPLETES. */
  onIndexChange: (index: number) => void;
  /** Width fraction for a drag to count as navigation (0.25 = 25%). */
  settleFraction?: number;
  /** Fling velocity in px/ms to navigate with short drags. */
  velocityThreshold?: number;
  /** Resistance when dragging past the edges (rubber band, 0..1). */
  resistance?: number;
}

export interface CarouselApi {
  dragX: number;
  settling: boolean;
  dir: 1 | -1 | 0;
  /** Slide width in px (updated by the viewer via ResizeObserver). */
  widthRef: { current: number };
  /** Gesture engage: resets the track and disables transitions. */
  begin: () => void;
  /** Track drag (applies rubber band at the edges). */
  drag: (dx: number) => void;
  /** Gesture end: decides whether to navigate or bounce back (fling + width fraction). */
  end: (velocityX: number, dragDir: 1 | -1 | 0) => void;
  /** Must be called when the CSS transition finishes (transitionend/timeout). */
  finish: () => void;
  /** Programmatic navigation (e.g. keyboard/buttons). */
  goTo: (dir: 1 | -1) => void;
}

export function useCarousel(options: CarouselOptions): CarouselApi {
  const {
    count,
    index,
    onIndexChange,
    settleFraction = 0.25,
    velocityThreshold = 0.35,
    resistance = 0.35,
  } = options;

  const [dragX, setDragX] = useState(0);
  const [settling, setSettling] = useState(false);
  const [dir, setDir] = useState<1 | -1 | 0>(0);

  const widthRef = useRef(0);
  // Ref mirror of dragX: `end` decides with the final value without relying
  // on React's render cycle.
  const dragRef = useRef(0);
  const pendingNavRef = useRef<1 | -1 | 0>(0);

  /** Is there a neighbor in that direction? (blocks navigation at the edges). */
  const hasNeighbor = (d: 1 | -1) => index + d >= 0 && index + d < count;

  const begin = useCallback(() => {
    pendingNavRef.current = 0;
    dragRef.current = 0;
    setSettling(false);
    setDragX(0);
  }, []);

  /**
   * Drag: resistance (rubber band) is applied at the edges so the
   * user perceives that there is no more content.
   */
  const drag = useCallback(
    (dx: number) => {
      const d: 1 | -1 = dx < 0 ? 1 : -1;
      const eff = hasNeighbor(d) ? dx : dx * resistance;
      dragRef.current = eff;
      setDragX(eff);
    },
    [hasNeighbor, resistance]
  );

  /**
   * Navigation decision:
   * · drag > settleFraction of the width, OR
   * · fling: |velocity| > threshold and the finger's direction matches.
   * If it navigates → dragX = dir * width (the slide leaves the screen).
   * If not → dragX = 0 (animated spring-back).
   */
  const end = useCallback(
    (velocityX: number, dragDir: 1 | -1 | 0) => {
      const width = widthRef.current || 1;
      const dx = dragRef.current;
      const d: 1 | -1 | 0 = dragDir !== 0 ? dragDir : dx < 0 ? 1 : dx > 0 ? -1 : 0;
      const fling = d !== 0 && Math.abs(velocityX) > velocityThreshold && velocityX * d < 0;
      if (d !== 0 && (Math.abs(dx) > width * settleFraction || fling) && hasNeighbor(d)) {
        pendingNavRef.current = d;
        setDir(d);
        setSettling(true);
        dragRef.current = d * width;
        setDragX(d * width);
      } else if (dx !== 0) {
        pendingNavRef.current = 0;
        setDir(0);
        setSettling(true);
        dragRef.current = 0;
        setDragX(0);
      }
    },
    [hasNeighbor, settleFraction, velocityThreshold]
  );

  /** End of the CSS transition: applies the index change and resets the track. */
  const finish = useCallback(() => {
    const d = pendingNavRef.current;
    pendingNavRef.current = 0;
    setDir(0);
    setSettling(false);
    dragRef.current = 0;
    setDragX(0);
    if (d !== 0) onIndexChange(index + d);
  }, [index, onIndexChange]);

  /** Programmatic navigation (same transition as an accepted swipe). */
  const goTo = useCallback(
    (d: 1 | -1) => {
      if (!hasNeighbor(d)) return;
      const width = widthRef.current || 1;
      pendingNavRef.current = d;
      setDir(d);
      setSettling(true);
      dragRef.current = d * width;
      setDragX(d * width);
    },
    [hasNeighbor]
  );

  // Keeps dragRef in sync if settling falls to false by another path.
  useEffect(() => {
    if (!settling && dragRef.current !== 0) dragRef.current = 0;
  }, [settling]);

  return { dragX, settling, dir, widthRef, begin, drag, end, finish, goTo };
}