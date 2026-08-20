/* ═══════════════════════════════════════════════════════════════
   Base types of the media viewer (Google Drive / Google Photos).
   ═══════════════════════════════════════════════════════════════ */

/** 2D transform applied to the active media (zoomed image). */
export interface Transform2D {
  /** Zoom factor (1 = initial scale, fit to screen). */
  scale: number;
  /** Horizontal translation in px (relative to the container center). */
  x: number;
  /** Vertical translation in px. */
  y: number;
  /** Rotation in degrees (EXIF-rotated photos, e.g.). */
  rotation: number;
}

/** Identity transform (no zoom or translation). */
export function identityTransform(): Transform2D {
  return { scale: 1, x: 0, y: 0, rotation: 0 };
}

/**
 * Phases of the touch controller state machine.
 *
 *   idle ──pointerdown──► pending ──► pan / pinch / swipe ──► idle
 *
 * · pending: 1 finger with unresolved direction (still can be tap, pan or swipe).
 * · pan:     panning of the zoomed image (zoom > 1).
 * · pinch:   2 fingers → focal-anchored zoom.
 * · swipe:   horizontal drag of the carousel (zoom == 1, or edge-exceed).
 */
export type GestureKind = "idle" | "pending" | "pan" | "pinch" | "swipe";

/** Pan bounds: the image edge cannot cross the viewport edge. */
export interface PanBounds {
  maxX: number;
  maxY: number;
}

/**
 * Base metrics captured ONCE per gesture (no layout reads inside the
 * motion loop — key to avoiding reflows/jank).
 */
export interface ViewportMetrics {
  /** Container width (px). */
  cw: number;
  /** Container height (px). */
  ch: number;
  /** Rendered <img> width at scale 1 (px). */
  iw: number;
  /** Rendered <img> height at scale 1 (px). */
  ih: number;
}

/** Carousel item (image, video or preview rendered as an image). */
export interface MediaItem {
  id: string;
  /** Stream URL (e.g. `/stream/{id}` served by the Service Worker) or a blob URL. */
  src: string;
  type: "image" | "video" | "pdf";
  name?: string;
}