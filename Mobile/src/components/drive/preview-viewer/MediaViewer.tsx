/* ═══════════════════════════════════════════════════════════════
   MEDIA VIEWER (images, videos, PDF rendered as image)
   ───────────────────────────────────────────────────────────────
   Composition:
   · useGestureController → gestures (pinch/pan/swipe) on the active <img>.
   · useCarousel           → track of 3 slides (previous/current/next).

   MEMORY PRECAUTIONS (heavy elements):
   · Only 3 slides exist in the DOM; neighbors discard their media when they
     leave the range (React unmounts them by key).
   · <img> with decoding="async" + loading="eager" (preloads the neighbor
     WITHOUT blocking the UI thread). Neighbor videos use preload="none".
   · The active media is the only layer with its own will-change/transform.
   · If you use blob URLs, revoke them in the consumer's onIndexChange
     (URL.revokeObjectURL) — this component does not hold references.
   · The stream cache (e.g. Service Worker) avoids re-downloads when
     returning to an already-seen photo.
   ═══════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { transformCss } from "./math";
import { useCarousel } from "./useCarousel";
import { useGestureController } from "./useGestureController";
import type { MediaItem, ViewportMetrics } from "./types";

export interface MediaViewerProps {
  items: MediaItem[];
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  /** Swiping while zoomed only when crossing the edge (edge-exceed). */
  allowEdgeSwipeWhenZoomed?: boolean;
  maxZoom?: number;
  /** Single tap (e.g. toggling immersive mode). */
  onTap?: () => void;
  /** Custom renderer for unsupported types (PDF/office). */
  renderFallback?: (item: MediaItem, isActive: boolean) => ReactNode;
  className?: string;
  style?: CSSProperties;
}

const SETTLE_TRANSITION = "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)";

const SKELETON_KEYFRAMES = `
@keyframes media-viewer-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}`;

export default function MediaViewer({
  items,
  initialIndex = 0,
  onIndexChange,
  allowEdgeSwipeWhenZoomed = false,
  maxZoom = 5,
  onTap,
  renderFallback,
  className,
  style,
}: MediaViewerProps) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(0, items.length - 1))
  );
  const [imageLoaded, setImageLoaded] = useState(false);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const metricsRef = useRef<ViewportMetrics>({ cw: 0, ch: 0, iw: 0, ih: 0 });

  /**
   * Reference to the controller's zoomAt for double tap.
   * (Indirection: the controller is created before it can be referenced.)
   */
  const doubleTapRef = useRef<(x: number, y: number) => void>(() => {});

  const controller = useGestureController({
    surfaceRef,
    imgRef,
    metricsRef,
    maxZoom,
    allowEdgeSwipeWhenZoomed,
    onGestureStart: (kind) => {
      if (kind === "swipe") carousel.begin();
    },
    onSwipeDrag: (dx) => carousel.drag(dx),
    onSwipeEnd: (velocityX, dir) => carousel.end(velocityX, dir),
    onTap,
    onDoubleTap: (x, y) => doubleTapRef.current(x, y),
  });

  doubleTapRef.current = (x, y) => controller.zoomAt(x, y);

  const carousel = useCarousel({
    count: items.length,
    index,
    onIndexChange: (i) => {
      setIndex(i);
      setImageLoaded(false);
      controller.reset();
      onIndexChange?.(i);
    },
  });

  const { handlers, phase, transform } = controller;
  const { widthRef } = carousel;

  /* ── Viewport metrics: one measurement + ResizeObserver ── */
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const measure = () => {
      const rect = surface.getBoundingClientRect();
      metricsRef.current.cw = rect.width;
      metricsRef.current.ch = rect.height;
      widthRef.current = rect.width;
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(surface);
    return () => ro?.disconnect();
  }, [widthRef]);

  /* ── Safety net: if transitionend never fires (hidden tab), finish ── */
  useEffect(() => {
    if (!carousel.settling) return;
    const t = setTimeout(() => carousel.finish(), 320);
    return () => clearTimeout(t);
  }, [carousel.settling, carousel.finish]);

  /* ── Clamp the index if the list shrinks ── */
  useEffect(() => {
    if (items.length === 0) {
      if (index !== 0) setIndex(0);
      return;
    }
    if (index >= items.length) setIndex(items.length - 1);
  }, [items.length, index]);

  const handleImageLoad = useCallback(() => {
    setImageLoaded(true);
    controller.onImageLoaded();
  }, [controller]);

  /* ── Render of the ACTIVE media (receives the transform + onLoad) ── */
  const renderActive = (item: MediaItem) => {
    if (item.type === "video") {
      return (
        <video
          src={item.src}
          controls
          playsInline
          preload="metadata"
          draggable={false}
          style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
      );
    }
    if (item.type === "image") {
      return (
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {!imageLoaded && (
            <div
              style={{
                position: "absolute",
                width: 192,
                height: 192,
                borderRadius: 16,
                background: "rgba(255,255,255,0.04)",
                animation: "media-viewer-pulse 1.2s ease-in-out infinite",
              }}
            />
          )}
          <img
            ref={imgRef}
            src={item.src}
            alt=""
            draggable={false}
            decoding="async"
            onLoad={handleImageLoad}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              transform: transformCss(transform),
              transition: phase === "idle" ? SETTLE_TRANSITION : "none",
              willChange: "transform",
              opacity: imageLoaded ? 1 : 0,
            }}
          />
        </div>
      );
    }
    return renderFallback ? (
      renderFallback(item, true)
    ) : (
      <div style={{ padding: 24, textAlign: "center", color: "#b0b0b0" }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>{item.name || item.id}</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Preview not available. Download the file to open it.
        </div>
      </div>
    );
  };

  /* ── Render of the NEIGHBORS (light preload, no transform) ── */
  const renderNeighbor = (item: MediaItem) => {
    if (item.type === "video") {
      return (
        <video
          src={item.src}
          muted
          playsInline
          preload="none"
          style={{ maxWidth: "100%", maxHeight: "100%" }}
        />
      );
    }
    if (item.type === "image") {
      return (
        <img
          src={item.src}
          alt=""
          draggable={false}
          decoding="async"
          loading="eager"
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      );
    }
    return renderFallback ? renderFallback(item, false) : null;
  };

  /* ── Track: 3 slides positioned with translate3d (%) ── */
  const dragPct = (carousel.dragX / (widthRef.current || 1)) * 100;
  const slides: (number | null)[] = [index - 1, index, index + 1];

  return (
    <div
      ref={surfaceRef}
      className={className}
      style={{
        position: "relative",
        overflow: "hidden",
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
        ...style,
      }}
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <style>{SKELETON_KEYFRAMES}</style>
      {slides.map((i) => {
        if (i === null || i < 0 || i >= items.length) return null;
        const item = items[i];
        const isActive = i === index;
        return (
          <div
            key={item.id}
            onTransitionEnd={(e) => {
              // Only the slide (not children like the <img>) closes the transition.
              if (e.target === e.currentTarget) carousel.finish();
            }}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: `translate3d(${(i - index) * 100 + dragPct}%, 0, 0)`,
              transition: carousel.settling ? SETTLE_TRANSITION : "none",
              willChange: "transform",
            }}
          >
            {isActive ? renderActive(item) : renderNeighbor(item)}
          </div>
        );
      })}
    </div>
  );
}