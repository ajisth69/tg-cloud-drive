/* ═══════════════════════════════════════════════════════════════════════════
   SwiperGallery — Google Drive-style touch gallery on top of SwiperJS
   ─────────────────────────────────────────────────────────────────────────────
   MEMORY / GPU STRATEGY (mid-range):
   · Virtual: maximum 5 nodes in the DOM (active + 2 buffer per side).
     Out-of-range slides are destroyed; created ones are reused (cache).
   · will-change: transform on the rendered slides (≤5 nodes, bounded
     layers; the texture memory problem starts with 50+ slides).
   · touch-action: none (CSS): the WebView does not fight the gesture.
   · Images: decoding async, opacity 0 → 1 on load (no black flash).
   · 2-slide buffer: the neighbor starts loading ONE photo before arriving,
     so the target image is already decoded when the slide lands.
   · Zoom via the `zoom` module (pinch + double tap); while zoom > 1 the
     module blocks slide changes (interlock: zoom → pan, 1x → page).
   · NO remount on navigation: the external index is synced with
     slideTo() without animation; the carousel DOM is never destroyed mid-
     transition (that is the source of the flicker).
   ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useLayoutEffect, useRef } from "react";
import Swiper from "swiper";
import { Virtual, Zoom } from "swiper/modules";
import "swiper/css";
import "swiper/css/virtual";
import "swiper/css/zoom";
import "./SwiperGallery.css";

export interface GalleryPhoto {
  id: string;
  src: string;
  kind?: "image" | "other";
}

interface SwiperGalleryProps {
  photos: GalleryPhoto[];
  /** Thumbnails (640px) by id: the swipe only animates these small textures
   *  (cheap frames on low-end devices). The full photo loads and fades on top
   *  once stabilized. Empty → the full photo is used directly. */
  thumbMap?: Record<string, string>;
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  onTap?: () => void;
  className?: string;
  /** Already-loaded image (DOM element from the track's neighbor slot) to
   *  adopt on the initial slide without re-decoding → zero flicker when
   *  arriving from a video. */
  prefetched?: { id: string; el: HTMLImageElement } | null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export default function SwiperGallery({ photos, thumbMap, initialIndex = 0, onIndexChange, onTap, className, prefetched = null }: SwiperGalleryProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const swiperRef = useRef<Swiper | null>(null);
  const onIndexChangeRef = useRef(onIndexChange);
  const onTapRef = useRef(onTap);
  const thumbMapRef = useRef(thumbMap);
  onIndexChangeRef.current = onIndexChange;
  onTapRef.current = onTap;
  thumbMapRef.current = thumbMap;

  /* Init ONCE per photo list (photos memoized in the parent). */
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    /* renderSlide creates the slide node (Swiper calls it once per index;
       with cache:true the node is reused across the track's re-renders).
       Two-layer strategy: the thumbnail (640px) is painted instantly and is
       the only texture that moves during the swipe; the full photo loads and
       fades in on top once stabilized (progressive, Google-style). */
    const renderSlide = (p: unknown): HTMLElement => {
      const photo = p as GalleryPhoto;
      const slide = document.createElement("div");
      slide.className = "swiper-slide";
      if (photo.kind === "other") {
        slide.style.backgroundColor = "#000";
        return slide;
      }
      const zoom = document.createElement("div");
      zoom.className = "swiper-zoom-container";
      // Adopts the image the track already painted (same id): it moves to the
      // slide already decoded → the first frame is the image, no black gap.
      if (prefetched && photo.id === prefetched.id) {
        const img = prefetched.el;
        img.classList.add("loaded");
        img.style.transition = "";
        zoom.appendChild(img);
        slide.appendChild(zoom);
        return slide;
      }
      const thumb = thumbMapRef.current?.[photo.id] ?? null;
      // No thumbnail → the slide uses the full photo directly.
      if (!thumb || thumb === photo.src) {
        const img = document.createElement("img");
        img.className = "gallery-img";
        img.src = photo.src;
        img.alt = "";
        img.draggable = false;
        img.decoding = "async";
        img.loading = "eager";
        img.onload = () => img.classList.add("loaded");
        if (img.complete && img.naturalWidth > 0) {
          img.classList.add("loaded");
          img.style.transition = "";
        } else {
          requestAnimationFrame(() => {
            if (img.complete && img.naturalWidth > 0) {
              img.classList.add("loaded");
              img.style.transition = "";
            }
          });
        }
        zoom.appendChild(img);
        slide.appendChild(zoom);
        return slide;
      }
      // Layer 1: thumbnail (always present, below the full one).
      const t = document.createElement("img");
      t.className = "gallery-img gallery-thumb";
      t.src = thumb;
      t.alt = "";
      t.draggable = false;
      t.decoding = "async";
      t.loading = "eager";
      t.onload = () => t.classList.add("loaded");
      if (t.complete && t.naturalWidth > 0) {
        t.classList.add("loaded");
      }
      // Layer 2: full photo (filled in once the slide stabilizes; on load it
      // fades over the thumbnail → zero flicker). When the fade finishes the
      // thumbnail is REMOVED: a single <img> remains per slide, because the
      // Zoom module transforms the container's first img and with two layers
      // it would only scale the thumbnail → duplicated image when zooming.
      // Bonus: one full-screen texture less per slide on the compositor.
      const f = document.createElement("img");
      f.className = "gallery-img gallery-full";
      f.alt = "";
      f.draggable = false;
      f.decoding = "async";
      f.loading = "eager";
      let fullShown = false;
      const showFull = () => {
        if (fullShown) return;
        fullShown = true;
        f.classList.add("loaded");
        // After the fade, the thumbnail is removed — but if the zoom is
        // already active, the module is transforming the thumb: it waits for
        // it to return to 1x before removing (never unmount an img in use).
        const removeThumb = () => {
          const s = swiperRef.current;
          if (s && s.zoom && s.zoom.scale > 1) {
            const check = (value: number) => {
              if (value <= 1) {
                s.off("zoomChange", check);
                t.remove();
              }
            };
            s.on("zoomChange", check);
            return;
          }
          t.remove();
        };
        window.setTimeout(removeThumb, 200);
      };
      f.onload = () => {
        const s = swiperRef.current;
        if (s && s.zoom && s.zoom.scale > 1) {
          // Zoom active: the module transforms the thumbnail; the full image
          // waits for the zoom to return to 1x (zoomChange) to avoid duplicating it.
          const check = (value: number) => {
            if (value <= 1) {
              s.off("zoomChange", check);
              showFull();
            }
          };
          s.on("zoomChange", check);
        } else {
          showFull();
        }
      };
      zoom.appendChild(t);
      zoom.appendChild(f);
      slide.appendChild(zoom);
      return slide;
    };

    /* Loads the active slide's full photo once the transition stabilizes.
   With Virtual the DOM shifts relative to the indexes (from..to window),
   so the slide is found via its data-swiper-slide-index attribute; the
   photo identity is stored on the node so a photo is not loaded into a
   slide already showing another (image on top of image). */
    const upgradeActiveSlide = () => {
      const s = swiperRef.current;
      if (!s) return;
      const slideEl = Array.from(s.slides).find(
        (el) => Number(el.getAttribute("data-swiper-slide-index")) === s.activeIndex
      );
      if (!slideEl) return;
      const p = s.virtual?.slides?.[s.activeIndex] as GalleryPhoto | undefined;
      const full = slideEl.querySelector<HTMLImageElement>(".gallery-full");
      if (full && p && full.dataset.photoId !== p.id && p.src) {
        full.dataset.photoId = p.id;
        // Deferred ~250ms: decoding+uploading the full photo happens when the
        // finger is no longer in the gesture, never mid-way through a chained
        // swipe (the thumbnail covers the gap visually).
        window.setTimeout(() => {
          if (swiperRef.current === s) {
            full.src = p.src;
          }
        }, 250);
      }
    };

    /* Gesture velocity (px/ms, moving average): the landing animation lasts
       as long as the release velocity dictates — fast swipe → short and
       energetic, slow swipe → long and fluid. */
    let vel = 0;
    let lastT = 0;
    let lastPos = 0;
    const resetVel = () => {
      vel = 0;
      lastT = 0;
      lastPos = 0;
    };

    const swiper = new Swiper(el, {
      modules: [Virtual, Zoom],
      virtual: {
        slides: photos,
        cache: true,
        // Minimal buffer (±1): at most 3 slides in the DOM → 3 textures at
        // most when the track is rasterized. The neighbor loads with enough
        // lead time and the DOM is recycled without flicker.
        addSlidesBefore: 1,
        addSlidesAfter: 1,
        renderSlide,
      },
      slidesPerView: 1,
      speed: 260,
      threshold: 10,
      longSwipesRatio: 0.3,
      resistance: true,
      resistanceRatio: 0.85,
      touchStartPreventDefault: false,
      touchMoveStopPropagation: true,
      passiveListeners: true,
      zoom: {
        maxRatio: 4,
        minRatio: 1,
        toggle: true,
      },
      on: {
        touchStart: resetVel,
        setTranslate: (s) => {
          const now = performance.now();
          const dt = now - lastT;
          if (dt > 0 && lastT !== 0) {
            const inst = (s.translate - lastPos) / dt;
            vel = vel === 0 ? inst : vel * 0.7 + inst * 0.3;
          }
          lastT = now;
          lastPos = s.translate;
        },
        /* Fires just BEFORE the landing decision (slideTo):
           adjusting `speed` here ties the duration to the finger's actual
           velocity at release. */
        touchEnd: (s) => {
          if (s.zoom && s.zoom.scale > 1) return;
          const v = Math.abs(vel);
          const w = s.el.clientWidth || 400;
          s.params.speed = Math.round(clamp(w / Math.max(v, 0.35), 120, 320));
        },
        slideChangeTransitionEnd: (s) => {
          s.params.speed = 260;
          upgradeActiveSlide();
        },
        slideChange: (s) => onIndexChangeRef.current?.(s.activeIndex),
        tap: () => onTapRef.current?.(),
      },
    });
    swiperRef.current = swiper;

    const start = Math.max(0, Math.min(initialIndex, photos.length - 1));
    if (start > 0) swiper.slideTo(start, 0, false);
    upgradeActiveSlide();

    return () => {
      swiper.destroy(true, true);
      swiperRef.current = null;
    };
  }, [photos]);

  /* Syncs the index when it changes externally (arrows, menu, etc.):
     instant jump, WITHOUT destroying the carousel (the transition in
     progress is never interrupted → no flicker). */
  useEffect(() => {
    const swiper = swiperRef.current;
    if (!swiper) return;
    const target = Math.max(0, Math.min(initialIndex, photos.length - 1));
    if (swiper.realIndex !== target) {
      swiper.slideTo(target, 0, false);
    }
  }, [initialIndex, photos.length]);

  return (
    <div ref={containerRef} className={`swiper gallery-swiper ${className ?? ""}`}>
      <div className="swiper-wrapper" />
    </div>
  );
}