/* ═══════════════════════════════════════════════════════════════
   Transformation math.
   All motion happens on the compositor (GPU):
   translate3d + scale + rotate generate NO reflows or repaints.
   ═══════════════════════════════════════════════════════════════ */

import type { PanBounds, Transform2D } from "./types";

/** Safe numeric clamping (avoids NaN and infinities). */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Pan bounds for a given zoom: the zoomed image can only move until
 * its edge meets the viewport edge.
 * If the image does not overflow (low zoom), max = 0 → panning locked.
 */
export function panBounds(
  iw: number,
  ih: number,
  cw: number,
  ch: number,
  scale: number
): PanBounds {
  return {
    maxX: Math.max(0, (iw * scale - cw) / 2),
    maxY: Math.max(0, (ih * scale - ch) / 2),
  };
}

/** Applies pan bounds to a transform (the zoom is left untouched). */
export function clampPan(t: Transform2D, bounds: PanBounds): Transform2D {
  return {
    ...t,
    x: clamp(t.x, -bounds.maxX, bounds.maxX),
    y: clamp(t.y, -bounds.maxY, bounds.maxY),
  };
}

/**
 * CSS transform string.
 *
 * ORDER: translate → scale → rotate. Transforms are applied right to
 * left, so the rotation happens around the element's center.
 * `translate3d` promotes the element to its own compositor layer:
 * the browser only moves GPU textures each frame (60 fps).
 */
export function transformCss(t: Transform2D): string {
  return `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale}) rotate(${t.rotation}deg)`;
}

/**
 * "object-contain" fit scale: how much to scale the native image so it
 * fits entirely within the viewport (equivalent to zoom = 1).
 */
export function fitScale(
  naturalW: number,
  naturalH: number,
  cw: number,
  ch: number
): number {
  if (naturalW <= 0 || naturalH <= 0 || cw <= 0 || ch <= 0) return 1;
  return Math.min(cw / naturalW, ch / naturalH);
}

/**
 * Anchors the point under the fingers during a pinch (focal zoom):
 * the INITIAL midpoint coordinate stays fixed under the fingers while
 * the zoom changes. Without this, the pinch would "run away" from the grip point.
 */
export function anchoredPan(
  start: { midX: number; midY: number; pan: Transform2D; scale: number },
  midX: number,
  midY: number,
  nextScale: number,
  cw: number,
  ch: number
): { x: number; y: number } {
  const cx = cw / 2;
  const cy = ch / 2;
  // Distance from the anchor point to the center, in "image space" (scale 1).
  const qx = start.midX - cx - start.pan.x;
  const qy = start.midY - cy - start.pan.y;
  // Projects that distance onto the new scale and repositions the pan.
  return {
    x: midX - cx - (qx / start.scale) * nextScale,
    y: midY - cy - (qy / start.scale) * nextScale,
  };
}