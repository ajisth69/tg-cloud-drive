import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo } from "react";
import type { DriveFile, DriveConfig } from "../../types";
import type { TelegramClient } from "@mtcute/web";
import { formatBytes } from "../../lib/manifest";
import { findAdjacentPreviewable, isImageFile, isVideoFile, isPreviewableFile } from "../../lib/manifest";
import { hasNativePlayer, playFileWithNativePlayer } from "../../lib/nativePlayer";
import { registerBackHandler } from "../../lib/back";
import { FileIcon } from "./FileIcon";
import { FileCardThumbnail, getFileCoverUrl, getCachedThumbUrl } from "./FileCardThumbnail";
import { ActionSheet } from "../ui/ActionSheet";
import { Modal } from "../ui/Modal";
import SwiperGallery from "./preview-viewer/SwiperGallery";
import { Capacitor } from "@capacitor/core";
import { syncInsets } from "../../hooks/useSafeInsets";

/**
 * Immersive mode: hides the Android StatusBar + NavigationBar with the native
 * ImmersiveMode plugin (edge-to-edge + WindowInsetsController, anti-flash).
 *
 * NOT using @capacitor/status-bar or @capacitor-community/navigation-bar:
 * their hide() use legacy flags that Android 15+ (targetSdk 35) ignores and,
 * without edge-to-edge, they force a WebView resize → white flash. The native
 * plugin paints the bars transparent and the decor black BEFORE hiding, so
 * SystemUI never shows the light window_background (#FBF8FF).
 */
let immersivePending: Promise<void> = Promise.resolve();

async function toggleImmersiveMode(hide: boolean): Promise<void> {
  immersivePending = immersivePending.then(async () => {
    try {
      const plugin = (Capacitor as any)?.Plugins?.ImmersiveMode;
      if (hide) {
        await plugin?.hide?.();
      } else {
        await plugin?.show?.();
      }
    } catch {}
    // Re-sync insets after system bars settle
    setTimeout(syncInsets, 300);
    setTimeout(syncInsets, 700);
  });
  return immersivePending;
}

/** Viewer open: opaque black bars (they blend with the dark header). */
async function setPreviewBars(): Promise<void> {
  try {
    await (Capacitor as any)?.Plugins?.ImmersiveMode?.preview?.();
  } catch (e) {
    console.warn("Preview bars not supported:", e);
  }
}

/** Viewer closed: restore the dashboard's light colors. */
async function restoreBars(): Promise<void> {
  try {
    await (Capacitor as any)?.Plugins?.ImmersiveMode?.restore?.();
  } catch (e) {
    console.warn("Restore bars not supported:", e);
  }
}

function GalleryMediaSlot({
  f,
  url,
  isCurrent,
  imageElRef,
  zoom,
  panOffset,
  rotation,
  isPanning,
  isPinching,
  imageLoaded,
  onImageLoad,
  onImagePrefetch,
}: {
  f: DriveFile;
  url?: string | null;
  isCurrent?: boolean;
  imageElRef?: React.RefObject<HTMLImageElement | null>;
  zoom?: number;
  panOffset?: { x: number; y: number };
  rotation?: number;
  isPanning?: boolean;
  isPinching?: boolean;
  imageLoaded?: boolean;
  onImageLoad?: () => void;
  onImagePrefetch?: (id: string, el: HTMLImageElement) => void;
}) {
  const common = "max-w-full max-h-full object-contain select-none";
  if (isVideoFile(f)) {
    return <video src={`/stream/${f.id}`} muted playsInline preload="auto" className={common} draggable={false} />;
  }
  if (isImageFile(f)) {
    return (
      <img
        ref={isCurrent ? imageElRef : undefined}
        src={`/stream/${f.id}`}
        alt={isCurrent ? f.name : ""}
        loading="eager"
        decoding="async"
        onLoad={(e) => {
          if (isCurrent) onImageLoad?.();
          else onImagePrefetch?.(String(f.id), e.currentTarget);
        }}
        className={common}
        style={
          isCurrent
            ? {
                transform: `translate(${panOffset?.x ?? 0}px, ${panOffset?.y ?? 0}px) scale(${zoom ?? 1}) rotate(${rotation ?? 0}deg)`,
                transition: isPanning || isPinching ? "none" : "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)",
                opacity: imageLoaded ? 1 : 0,
              }
            : undefined
        }
        draggable={false}
      />
    );
  }
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-8 w-full max-w-[240px] text-center select-none">
      <FileIcon fileName={f.name} className="w-10 h-10" />
      <p className="text-white/90 font-semibold text-sm truncate w-full">{f.name}</p>
      <p className="text-white/40 text-[10px] font-medium">{formatBytes(f.size)}</p>
    </div>
  );
}

function VideoPlayerView({
  f,
  url,
  isCurrent,
  client,
  driveConfig,
  ext = "",
  videoRef,
  ogvContainerRef,
  videoContainerRef,
  videoError = null,
  useOgv = false,
  immersive = false,
  videoPlaying = false,
  buffering = false,
  controlsVisible = false,
  videoTime = 0,
  videoDuration = 0,
  videoBuffered = 0,
  videoMuted = false,
  videoVolume = 1,
  playbackSpeed = 1,
  showSpeedMenu = false,
  seekTooltip = null,
  isFullscreen = false,
  onDownload,
  onNativePlay,
  nativePlayProgress = null,
  canNativePlay = false,
  onMouseMove,
  onImmersiveTap,
  onPlay,
  onPause,
  onTimeUpdate,
  onLoadedMetadata,
  onLoadedData,
  onCanPlay,
  onCanPlayThrough,
  onSeeking,
  onSeeked,
  onWaiting,
  onPlaying,
  onError,
  onSeek,
  onSeekTooltip,
  onSeekTooltipLeave,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
  onToggleSpeedMenu,
  onSpeedSelect,
  onTogglePiP,
  onToggleFullscreen,
}: {
  f: DriveFile;
  url?: string | null;
  isCurrent: boolean;
  client?: TelegramClient | null;
  driveConfig?: DriveConfig | null;
  ext?: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ogvContainerRef: React.RefObject<HTMLDivElement | null>;
  videoContainerRef: React.RefObject<HTMLDivElement | null>;
  videoError?: string | null;
  useOgv?: boolean;
  immersive?: boolean;
  videoPlaying?: boolean;
  buffering?: boolean;
  controlsVisible?: boolean;
  videoTime?: number;
  videoDuration?: number;
  videoBuffered?: number;
  videoMuted?: boolean;
  videoVolume?: number;
  playbackSpeed?: number;
  showSpeedMenu?: boolean;
  seekTooltip?: { x: number; time: string } | null;
  isFullscreen?: boolean;
  onDownload?: () => void;
  onNativePlay?: () => void;
  nativePlayProgress?: number | null;
  canNativePlay?: boolean;
  onMouseMove: () => void;
  onImmersiveTap: (e: React.MouseEvent<HTMLDivElement>) => void;
  onPlay: () => void;
  onPause: () => void;
  onTimeUpdate?: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  onLoadedMetadata: () => void;
  onLoadedData: () => void;
  onCanPlay: () => void;
  onCanPlayThrough: () => void;
  onSeeking: () => void;
  onSeeked: () => void;
  onWaiting: () => void;
  onPlaying: () => void;
  onError: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  onSeek: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSeekTooltip: (e: React.MouseEvent<HTMLInputElement>) => void;
  onSeekTooltipLeave: () => void;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onVolumeChange: (v: number) => void;
  onToggleSpeedMenu: () => void;
  onSpeedSelect: (s: number) => void;
  onTogglePiP: () => void;
  onToggleFullscreen: () => void;
}) {
  const lastTapRef = useRef<{ t: number; side: -1 | 0 | 1 } | null>(null);
  const seekTimerRef = useRef<number | null>(null);
  const [seekIndicator, setSeekIndicator] = useState<{ side: -1 | 1; time: string } | null>(null);

  // First-frame poster: shown while the video loads, so the play symbol
  // alone is not seen over black.
  const [posterUrl, setPosterUrl] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(false);
  useEffect(() => {
    if (videoPlaying) setHasStarted(true);
  }, [videoPlaying]);
  useEffect(() => {
    let active = true;
    if (!isCurrent || !client || !driveConfig || videoError || useOgv) {
      setPosterUrl(null);
      return;
    }
    getFileCoverUrl(f, client, driveConfig).then((url) => {
      if (active) setPosterUrl(url);
    });
    return () => {
      active = false;
    };
  }, [isCurrent, f, client, driveConfig, videoError, useOgv]);

  useEffect(() => {
    return () => {
      if (seekTimerRef.current) window.clearTimeout(seekTimerRef.current);
    };
  }, []);

  const handleRootTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t !== e.currentTarget && t.tagName !== "VIDEO" && !t.closest(".ogv-surface")) return;
    if (t.closest("button, input, select")) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const side: -1 | 0 | 1 =
      e.clientX < rect.left + rect.width / 3 ? -1 : e.clientX > rect.right - rect.width / 3 ? 1 : 0;
    const now = Date.now();
    const last = lastTapRef.current;
    const isDouble = !!last && now - last.t < 300 && last.side === side;
    lastTapRef.current = { t: now, side };
    if (isDouble) {
      if (side === 0) {
        onTogglePlay();
      } else {
        const v = videoRef.current;
        if (v) {
          const target = Math.min(v.duration || 0, Math.max(0, v.currentTime + side * 10));
          v.currentTime = target;
          setSeekIndicator({ side, time: formatTime(target) });
          if (seekTimerRef.current) window.clearTimeout(seekTimerRef.current);
          seekTimerRef.current = window.setTimeout(() => setSeekIndicator(null), 900);
        }
      }
      return;
    }
    onImmersiveTap(e);
  };

  return (
    <div
      ref={isCurrent ? videoContainerRef : undefined}
      className="relative w-full h-full flex items-center justify-center bg-black group/video"
      onMouseMove={isCurrent ? onMouseMove : undefined}
      onClick={isCurrent ? handleRootTap : undefined}
    >
      {isCurrent && videoError ? (
        <div className="flex flex-col items-center justify-center text-center p-8 max-w-md bg-black/70 rounded-3xl border border-white/10 shadow-2xl animate-spring-in">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/20 text-purple-400 flex items-center justify-center mb-4 border border-purple-500/30 shadow-lg">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-white mb-1">Cannot Play .{ext.toUpperCase()} Inline</h3>
          <p className="text-xs text-white/60 mb-6 leading-relaxed">
            {videoError}
          </p>
          {onNativePlay && canNativePlay ? (
            nativePlayProgress === null || nativePlayProgress === undefined ? (
              <button
                onClick={(e) => { e.stopPropagation(); onNativePlay(); }}
                className="px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-medium text-sm flex items-center gap-2 transition-all shadow-lg cursor-pointer active:scale-95"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Play with Native Player
              </button>
            ) : (
              <div className="w-64">
                <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
                    style={{ width: `${Math.round(nativePlayProgress * 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-white/50 mt-2">
                  Downloading to native player… {Math.round(nativePlayProgress * 100)}%
                </p>
              </div>
            )
          ) : onDownload && (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload(); }}
              className="px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-400 text-white font-medium text-sm flex items-center gap-2 transition-all shadow-lg cursor-pointer active:scale-95"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download Video ({formatBytes(f.size)})
            </button>
          )}
        </div>
      ) : isCurrent && useOgv ? (
        <div className="relative w-full h-full flex items-center justify-center select-none">
          {!hasStarted && posterUrl && (
            <img src={posterUrl} alt="" className="absolute inset-0 w-full h-full object-contain pointer-events-none" />
          )}
          <div ref={ogvContainerRef} className="ogv-surface w-full h-full flex items-center justify-center select-none" />
        </div>
      ) : (
        <>
          <video
            ref={isCurrent ? videoRef : undefined}
            src={isCurrent ? (url || undefined) : `/stream/${f.id}`}
            poster={posterUrl || undefined}
            autoPlay={isCurrent}
            muted={!isCurrent}
            playsInline
            /* Only the active video downloads/decodes: neighbors with
               preload="none" keep the swipe from competing with 3 streams at
               once (memory + decode) → maximum smoothness. */
            preload={isCurrent ? "auto" : "none"}
            onPlay={isCurrent ? onPlay : undefined}
            onPause={isCurrent ? onPause : undefined}
            onTimeUpdate={isCurrent ? onTimeUpdate : undefined}
            onLoadedMetadata={isCurrent ? onLoadedMetadata : undefined}
            onLoadedData={isCurrent ? onLoadedData : undefined}
            onCanPlay={isCurrent ? onCanPlay : undefined}
            onCanPlayThrough={isCurrent ? onCanPlayThrough : undefined}
            onSeeking={isCurrent ? onSeeking : undefined}
            onSeeked={isCurrent ? onSeeked : undefined}
            onWaiting={isCurrent ? onWaiting : undefined}
            onPlaying={isCurrent ? onPlaying : undefined}
            onError={isCurrent ? onError : undefined}
            className="max-w-full max-h-full object-contain"
          />

          {/* Big center play/pause button — always visible outside immersive
              mode (play/pause icon depending on state); in immersive it hides
              for a clean view and returns when exiting. */}
          {isCurrent && !immersive && !buffering && (
            <button
              onClick={(e) => { e.stopPropagation(); onTogglePlay(); }}
              className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-black/60 border border-white/10 text-white flex items-center justify-center transition-all duration-300 hover:bg-black/70 active:scale-90 animate-spring-in cursor-pointer shadow-[0_8px_40px_rgba(0,0,0,0.5)]"
            >
              {videoPlaying ? (
                <svg className="w-8 h-8 text-white/90" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
              ) : (
                <svg className="w-9 h-9 ml-1 text-white/90" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
          )}

          {/* Buffering spinner */}
          {isCurrent && buffering && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-11 h-11 rounded-full bg-black/70 flex items-center justify-center">
                <svg className="animate-spin h-5 w-5 text-white/80" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={2} className="opacity-15" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-70" />
                </svg>
              </div>
            </div>
          )}

          {/* Double-tap seek indicator */}
          {isCurrent && seekIndicator && (
            <div
              key={seekIndicator.side}
              className={`absolute top-1/2 -translate-y-1/2 flex flex-col items-center gap-2.5 pointer-events-none animate-spring-in ${seekIndicator.side === -1 ? "left-[14%]" : "right-[14%]"}`}
            >
              <div className="w-14 h-14 rounded-full bg-black/70 border border-white/10 flex items-center justify-center shadow-2xl">
                {seekIndicator.side === -1 ? (
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" /></svg>
                ) : (
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" /></svg>
                )}
              </div>
              <span className="text-[11px] font-mono font-bold text-white bg-black/70 rounded-full px-2.5 py-1">
                {seekIndicator.side === -1 ? "-10s" : "+10s"} · {seekIndicator.time}
              </span>
            </div>
          )}

          {/* ─── Minimal Controls Bar ─── */}
          {isCurrent && (
            <div
              className={`absolute bottom-0 left-0 right-0 preview-controls-bar px-4 sm:px-5 pt-14 transition-all duration-300 ${controlsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"}`}
              style={{ paddingBottom: "calc(1rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))" }}
            >
              {/* Seek bar */}
              <div className="relative w-full mb-3.5 group/seek h-5 flex items-center">
                <div className="relative w-full h-[3px] rounded-full bg-white/10">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-white/15" style={{ width: `${videoDuration > 0 ? (videoBuffered / videoDuration) * 100 : 0}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-brand-400" style={{ width: `${videoDuration > 0 ? (videoTime / videoDuration) * 100 : 0}%` }} />
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.4)] opacity-60 group-hover/seek:opacity-100 transition-opacity duration-200"
                    style={{ left: `calc(${videoDuration > 0 ? (videoTime / videoDuration) * 100 : 0}% - 6px)` }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={videoDuration || 100}
                  step={0.1}
                  value={videoTime}
                  onChange={onSeek}
                  onMouseMove={onSeekTooltip}
                  onMouseLeave={onSeekTooltipLeave}
                  onClick={(e) => e.stopPropagation()}
                  className="range-native absolute inset-0 w-full h-5 opacity-0 cursor-pointer"
                />
                {/* Seek time tooltip */}
                {seekTooltip && (
                  <div
                    className="absolute -top-9 bg-black/80 text-white text-[10px] font-mono font-bold px-2 py-1 rounded-md pointer-events-none"
                    style={{ left: `${seekTooltip.x}px`, transform: "translateX(-50%)" }}
                  >
                    {seekTooltip.time}
                  </div>
                )}
              </div>

              {/* Controls row */}
              <div className="flex items-center gap-1 sm:gap-1.5 select-none">
                {/* Time */}
                <span className="text-[11px] font-mono tabular-nums text-white/80 pl-1 pr-2">
                  {formatTime(videoTime)}
                  <span className="text-white/35"> / {formatTime(videoDuration)}</span>
                </span>

                <div className="flex-1" />

                {/* Play/Pause */}
                <button onClick={(e) => { e.stopPropagation(); onTogglePlay(); }} className="w-9 h-9 rounded-full hover:bg-white/10 text-white/80 hover:text-white flex items-center justify-center transition-all cursor-pointer active:scale-90" title={videoPlaying ? "Pause (K)" : "Play (K)"}>
                  {videoPlaying ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16M17 4v16" /></svg>
                  ) : (
                    <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                  )}
                </button>

                {/* Volume */}
                <div className="hidden sm:flex items-center gap-1.5 group/vol">
                  <button onClick={(e) => { e.stopPropagation(); onToggleMute(); }} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer" title="Mute (M)">
                    {videoMuted || videoVolume === 0 ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={videoMuted ? 0 : videoVolume}
                    onChange={(e) => { e.stopPropagation(); onVolumeChange(parseFloat(e.target.value)); }}
                    onClick={(e) => e.stopPropagation()}
                    className="range-native range-volume w-16 opacity-0 group-hover/vol:opacity-100 transition-opacity duration-200"
                  />
                </div>

                {/* More options (3 dots): speed + loop, via ActionSheet */}
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); onToggleSpeedMenu(); }} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer" title="Playback options">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                    </svg>
                  </button>
                </div>

                {/* PiP */}
                {"pictureInPictureEnabled" in document && (
                  <button onClick={(e) => { e.stopPropagation(); onTogglePiP(); }} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer hidden sm:flex" title="Picture-in-Picture">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><rect x="2" y="3" width="20" height="14" rx="2" /><rect x="11" y="9" width="9" height="7" rx="1" fill="currentColor" opacity="0.3" /><rect x="11" y="9" width="9" height="7" rx="1" /></svg>
                  </button>
                )}

                {/* Fullscreen */}
                <button onClick={(e) => { e.stopPropagation(); onToggleFullscreen(); }} className="w-8 h-8 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all cursor-pointer" title="Fullscreen (F)">
                  {isFullscreen ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* Memoized: the neighbor players (isCurrent=false) have stable props and
   must not re-render when the modal re-renders from the videoTime ticks
   (which only affect the active one). Less reconciliation → fluid swipe. */
const MemoVideoPlayerView = memo(VideoPlayerView);

type SheetCell = string | number | boolean | Date | null | undefined;
type SheetRow = SheetCell[];

interface XlsxWorkbook {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}

interface XlsxApi {
  read(data: Uint8Array, options: { type: "array" }): XlsxWorkbook;
  utils: {
    sheet_to_json(sheet: unknown, options: { header: 1; defval: string }): SheetRow[];
  };
}

interface DocxPreviewApi {
  renderAsync(
    blob: Blob,
    container: HTMLElement,
    styleContainer: HTMLElement | null,
    options: {
      className: string;
      inWrapper: boolean;
      ignoreWidth: boolean;
      ignoreHeight: boolean;
    }
  ): Promise<void>;
}

declare global {
  interface Window {
    XLSX?: XlsxApi;
    docx?: DocxPreviewApi;
    ePub?: any;
  }
}

class BiquadFilter {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
  x1 = 0; x2 = 0;
  y1 = 0; y2 = 0;

  constructor(cutoff: number, sampleRate: number) {
    const ff = Math.min(0.45, cutoff / sampleRate);
    const ita = 1.0 / Math.tan(Math.PI * ff);
    const q = Math.sqrt(2.0);
    const den = 1.0 + q * ita + ita * ita;
    this.b0 = 1.0 / den;
    this.b1 = 2.0 / den;
    this.b2 = 1.0 / den;
    this.a1 = 2.0 * (1.0 - ita * ita) / den;
    this.a2 = (1.0 - q * ita + ita * ita) / den;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function decodeDsfToWav(arrayBuffer: ArrayBuffer): Blob | null {
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0, true) !== 0x20445344) { // "DSD "
    return null;
  }
  
  let offset = 28;
  let sampleRate = 2822400;
  let channels = 2;
  let blockSize = 4096;
  let dataOffset = 0;
  let dataSize = 0;
  
  while (offset < arrayBuffer.byteLength - 12) {
    const chunkHeader = view.getUint32(offset, true);
    const chunkSize = Number(view.getBigUint64(offset + 4, true));
    
    if (chunkHeader === 0x20746d66) { // "fmt "
      channels = view.getUint32(offset + 24, true);
      sampleRate = view.getUint32(offset + 28, true);
      if (chunkSize >= 48) {
        blockSize = view.getUint32(offset + 44, true);
      }
    } else if (chunkHeader === 0x61746164) { // "data"
      dataOffset = offset + 12;
      dataSize = chunkSize - 12;
      break;
    }
    offset += chunkSize;
  }
  
  if (dataOffset === 0 || dataSize === 0) return null;
  
  const dsdData = new Uint8Array(arrayBuffer, dataOffset, dataSize);
  const groupSize = blockSize * channels;
  const numGroups = Math.floor(dataSize / groupSize);
  
  const samplesPerChannelPerGroup = blockSize / 8;
  const numOutputSamples = numGroups * samplesPerChannelPerGroup;
  
  const pcmData = new Float32Array(numOutputSamples * channels);
  const wavSampleRate = sampleRate / 64;
  
  const lpFilters = Array.from({ length: channels }, () => new BiquadFilter(16000, wavSampleRate));

  let pcmIdx = 0;
  for (let g = 0; g < numGroups; g++) {
    const groupStart = g * groupSize;
    for (let s = 0; s < samplesPerChannelPerGroup; s++) {
      for (let c = 0; c < channels; c++) {
        const channelByteOffset = groupStart + (c * blockSize) + (s * 8);
        let onesCount = 0;
        for (let b = 0; b < 8; b++) {
          let temp = dsdData[channelByteOffset + b];
          while (temp > 0) {
            onesCount += temp & 1;
            temp >>= 1;
          }
        }
        const pcmVal = (onesCount / 32) - 1.0;
        pcmData[pcmIdx + c] = lpFilters[c].process(pcmVal);
      }
      pcmIdx += channels;
    }
  }
  
  const wavHeader = new ArrayBuffer(44);
  const wavView = new DataView(wavHeader);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  const wavByteRate = wavSampleRate * channels * 2;
  const wavBlockAlign = channels * 2;

  writeString(wavView, 0, 'RIFF');
  wavView.setUint32(4, 36 + numOutputSamples * channels * 2, true);
  writeString(wavView, 8, 'WAVE');
  writeString(wavView, 12, 'fmt ');
  wavView.setUint32(16, 16, true);
  wavView.setUint16(20, 1, true);
  wavView.setUint16(22, channels, true);
  wavView.setUint32(24, wavSampleRate, true);
  wavView.setUint32(28, wavByteRate, true);
  wavView.setUint16(32, wavBlockAlign, true);
  wavView.setUint16(34, 16, true);
  writeString(wavView, 36, 'data');
  wavView.setUint32(40, numOutputSamples * channels * 2, true);
  
  const outputBuffer = new Uint8Array(wavHeader.byteLength + numOutputSamples * channels * 2);
  outputBuffer.set(new Uint8Array(wavHeader), 0);
  
  const outView = new DataView(outputBuffer.buffer);
  let outOffset = 44;
  for (let i = 0; i < pcmData.length; i++) {
    const pcmSample = Math.max(-32768, Math.min(32767, pcmData[i] * 32767));
    outView.setInt16(outOffset, pcmSample, true);
    outOffset += 2;
  }
  
  return new Blob([outputBuffer], { type: "audio/wav" });
}

interface PreviewModalProps {
  file: DriveFile;
  url: string | null;
  progress?: number | null;
  error?: string | null;
  onDownload?: () => void | Promise<void>;
  onClose: () => void;
  isLiked?: boolean;
  onToggleLike?: () => void;
  onOpenMoveCopy?: () => void;
  onNavigate?: (dir: 1 | -1, fromSwipe?: boolean) => void;
  navDir?: "left" | "right" | null;
  files?: DriveFile[];
  fromSwipe?: boolean;
  client?: TelegramClient | null;
  driveConfig?: DriveConfig | null;
}

/* ═══════════════════════════════════════════════════════════
   UTILITY HELPERS
   ═══════════════════════════════════════════════════════════ */

function formatTime(time: number) {
  if (isNaN(time) || !isFinite(time)) return "0:00";
  const hrs = Math.floor(time / 3600);
  const mins = Math.floor((time % 3600) / 60);
  const secs = Math.floor(time % 60);
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export function PreviewModal({
  file,
  url,
  progress,
  error,
  onDownload,
  onClose,
  isLiked = false,
  onToggleLike,
  onOpenMoveCopy,
  onNavigate,
  navDir,
  files,
  fromSwipe = false,
  client,
  driveConfig,
}: PreviewModalProps) {
  // ─── Core modal state ───
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);

  useEffect(() => {
    closingRef.current = closing;
  }, [closing]);

  // ─── Image state ───
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0, iw: 0, ih: 0, cw: 0, ch: 0 });
  const imageContainerRef = useRef<HTMLDivElement | null>(null);
  const [rotation, setRotation] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [dragX, setDragX] = useState(0);
  /* Swipe gesture in progress (drag + landing): while active, the periodic
     video updates (time/progress/controls) are frozen because they re-render
     the modal and would overwrite the track's direct writes (transform),
     causing the "pull-back" that looks like lag. */
  const [gestureActive, setGestureActive] = useState(false);
  const gestureActiveRef = useRef(false);
  /* Images already painted in the track's neighbor slots (video↔image):
     they are adopted by the SwiperGallery on navigation → no flicker. */
  const prefetchedImagesRef = useRef(new Map<string, HTMLImageElement>());
  const handleImagePrefetch = useCallback((id: string, el: HTMLImageElement) => {
    const map = prefetchedImagesRef.current;
    if (map.size >= 4) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(id, el);
  }, []);

  const [swipeOutDir, setSwipeOutDir] = useState<1 | -1 | null>(null);
  const [isPinching, setIsPinching] = useState(false);
  const imageElRef = useRef<HTMLImageElement | null>(null);
  const currentWrapperRef = useRef<HTMLDivElement | null>(null);
  const prevWrapperRef = useRef<HTMLDivElement | null>(null);
  const nextWrapperRef = useRef<HTMLDivElement | null>(null);
  const dragXRef = useRef(0);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const rotationRef = useRef(0);
  const lastSwipeEndRef = useRef(0);
  useEffect(() => {
    zoomRef.current = zoom;
    panRef.current = panOffset;
    rotationRef.current = rotation;
    dragXRef.current = dragX;
  }, [zoom, panOffset, rotation, dragX]);
  const swipeVelRef = useRef({ vx: 0, lastX: 0, lastT: 0 });
  /* Track landing animation via rAF (GPU, zero re-renders). */
  const settleRafRef = useRef<number | null>(null);
  const settleRef = useRef<{ from: number; to: number; dur: number; onDone: (() => void) | null } | null>(null);
  useEffect(
    () => () => {
      if (settleRafRef.current !== null) cancelAnimationFrame(settleRafRef.current);
    },
    []
  );

  const trackSwipeVelocity = useCallback((clientX: number) => {
    const v = swipeVelRef.current;
    const now = performance.now();
    const dt = now - v.lastT;
    if (dt > 0 && v.lastT !== 0) {
      const inst = (clientX - v.lastX) / dt;
      v.vx = v.vx === 0 ? inst : v.vx * 0.7 + inst * 0.3;
    }
    v.lastX = clientX;
    v.lastT = now;
  }, []);

  useLayoutEffect(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setRotation(0);
    setDragX(0);
    setSwipeOutDir(null);
    setShowPreviewMenu(false);
    setShowFileInfo(false);
    const imgEl = imageElRef.current;
    setImageLoaded(!!imgEl && imgEl.complete && imgEl.naturalWidth > 0);
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
  }, [file.id]);

  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const pinchStartRef = useRef<{ dist: number; zoom: number; midX: number; midY: number; pan: { x: number; y: number }; rectLeft: number; rectTop: number; cw: number; ch: number; iw: number; ih: number } | null>(null);
  const swipeFiredRef = useRef(false);
  const edgeExceedRef = useRef(0);
  const panEngagedRef = useRef(false);
  const panCandidateRef = useRef<{ x: number; y: number; ox: number; oy: number; iw: number; ih: number; cw: number; ch: number } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const suppressDblClickUntilRef = useRef(0);
  const zoomAnimRef = useRef<number | null>(null);
  const animStateRef = useRef<{ z: number; pan: { x: number; y: number } } | null>(null);

  // ─── Video state ───
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  /* The user paused manually: autoplay/retries MUST NOT revive a video the
     user stopped (persists across files). */
  const userPausedRef = useRef(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoTime, setVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoBuffered, setVideoBuffered] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [videoVolume, setVideoVolume] = useState(1);
  const [videoMuted, setVideoMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [videoLoop, setVideoLoop] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [seekTooltip, setSeekTooltip] = useState<{ x: number; time: string } | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const ogvPlayerRef = useRef<any>(null);
  const ogvContainerRef = useRef<HTMLDivElement | null>(null);
  const [useOgv, setUseOgv] = useState(false);
  const [ogvLoading, setOgvLoading] = useState(false);

  // ─── Audio state ───
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioVolume, setAudioVolume] = useState(1);
  const [audioSpeed, setAudioSpeed] = useState(1);

  // ─── Text preview state ───
  const [textContent, setTextContent] = useState<string | null>(null);

  // ─── Excel / Spreadsheet state ───
  const [sheetData, setSheetData] = useState<SheetRow[] | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [workbookRef, setWorkbookRef] = useState<XlsxWorkbook | null>(null);

  // ─── Word docx state ───
  const [loadingDocx, setLoadingDocx] = useState(false);
  const docxContainerRef = useRef<HTMLDivElement | null>(null);

  // ─── DSD state ───
  const [dsdDecodedUrl, setDsdDecodedUrl] = useState<string | null>(null);
  const [dsdLoading, setDsdLoading] = useState(false);
  const [dsdError, setDsdError] = useState<string | null>(null);

  // ─── Audio visualizer refs ───
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  // ─── EPUB state ───
  const [loadingEpub, setLoadingEpub] = useState(false);
  const [epubError, setEpubError] = useState<string | null>(null);
  const epubContainerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<any>(null);
  const [epubToc, setEpubToc] = useState<any[]>([]);
  const [epubCurrentChapterRef, setEpubCurrentChapterRef] = useState<string>("");
  const [epubProgress, setEpubProgress] = useState<string>("0%");
  const [epubTheme, setEpubTheme] = useState<string>("dark"); // "dark" | "light" | "sepia" | "cream"
  const [epubFontSize, setEpubFontSize] = useState<number>(100);

  // ─── File info popover ───
  const [showFileInfo, setShowFileInfo] = useState(false);

  // ─── Header action menu ───
  const [showPreviewMenu, setShowPreviewMenu] = useState(false);

  /* ═══════════════════════════════════════════════════════
     FILE TYPE DETECTION
     ═══════════════════════════════════════════════════════ */

  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const mimeType = file.mimeType || "";

  const isImage = mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
  const isVideo = mimeType.startsWith("video/") || ["mp4", "webm", "ogg", "mov", "mkv", "avi", "3gp", "flv"].includes(ext);
  const isAudio = mimeType.startsWith("audio/") || ["mp3", "wav", "ogg", "m4a", "flac", "dsf", "dff", "opus", "oga", "caf", "aac"].includes(ext);
  const isText = ["txt", "md", "json", "js", "ts", "py", "rs", "go", "html", "css", "xml"].includes(ext);
  const isPdf = mimeType === "application/pdf" || ext === "pdf";
  const isDocx = ext === "docx";
  const isSheet = ["xlsx", "xls", "csv"].includes(ext);
  const isEpub = ext === "epub";
  const isDsdFile = ["dsf", "dff"].includes(ext);
  const isDsd = false; // Decoded on-the-fly inside the streaming pipeline

  /* ═══════════════════════════════════════════════════════
     CLOSE HANDLER
     ═══════════════════════════════════════════════════════ */

  const handleClose = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
    if (videoRef.current) videoRef.current.pause();
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
    }
    setClosing(true);
    setTimeout(onClose, 280);
  }, [onClose]);

  // Hardware/gesture back closes the preview (topmost layer while open)
  const handleCloseRef = useRef(handleClose);
  useEffect(() => {
    handleCloseRef.current = handleClose;
  }, [handleClose]);

  useEffect(() => {
    return registerBackHandler(() => {
      if (closingRef.current) return false;
      handleCloseRef.current();
      return true;
    }, 100);
  }, []);

  // Lock body scroll and cleanup audio context / timers
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
      if (controlsTimer.current) {
        clearTimeout(controlsTimer.current);
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        try {
          audioCtxRef.current.close();
        } catch {}
        audioCtxRef.current = null;
      }
      analyserRef.current = null;
      sourceRef.current = null;
    };
  }, [file.id, url]);

  // Concentric Circles Audio Visualizer Loop
  useEffect(() => {
    if (!isAudio) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let phase = 0;
    let scale = 1.0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const w = canvas.width / window.devicePixelRatio;
      const h = canvas.height / window.devicePixelRatio;
      ctx.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;

      if (audioPlaying) {
        phase += 0.04;
        scale = scale * 0.95 + 1.15 * 0.05;
      } else {
        phase += 0.005;
        scale = scale * 0.95 + 1.0 * 0.05;
      }

      // Draw glowing waves concentric layers
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const radius = (w * 0.3) + i * 14 * scale;
        const opacity = (0.16 - i * 0.045) * (audioPlaying ? 1.4 : 0.6);
        
        ctx.strokeStyle = `rgba(6, 182, 212, ${opacity})`;
        ctx.lineWidth = i === 0 ? 3 : 1.5;
        
        const points = 72;
        for (let p = 0; p <= points; p++) {
          const angle = (p / points) * Math.PI * 2;
          const waveAmp = audioPlaying 
            ? (5 + Math.sin(angle * 7 + phase * 2.2) * 4) 
            : Math.sin(angle * 4 + phase) * 0.5;
          const r = radius + waveAmp;
          const x = cx + Math.cos(angle) * r;
          const y = cy + Math.sin(angle) * r;
          if (p === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }

      animationFrameId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
    };
  }, [isAudio, audioPlaying]);

  /* ═══════════════════════════════════════════════════════
     IMAGE: ZOOM & PAN
     ═══════════════════════════════════════════════════════ */

  const clampPanOffset = useCallback((x: number, y: number, z: number) => {
    if (z <= 1) return { x: 0, y: 0 };
    const el = imageContainerRef.current;
    if (!el) return { x, y };
    const rect = el.getBoundingClientRect();
    const img = imageElRef.current;
    const iw = img ? img.getBoundingClientRect().width : rect.width;
    const ih = img ? img.getBoundingClientRect().height : rect.height;
    const maxX = Math.max(0, (iw * z - rect.width) / 2);
    const maxY = Math.max(0, (ih * z - rect.height) / 2);
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  const applyDragTransform = useCallback((px: number) => {
    if (currentWrapperRef.current) {
      currentWrapperRef.current.style.transform = `translateX(${px}px)`;
      currentWrapperRef.current.style.transition = "none";
    }
    if (prevWrapperRef.current) {
      prevWrapperRef.current.style.transform = `translateX(calc(-100% + ${px}px))`;
      prevWrapperRef.current.style.transition = "none";
    }
    if (nextWrapperRef.current) {
      nextWrapperRef.current.style.transform = `translateX(calc(100% + ${px}px))`;
      nextWrapperRef.current.style.transition = "none";
    }
  }, []);

  /* Lands the track with a duration dictated by the release velocity:
     dur = distance / |vel| (bounded) + easeOutCubic → smooth deceleration.
     Fast → short and energetic; slow → long and gentle. All via rAF with
     direct DOM writes (zero React re-renders per frame). */
  const animateSettle = useCallback(
    (from: number, to: number, vel: number, onDone: (() => void) | null) => {
      if (settleRafRef.current !== null) cancelAnimationFrame(settleRafRef.current);
      const dist = Math.abs(to - from);
      const dur = clamp(dist / Math.max(Math.abs(vel), 0.35), 120, 340);
      settleRef.current = { from, to, dur, onDone };
      const start = performance.now();
      const step = (now: number) => {
        const s = settleRef.current;
        if (!s) return;
        const t = Math.min((now - start) / s.dur, 1);
        const k = 1 - Math.pow(1 - t, 3);
        const px = s.from + (s.to - s.from) * k;
        dragXRef.current = px;
        applyDragTransform(px);
        if (t >= 1) {
          settleRafRef.current = null;
          settleRef.current = null;
          dragXRef.current = s.to;
          applyDragTransform(s.to);
          s.onDone?.();
          return;
        }
        settleRafRef.current = requestAnimationFrame(step);
      };
      settleRafRef.current = requestAnimationFrame(step);
    },
    [applyDragTransform]
  );

  const applyZoomPanTransform = useCallback((z: number, x: number, y: number, rot: number, dragXpx: number) => {
    const cur = currentWrapperRef.current;
    if (cur) {
      cur.style.transform = `translateX(${dragXpx}px)`;
      cur.style.transition = "none";
    }
    const img = imageElRef.current;
    if (img) {
      img.style.transform = `translate(${x}px, ${y}px) scale(${z}) rotate(${rot}deg)`;
      img.style.transition = "none";
    }
  }, []);

  const applyZoomAt = useCallback(
    (fx: number, fy: number, newZoom: number) => {
      const z1 = zoom;
      if (newZoom <= 1) {
        setZoom(1);
        setPanOffset({ x: 0, y: 0 });
        return;
      }
      const s = newZoom / z1;
      const el = imageContainerRef.current;
      const cx = el ? el.getBoundingClientRect().width / 2 : 0;
      const cy = el ? el.getBoundingClientRect().height / 2 : 0;
      setZoom(newZoom);
      setPanOffset((p) => {
        const qx = fx - cx - p.x;
        const qy = fy - cy - p.y;
        return clampPanOffset(fx - cx - qx * s, fy - cy - qy * s, newZoom);
      });
    },
    [zoom, clampPanOffset]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!isImage) return;
      e.preventDefault();
      const el = imageContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = clamp(zoom + (e.deltaY > 0 ? -0.15 : 0.15), 1, 5);
      applyZoomAt(e.clientX - rect.left, e.clientY - rect.top, next);
    },
    [isImage, zoom, applyZoomAt]
  );

  const toggleZoomAtPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = imageContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (zoom > 1) {
        setZoom(1);
        setPanOffset({ x: 0, y: 0 });
        return;
      }
      applyZoomAt(clientX - rect.left, clientY - rect.top, 2.5);
    },
    [zoom, applyZoomAt]
  );

  const handleImageDoubleClick = useCallback(
    (e?: React.MouseEvent) => {
      if (!isImage) return;
      if (Date.now() < suppressDblClickUntilRef.current) return;
      if (zoom > 1) {
        setZoom(1);
        setPanOffset({ x: 0, y: 0 });
        return;
      }
      const el = imageContainerRef.current;
      if (!el) {
        setZoom(2.5);
        return;
      }
      const rect = el.getBoundingClientRect();
      applyZoomAt(
        e ? e.clientX - rect.left : rect.width / 2,
        e ? e.clientY - rect.top : rect.height / 2,
        2.5
      );
    },
    [isImage, zoom, applyZoomAt]
  );

  const handleImageTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      if (target.closest("input, button, select, textarea, a")) return;
      /* New gesture: cancels the landing in progress and resets the velocity. */
      if (settleRafRef.current !== null) {
        cancelAnimationFrame(settleRafRef.current);
        settleRafRef.current = null;
        settleRef.current = null;
      }
      swipeVelRef.current = { vx: 0, lastX: 0, lastT: 0 };
      gestureActiveRef.current = true;
      setGestureActive(true);
      const touches = e.touches;
      if (touches.length >= 2) {
        if (!isImage) {
          gestureActiveRef.current = false;
          setGestureActive(false);
          return;
        }
        const a = touches[0];
        const b = touches[1];
        const dx = a.clientX - b.clientX;
        const dy = a.clientY - b.clientY;
        const el = imageContainerRef.current;
        const rect = el ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        const img = imageElRef.current;
        const imgRect = img ? img.getBoundingClientRect() : { width: rect.width, height: rect.height };
        pinchStartRef.current = {
          dist: Math.hypot(dx, dy),
          zoom,
          midX: (a.clientX + b.clientX) / 2 - rect.left,
          midY: (a.clientY + b.clientY) / 2 - rect.top,
          pan: { ...panOffset },
          rectLeft: rect.left,
          rectTop: rect.top,
          cw: rect.width,
          ch: rect.height,
          iw: imgRect.width,
          ih: imgRect.height,
        };
        zoomRef.current = zoom;
        panRef.current = { ...panOffset };
        swipeFiredRef.current = true;
        edgeExceedRef.current = 0;
        setIsPinching(true);
        dragXRef.current = 0;
        setDragX(0);
        return;
      }
      const t = touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
      swipeFiredRef.current = false;
      edgeExceedRef.current = 0;
      if (zoom > 1) {
        const el = imageContainerRef.current;
        const cRect = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
        const img = imageElRef.current;
        const iRect = img ? img.getBoundingClientRect() : { width: cRect.width, height: cRect.height };
        panCandidateRef.current = { x: t.clientX, y: t.clientY, ox: panOffset.x, oy: panOffset.y, iw: iRect.width, ih: iRect.height, cw: cRect.width, ch: cRect.height };
        panStart.current = panCandidateRef.current;
        zoomRef.current = zoom;
        panRef.current = { ...panOffset };
      }
    },
    [isImage, zoom, panOffset]
  );

  const handleImageTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.stopPropagation();
      const touches = e.touches;
      if (touches.length >= 2 && pinchStartRef.current) {
        const a = touches[0];
        const b = touches[1];
        const dx = a.clientX - b.clientX;
        const dy = a.clientY - b.clientY;
        const dist = Math.hypot(dx, dy);
        const start = pinchStartRef.current;
        const next = clamp(start.zoom * (dist / start.dist), 1, 5);
        const cx = start.cw / 2;
        const cy = start.ch / 2;
        const midX = (a.clientX + b.clientX) / 2 - start.rectLeft;
        const midY = (a.clientY + b.clientY) / 2 - start.rectTop;
        const qx = start.midX - cx - start.pan.x;
        const qy = start.midY - cy - start.pan.y;
        let nx = midX - cx - (qx / start.zoom) * next;
        let ny = midY - cy - (qy / start.zoom) * next;
        if (next <= 1) {
          nx = 0;
          ny = 0;
        } else {
          const maxX = Math.max(0, (start.iw * next - start.cw) / 2);
          const maxY = Math.max(0, (start.ih * next - start.ch) / 2);
          nx = clamp(nx, -maxX, maxX);
          ny = clamp(ny, -maxY, maxY);
        }
        zoomRef.current = next;
        panRef.current = { x: nx, y: ny };
        applyZoomPanTransform(next, nx, ny, rotationRef.current, 0);
        setZoom(next);
        setPanOffset({ x: nx, y: ny });
        return;
      }
      if (touches.length !== 1) return;
      const t = touches[0];
      trackSwipeVelocity(t.clientX);
      if (isPanning) {
        const dx = t.clientX - panStart.current.x;
        const dy = t.clientY - panStart.current.y;
        const z = zoomRef.current;
        let nx = panStart.current.ox + dx;
        let ny = panStart.current.oy + dy;
        const maxX = Math.max(0, (panStart.current.iw * z - panStart.current.cw) / 2);
        const maxY = Math.max(0, (panStart.current.ih * z - panStart.current.ch) / 2);
        nx = clamp(nx, -maxX, maxX);
        ny = clamp(ny, -maxY, maxY);
        panRef.current = { x: nx, y: ny };
        applyZoomPanTransform(z, nx, ny, rotationRef.current, 0);
        const excess = panStart.current.ox + dx - nx;
        edgeExceedRef.current = excess;
        if (Math.abs(excess) >= 40) {
          swipeFiredRef.current = true;
          dragXRef.current = excess;
          applyDragTransform(excess);
        } else if (swipeFiredRef.current) {
          swipeFiredRef.current = false;
          dragXRef.current = 0;
          applyDragTransform(0);
        }
        return;
      }
      if (zoomRef.current > 1) {
        if (!isPanning && touchStartRef.current) {
          const dx = t.clientX - touchStartRef.current.x;
          const dy = t.clientY - touchStartRef.current.y;
          if (Math.hypot(dx, dy) > 12 && panCandidateRef.current) {
            panStart.current = panCandidateRef.current;
            lastTapRef.current = null;
            panEngagedRef.current = true;
            setIsPanning(true);
          }
        }
        return;
      }
      if (!touchStartRef.current) return;
      const dx = t.clientX - touchStartRef.current.x;
      const dy = t.clientY - touchStartRef.current.y;
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        const filesList = files && files.length > 1 ? files : null;
        const dir: 1 | -1 = dx < 0 ? 1 : -1;
        const hasNeighbor = filesList ? !!findAdjacentPreviewable(filesList, file.id, dir) : false;
        const eff = hasNeighbor ? dx : dx * 0.35;
        dragXRef.current = eff;
        applyDragTransform(eff);
      } else if (Math.abs(dy) > 10) {
        dragXRef.current = 0;
        applyDragTransform(0);
      }
    },
    [isPanning, files, file, applyDragTransform, applyZoomPanTransform, trackSwipeVelocity]
  );

  const finishSwipeGesture = useCallback(
    (dx: number, dy: number): boolean => {
      const filesList = files && files.length > 1 ? files : null;
      const dir: 1 | -1 = dx < 0 ? 1 : -1;
      const hasNeighbor = filesList ? !!findAdjacentPreviewable(filesList, file.id, dir) : false;
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.3;
      const v = swipeVelRef.current.vx;
      /* Navigates if it passed the minimum distance OR there was a fling
         (short fast swipe): the animation duration comes from the velocity. */
      const moved = horizontal && (Math.abs(dx) > 64 || (Math.abs(v) > 0.35 && v * dir < 0));
      if (moved && hasNeighbor) {
        const el = currentWrapperRef.current;
        const width = el ? el.clientWidth : 400;
        setSwipeOutDir(dir);
        setDragX(dragXRef.current);
        animateSettle(dragXRef.current, -dir * width, v, () => {
          setSwipeOutDir(null);
          setDragX(0);
          gestureActiveRef.current = false;
          setGestureActive(false);
          onNavigate?.(dir, true);
        });
        return true;
      }
      if (dragXRef.current !== 0) {
        setSwipeOutDir(null);
        setDragX(dragXRef.current);
        animateSettle(dragXRef.current, 0, v, () => {
          gestureActiveRef.current = false;
          setGestureActive(false);
          setDragX(0);
        });
      } else {
        gestureActiveRef.current = false;
        setGestureActive(false);
      }
      return false;
    },
    [animateSettle, files, file, onNavigate]
  );

  const handleImageTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      pinchStartRef.current = null;
      setIsPinching(false);
      panCandidateRef.current = null;
      if (isPanning) {
        setIsPanning(false);
        panEngagedRef.current = false;
        lastTapRef.current = null;
        setPanOffset(panRef.current);
        lastPanEndRef.current = Date.now();
        if (swipeFiredRef.current) {
          swipeFiredRef.current = false;
          const excess = edgeExceedRef.current;
          edgeExceedRef.current = 0;
          finishSwipeGesture(excess, 0);
        } else {
          gestureActiveRef.current = false;
          setGestureActive(false);
        }
        return;
      }
      if (!touchStartRef.current) {
        gestureActiveRef.current = false;
        setGestureActive(false);
        if (swipeFiredRef.current) {
          swipeFiredRef.current = false;
          setZoom(zoomRef.current);
          setPanOffset(panRef.current);
          setDragX(0);
        }
        return;
      }
      const changed = e.changedTouches[0];
      if (!changed) {
        gestureActiveRef.current = false;
        setGestureActive(false);
        return;
      }
      const dx = changed.clientX - touchStartRef.current.x;
      const dy = changed.clientY - touchStartRef.current.y;
      const dt = Date.now() - touchStartRef.current.t;
      touchStartRef.current = null;
      if (swipeFiredRef.current) {
        swipeFiredRef.current = false;
        edgeExceedRef.current = 0;
        setZoom(zoomRef.current);
        setPanOffset(panRef.current);
        dragXRef.current = 0;
        setDragX(0);
        gestureActiveRef.current = false;
        setGestureActive(false);
        return;
      }
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) lastSwipeEndRef.current = Date.now();
      if (finishSwipeGesture(dx, dy)) return;
      if (isImage && Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 300) {
        const now = Date.now();
        const last = lastTapRef.current;
        if (last && now - last.t < 300 && Math.hypot(changed.clientX - last.x, changed.clientY - last.y) < 40) {
          lastTapRef.current = null;
          suppressDblClickUntilRef.current = now + 500;
          toggleZoomAtPoint(changed.clientX, changed.clientY);
        } else {
          lastTapRef.current = { x: changed.clientX, y: changed.clientY, t: now };
        }
      }
    },
    [isImage, isPanning, finishSwipeGesture, toggleZoomAtPoint]
  );

  const handlePanStart = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1) return;
      panningRef.current = true;
      e.preventDefault();
      setIsPanning(true);
      const el = imageContainerRef.current;
      const cRect = el ? el.getBoundingClientRect() : { width: 0, height: 0 };
      const img = imageElRef.current;
      const iRect = img ? img.getBoundingClientRect() : { width: cRect.width, height: cRect.height };
      panStart.current = { x: e.clientX, y: e.clientY, ox: panOffset.x, oy: panOffset.y, iw: iRect.width, ih: iRect.height, cw: cRect.width, ch: cRect.height };
    },
    [zoom, panOffset]
  );

  const handlePanMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      const z = zoomRef.current;
      let nx = panStart.current.ox + dx;
      let ny = panStart.current.oy + dy;
      const maxX = Math.max(0, (panStart.current.iw * z - panStart.current.cw) / 2);
      const maxY = Math.max(0, (panStart.current.ih * z - panStart.current.ch) / 2);
      nx = clamp(nx, -maxX, maxX);
      ny = clamp(ny, -maxY, maxY);
      setPanOffset({ x: nx, y: ny });
    },
    [isPanning]
  );

  const handlePanEnd = useCallback(() => {
    if (panningRef.current) lastPanEndRef.current = Date.now();
    panningRef.current = false;
    setIsPanning(false);
  }, []);

  /* ═══════════════════════════════════════════════════════
     VIDEO: CUSTOM PLAYER (NATIVE + OGV / MKV DECODER)
     ═══════════════════════════════════════════════════════ */

  const getActiveVideo = useCallback(() => {
    return ogvPlayerRef.current || videoRef.current;
  }, []);

  const toggleVideoPlay = useCallback(() => {
    const v = getActiveVideo();
    if (!v) return;
    if (v.paused) {
      v.play()?.catch?.(console.error);
    } else {
      v.pause();
    }
  }, [getActiveVideo]);

  const toggleFullscreen = useCallback(() => {
    const container = videoContainerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen().catch(console.error);
    }
  }, []);

  const togglePiP = useCallback(async () => {
    const video = ogvPlayerRef.current || videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if ("requestPictureInPicture" in video) {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.error("PiP error:", err);
    }
  }, []);

  // Sync volume to active video element (native or OGV)
  useEffect(() => {
    const v = getActiveVideo();
    if (v) {
      v.volume = videoVolume;
      v.muted = videoMuted;
    }
  }, [videoVolume, videoMuted, getActiveVideo]);

  // Sync playback speed
  useEffect(() => {
    const v = getActiveVideo();
    if (v) v.playbackRate = playbackSpeed;
  }, [playbackSpeed, getActiveVideo]);

  // Sync loop to the active video (native or OGV)
  useEffect(() => {
    const v = getActiveVideo();
    if (v) v.loop = videoLoop;
  }, [videoLoop, getActiveVideo]);

  // Sync audio volume
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = audioVolume;
  }, [audioVolume]);

  // Sync audio playback speed
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = audioSpeed;
  }, [audioSpeed]);

  // Auto-hide video controls
  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimer.current) clearTimeout(controlsTimer.current);
    controlsTimer.current = setTimeout(() => {
      if (gestureActiveRef.current) return; // do not re-render during the swipe
      const v = getActiveVideo();
      if (v && !v.paused) {
        setControlsVisible(false);
      }
    }, 3000);
  }, [getActiveVideo]);

  const handleVideoPlay = useCallback(() => {
    userPausedRef.current = false;
    setVideoPlaying(true);
    resetControlsTimer();
    setBuffering(false);
  }, [resetControlsTimer]);

  const handleVideoPause = useCallback(() => {
    userPausedRef.current = true;
    setVideoPlaying(false);
    // A previous `waiting` could have left buffering=true (an endless spinner
    // that also hid the center button): it is cleared on pause.
    setBuffering(false);
    setControlsVisible(true);
  }, []);

  const handleVideoLoadedMetadata = useCallback(() => {
    if (gestureActiveRef.current) return;
    if (videoRef.current) setVideoDuration(videoRef.current.duration);
    setBuffering(false);
    // First autoplay retry: the src arrives async (url resolves after
    // navigating), the mount's autoPlay did not fire and the earlier play()
    // failed silently; with metadata now available it really starts here.
    const v = videoRef.current;
    if (v && v.paused && !userPausedRef.current) {
      v.play().catch(() => {});
    }
  }, []);

  const handleVideoLoadedData = useCallback(() => {
    if (gestureActiveRef.current) return;
    setBuffering(false);
  }, []);
  const handleVideoCanPlay = useCallback(() => {
    if (gestureActiveRef.current) return;
    setBuffering(false);
  }, []);
  const handleVideoCanPlayThrough = useCallback(() => {
    if (gestureActiveRef.current) return;
    setBuffering(false);
  }, []);
  const handleVideoSeeking = useCallback(() => {
    if (gestureActiveRef.current) return;
    setBuffering(true);
  }, []);
  const handleVideoSeeked = useCallback(() => {
    if (gestureActiveRef.current) return;
    setBuffering(false);
  }, []);
  const handleVideoWaiting = useCallback(() => {
    if (gestureActiveRef.current) return;
    setBuffering(true);
  }, []);
  const handleVideoPlaying = useCallback(() => {
    if (gestureActiveRef.current) return;
    setBuffering(false);
  }, []);

  /* ─── NATIVE PLAYER FALLBACK (ExoPlayer, native plugin) ─── */
  const [nativePlayProgress, setNativePlayProgress] = useState<number | null>(null);
  const [canNativePlay, setCanNativePlay] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (mounted) setCanNativePlay(hasNativePlayer());
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const nativeAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => nativeAbortRef.current?.abort();
  }, []);

  const handleVideoError = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      console.warn("Native video element playback error, attempting OGV decoder fallback...", e);
      if (!useOgv) {
        if (canNativePlay) {
          setBuffering(false);
          setVideoError(`The browser player cannot render this video codec/container (.${ext.toUpperCase()}). Use the native player for fluid playback.`);
        } else {
          setUseOgv(true);
        }
      } else {
        setBuffering(false);
        setVideoError(`Browser native player cannot render this video codec/container (.${ext.toUpperCase()}). Please download to play.`);
      }
    },
    [useOgv, ext, canNativePlay]
  );

  const handleNativePlay = useCallback(async () => {
    if (nativePlayProgress !== null) return;
    setNativePlayProgress(0);
    nativeAbortRef.current = new AbortController();
    const ok = await playFileWithNativePlayer(
      String(file.id),
      file.name,
      file.size,
      (frac) => setNativePlayProgress(frac),
      nativeAbortRef.current.signal
    );
    if (!ok) {
      setNativePlayProgress(null);
      setVideoError(
        (prev) =>
          prev ??
          "Could not open the native player. Download the video to play it."
      );
    }
  }, [file, nativePlayProgress]);

  /* ─── IMMERSIVE MODE (tap → hide chrome + system bars) ─── */
  const [immersive, setImmersive] = useState(false);
  const lastPanEndRef = useRef(0);
  const panningRef = useRef(false);

  // Centering compensation when entering immersive: the ROM expands the
  // WebView downward (gesture bar) and the flexbox would re-center the
  // content. The content area's padding-bottom returns it to the exact
  // center (env(safe-area-inset-bottom)=0 on this WebView) WITHOUT
  // shrinking the preview.
  // The base is measured per orientation ONLY on mount and when a rotation
  // completes (matchMedia event, with the system bars visible).
  // The intermediate resizes of the rotation animation NEVER register a
  // base: previously they captured a premature value (shorter height at the
  // end) and inflated viewportGrow, shrinking the preview module.
  const baseByOrientationRef = useRef<{ portrait: number | null; landscape: number | null }>({
    portrait: null,
    landscape: null,
  });
  const immersiveRef = useRef(false);
  const [viewportGrow, setViewportGrow] = useState(0);
  const contentAreaRef = useRef<HTMLDivElement | null>(null);
  const MAX_VIEWPORT_GROW = 300;
  useEffect(() => {
    const keyOf = () => (window.innerWidth > window.innerHeight ? "landscape" : "portrait");
    const recordBase = () => {
      if (immersiveRef.current) return;
      baseByOrientationRef.current[keyOf()] = window.innerHeight;
    };
    const onResize = () => {
      const base = baseByOrientationRef.current[keyOf()] ?? window.innerHeight;
      const grow = Math.min(MAX_VIEWPORT_GROW, Math.max(0, window.innerHeight - base));
      setViewportGrow(grow);
    };
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener("change", recordBase);
    window.addEventListener("resize", onResize);
    recordBase();
    onResize();
    return () => {
      mq.removeEventListener("change", recordBase);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const toggleImmersive = useCallback(() => setImmersive((v) => !v), []);

  useEffect(() => {
    immersiveRef.current = immersive;
    if (immersive) {
      setControlsVisible(false);
      setShowSpeedMenu(false);
      setShowFileInfo(false);
      toggleImmersiveMode(true);
    } else {
      toggleImmersiveMode(false);
      if (isVideo && url) {
        setControlsVisible(true);
        resetControlsTimer();
      }
    }
  }, [immersive, isVideo, url, resetControlsTimer]);

  useEffect(() => {
    setPreviewBars();
    return () => {
      // Only restore bars if immersive was active; avoid racing with the
      // immersive toggle effect that may already be calling show().
      if (immersiveRef.current) {
        toggleImmersiveMode(false);
      }
      restoreBars();
    };
  }, []);

  // Rotation → maximize like Google Drive mobile: in landscape the image
  // expands to fullscreen (immersive: no header or controls);
  // returning to portrait restores the normal view.
  const autoImmersiveRef = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        autoImmersiveRef.current = true;
        setImmersive(true);
      } else if (autoImmersiveRef.current) {
        autoImmersiveRef.current = false;
        setImmersive(false);
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const handleImmersiveTap = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const t = e.target as HTMLElement;
      if (t.closest("button, input, select, textarea, a, iframe")) return;
      if (Date.now() - lastSwipeEndRef.current < 300) return;
      if (Date.now() - lastPanEndRef.current < 300) return;
      if (isVideo) return;
      toggleImmersive();
    },
    [isVideo, toggleImmersive]
  );

  const handleVideoImmersiveTap = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (Date.now() - lastSwipeEndRef.current < 300) return;
      toggleImmersive();
    },
    [toggleImmersive]
  );

  /* ═══════════════════════════════════════════════════════
     IMAGE GALLERY (SwiperGallery: virtual + zoom, no remount)
     The carousel traverses ALL previewable files (same as
     findAdjacentPreviewable); non-image neighbors are reserved
     as black slides and the commit navigates the modal.
     ═══════════════════════════════════════════════════════ */

  /* Thumbnails (640px) of the carousel photos: the swipe animates over the
   thumbnail (small texture → cheap frames on low-end devices) and the full
   resolution fades in once stabilized (progressive, Google Photos-style).
   Initial synchronous snapshot from the RAM cache (the listing already
   loaded them) + async loading of the rest. Passed separately from `photos`
   so the array identity does NOT change and the carousel is not restarted. */
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of files || []) {
      if (!isImageFile(f)) continue;
      const cached = getCachedThumbUrl(f);
      if (cached) init[String(f.id)] = cached;
    }
    return init;
  });
  const thumbUrlsRef = useRef(thumbUrls);
  useEffect(() => {
    thumbUrlsRef.current = thumbUrls;
  }, [thumbUrls]);

  useEffect(() => {
    const list = files || [];
    let active = true;
    const setOne = (id: string, url: string) => {
      if (!active) return;
      setThumbUrls((t) => (t[id] ? t : { ...t, [id]: url }));
    };
    for (const f of list) {
      if (!isImageFile(f)) continue;
      const cached = getCachedThumbUrl(f);
      if (cached) {
        setOne(String(f.id), cached);
        continue;
      }
      getFileCoverUrl(f, client, driveConfig).then((url) => {
        if (url) setOne(String(f.id), url);
      });
    }
    return () => {
      active = false;
    };
  }, [files, client, driveConfig]);

  const galleryPhotos = useMemo(() => {
    const list = files && files.length > 1 ? files : null;
    if (!list) return null;
    const previewable = list.filter((f) => isPreviewableFile(f));
    return previewable.map((f) => ({
      id: String(f.id),
      src: `/stream/${f.id}`,
      kind: isImageFile(f) ? ("image" as const) : ("other" as const),
    }));
  }, [files]);

  /* Single-file case: a 1-photo list, stable across renders (the init effect
     depends on the identity of `photos`; if it changed, it would restart the
     carousel and flicker when toggling immersive). */
  const singleGalleryPhoto = useMemo(() => {
    if (!isPreviewableFile(file)) return [];
    return [
      {
        id: String(file.id),
        src: `/stream/${file.id}`,
        kind: isImageFile(file) ? ("image" as const) : ("other" as const),
      },
    ];
  }, [file]);

  const galleryPhotosFinal = galleryPhotos ?? singleGalleryPhoto;

  const galleryIndex = useMemo(() => {
    const idx = galleryPhotosFinal.findIndex((p) => p.id === String(file.id));
    return idx === -1 ? 0 : idx;
  }, [galleryPhotosFinal, file.id]);

  const handleGalleryIndexChange = useCallback(
    (nextIndex: number) => {
      const cur = galleryPhotosFinal.findIndex((p) => p.id === String(file.id));
      if (cur === -1 || nextIndex === cur) return;
      onNavigate?.(nextIndex > cur ? 1 : -1, true);
    },
    [galleryPhotosFinal, file.id, onNavigate]
  );

  const handleGalleryTap = useCallback(() => {
    if (Date.now() - lastSwipeEndRef.current < 300) return;
    toggleImmersive();
  }, [toggleImmersive]);

  const handleVideoMuteToggle = useCallback(() => setVideoMuted((m) => !m), []);
  const handleVideoVolumeChange = useCallback(
    (v: number) => {
      setVideoVolume(v);
      if (videoMuted) setVideoMuted(false);
    },
    [videoMuted]
  );
  const handleToggleSpeedMenu = useCallback(() => setShowSpeedMenu((s) => !s), []);
  const handleToggleLoop = useCallback(() => setVideoLoop((v) => !v), []);
  const handleSpeedSelect = useCallback(
    (speed: number) => {
      setPlaybackSpeed(speed);
      setShowSpeedMenu(false);
    },
    []
  );
  const handleSeekTooltipLeave = useCallback(() => setSeekTooltip(null), []);

  // OGV player dynamic initialization fallback effect
  useEffect(() => {
    if (!isVideo || !url || !useOgv) return;

    let cancelled = false;
    setOgvLoading(true);
    setBuffering(true);

    loadScript([
      "https://cdn.jsdelivr.net/npm/ogv@1.9.0/dist/ogv.js",
      "https://unpkg.com/ogv@1.9.0/dist/ogv.js",
      "https://cdnjs.cloudflare.com/ajax/libs/ogv/1.9.0/ogv.js"
    ], "OGVPlayer")
      .then(() => {
        if (cancelled) return;
        const OGVPlayer = (window as any).OGVPlayer;
        if (!OGVPlayer) throw new Error("OGVPlayer library did not load");

        if (ogvPlayerRef.current) {
          try {
            ogvPlayerRef.current.pause();
          } catch {}
          ogvPlayerRef.current = null;
        }

        const container = ogvContainerRef.current;
        if (!container) return;
        container.innerHTML = "";

        const player = new OGVPlayer({
          debug: false,
          memoryLimit: 128 * 1024 * 1024,
        });

        player.style.width = "100%";
        player.style.height = "100%";
        player.style.objectFit = "contain";
        container.appendChild(player);

        ogvPlayerRef.current = player;

        player.addEventListener("loadedmetadata", () => {
          if (cancelled) return;
          if (gestureActiveRef.current) return;
          setVideoDuration(player.duration || 0);
          setBuffering(false);
          setOgvLoading(false);
        });

        player.addEventListener("timeupdate", () => {
          if (cancelled) return;
          if (gestureActiveRef.current) return; // frozen during the swipe
          setVideoTime(player.currentTime || 0);
          if (player.buffered && player.buffered.length > 0) {
            setVideoBuffered(player.buffered.end(player.buffered.length - 1));
          }
        });

        player.addEventListener("playing", () => {
          if (cancelled) return;
          if (gestureActiveRef.current) return;
          setVideoPlaying(true);
          setBuffering(false);
          setOgvLoading(false);
          resetControlsTimer();
        });

        player.addEventListener("pause", () => {
          if (cancelled) return;
          if (gestureActiveRef.current) return;
          setVideoPlaying(false);
          setControlsVisible(true);
        });

        player.addEventListener("ended", () => {
          if (cancelled) return;
          if (gestureActiveRef.current) return;
          setVideoPlaying(false);
          setControlsVisible(true);
        });

        player.addEventListener("seeking", () => {
          if (cancelled) return;
          if (gestureActiveRef.current) return;
          setBuffering(true);
        });

        player.addEventListener("seeked", () => {
          if (cancelled) return;
          if (gestureActiveRef.current) return;
          setBuffering(false);
        });

        player.addEventListener("error", (err: any) => {
          if (cancelled) return;
          console.warn("OGV Player error:", err);
          setBuffering(false);
          setOgvLoading(false);
          setVideoError(`Cannot render this .${ext.toUpperCase()} file natively. Please download to play.`);
        });

        player.src = url;
        player.play().catch(() => {});
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("OGV Player load error:", err);
        setOgvLoading(false);
        setBuffering(false);
        setVideoError(`Failed to load MKV player engine. Please download the file to play.`);
      });

    return () => {
      cancelled = true;
      if (ogvPlayerRef.current) {
        try {
          ogvPlayerRef.current.pause();
        } catch {}
        ogvPlayerRef.current = null;
      }
    };
  }, [isVideo, url, ext, mimeType, useOgv, resetControlsTimer]);

  // Fullscreen change listener
  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // Video event handlers
  const onVideoTimeUpdate = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    if (gestureActiveRef.current) return; // frozen during the swipe
    // Safeguard: only the ACTIVE video element may publish the time.
    // With fast navigation, a late timeupdate from a previous video must not
    // overwrite the new one's seconds.
    if (videoRef.current !== e.currentTarget) return;
    const v = e.currentTarget;
    setVideoTime(v.currentTime);
    if (v.buffered.length > 0) {
      setVideoBuffered(v.buffered.end(v.buffered.length - 1));
    }
  }, []);

  const handleVideoSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = getActiveVideo();
    if (!v) return;
    const time = parseFloat(e.target.value);
    v.currentTime = time;
    setVideoTime(time);
  }, [getActiveVideo]);

  const handleSeekTooltip = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const time = ratio * (videoDuration || 0);
    setSeekTooltip({ x: e.clientX - rect.left, time: formatTime(time) });
  }, [videoDuration]);

  /* When navigating to another file the pool UNMOUNTS the video element but
     the global state stays stale (unmount does not fire onPause): videoPlaying
     true from a previous video, videoError/useOgv stuck from another file,
     progress bar with an old time... → "the video does not start". All
     per-file playback state is reset.
     useLayoutEffect (not useEffect): the reset runs BEFORE paint, so a
     previous video's seconds are never shown when swiping quickly. */
  useLayoutEffect(() => {
    userPausedRef.current = false;
    setVideoPlaying(false);
    setVideoTime(0);
    setVideoDuration(0);
    setVideoBuffered(0);
    setBuffering(false);
    setVideoError(null);
    setUseOgv(false);
    setOgvLoading(false);
    setNativePlayProgress(null);
    setShowSpeedMenu(false);
  }, [file.id]);

  // Keep the active video playing after pool node moves between roles (autoPlay only fires on fresh mounts)
  useEffect(() => {
    if (!isVideo || !url) return;
    const v = getActiveVideo();
    if (v && v.paused && !userPausedRef.current) {
      v.play()?.catch?.(() => {});
    }
    resetControlsTimer();
  }, [isVideo, url, file.id, getActiveVideo, resetControlsTimer]);

  /* ═══════════════════════════════════════════════════════
     AUDIO CONTROLS
     ═══════════════════════════════════════════════════════ */

  const toggleAudioPlay = useCallback(() => {
    if (!audioRef.current) return;

    if (!audioCtxRef.current) {
      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        
        const source = ctx.createMediaElementSource(audioRef.current);
        source.connect(analyser);
        analyser.connect(ctx.destination);
        
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        sourceRef.current = source;
      } catch (err) {
        console.warn("Web Audio API not supported:", err);
      }
    }

    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }

    if (audioPlaying) {
      audioRef.current.pause();
      setAudioPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      setAudioPlaying(true);
    }
  }, [audioPlaying]);

  /* ═══════════════════════════════════════════════════════
     TEXT PREVIEW LOADER
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!isText || !url) return;
    const controller = new AbortController();
    fetch(url, { headers: { Range: "bytes=0-131071" }, signal: controller.signal })
      .then((r) => {
        if (!r.ok && r.status !== 206) throw new Error(`Text preview failed with status ${r.status}`);
        return r.text();
      })
      .then((txt) => setTextContent(txt.slice(0, 50000)))
      .catch((e) => {
        if (!controller.signal.aborted) {
          console.error("Text fetch error:", e);
          setTextContent("Unable to load text preview.");
        }
      });
    return () => controller.abort();
  }, [isText, url, file.id]);

  /* ═══════════════════════════════════════════════════════
     DYNAMIC SCRIPT HELPER WITH FALLBACKS
     ═══════════════════════════════════════════════════════ */

  function loadScript(srcs: string | string[], globalCheckName?: string): Promise<void> {
    const sources = Array.isArray(srcs) ? srcs : [srcs];
    
    if (globalCheckName && (window as any)[globalCheckName]) {
      return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
      // Check if script is already present in document
      for (const src of sources) {
        if (document.querySelector(`script[src="${src}"]`)) {
          if (!globalCheckName || (window as any)[globalCheckName]) {
            resolve();
            return;
          }
        }
      }
      
      let index = 0;
      function tryNext() {
        if (index >= sources.length) {
          reject(new Error(`Failed to load script from all sources: ${sources.join(', ')}`));
          return;
        }
        const src = sources[index];
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => {
          if (globalCheckName && !(window as any)[globalCheckName]) {
            console.warn(`Script loaded from ${src} but global ${globalCheckName} not found.`);
            try {
              document.head.removeChild(script);
            } catch {}
            index++;
            tryNext();
          } else {
            resolve();
          }
        };
        script.onerror = () => {
          console.warn(`Failed to load script from ${src}, trying next...`);
          try {
            document.head.removeChild(script);
          } catch {}
          index++;
          tryNext();
        };
        document.head.appendChild(script);
      }
      tryNext();
    });
  }

  /* ═══════════════════════════════════════════════════════
     EXCEL / SPREADSHEET LOADER
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!isSheet || !url) return;
    let cancelled = false;
    const controller = new AbortController();
    loadScript([
      "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
      "https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"
    ], "XLSX")
      .then(() => fetch(url, { signal: controller.signal }))
      .then((r) => r.arrayBuffer())
      .then((buffer) => {
        if (cancelled) return;
        const XLSX = window.XLSX;
        if (!XLSX) throw new Error("Spreadsheet parser did not load");
        const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
        setWorkbookRef(workbook);
        setSheetNames(workbook.SheetNames);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        setSheetData(jsonData);
      })
      .catch((e) => { if (!cancelled) console.error("Spreadsheet load/parse error:", e); });
    return () => { cancelled = true; controller.abort(); };
  }, [isSheet, url, file.id]);

  const handleSheetSwitch = (index: number) => {
    if (!workbookRef) return;
    setActiveSheetIndex(index);
    const XLSX = window.XLSX;
    if (!XLSX) return;
    const sheetName = workbookRef.SheetNames[index];
    const worksheet = workbookRef.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
    setSheetData(jsonData);
  };

  /* ═══════════════════════════════════════════════════════
     WORD (.DOCX) LOADER
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!isDocx || !url || !docxContainerRef.current) return;
    let cancelled = false;
    const controller = new AbortController();
    const container = docxContainerRef.current;
    setLoadingDocx(true);
    loadScript([
      "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
      "https://unpkg.com/jszip@3.10.1/dist/jszip.min.js"
    ], "JSZip")
      .then(() => loadScript([
        "https://cdn.jsdelivr.net/npm/docx-preview@0.1.15/dist/docx-preview.min.js",
        "https://unpkg.com/docx-preview@0.1.15/dist/docx-preview.min.js"
      ], "docx"))
      .then(() => fetch(url, { signal: controller.signal }))
      .then((r) => r.blob())
      .then((blob) => {
        if (cancelled || !container) return;
        const docx = window.docx;
        if (!docx) throw new Error("DOCX renderer did not load");
        container.innerHTML = "";
        return docx.renderAsync(blob, container, null, {
          className: "docx-preview-body",
          inWrapper: false,
          ignoreWidth: true,
          ignoreHeight: true,
        });
      })
      .catch((e) => { if (!cancelled) console.error("Docx load/render error:", e); })
      .finally(() => { if (!cancelled) setLoadingDocx(false); });
    return () => { cancelled = true; controller.abort(); if (container) container.innerHTML = ""; };
  }, [isDocx, url, file.id]);

  /* ═══════════════════════════════════════════════════════
     DSD DECODER HOOK
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!isDsd || !url) return;
    let cancelled = false;
    setDsdLoading(true);
    setDsdError(null);
    
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch DSD file");
        return r.arrayBuffer();
      })
      .then((buffer) => {
        if (cancelled) return;
        const blob = decodeDsfToWav(buffer);
        if (!blob) throw new Error("Failed to decode DSD file layout (DSF supported only)");
        const blobUrl = URL.createObjectURL(blob);
        setDsdDecodedUrl(blobUrl);
        setDsdLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("DSD decode error:", err);
        setDsdError(err.message || "Failed to decode DSD audio.");
        setDsdLoading(false);
      });
      
    return () => {
      cancelled = true;
      setDsdDecodedUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [isDsd, url]);

  /* ═══════════════════════════════════════════════════════
     AUDIO VISUALIZER RENDERING LOOP
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    let animationId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    const resizeCanvas = () => {
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    
    const bufferLength = analyserRef.current ? analyserRef.current.frequencyBinCount : 0;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
      animationId = requestAnimationFrame(draw);
      
      const width = canvas.width / window.devicePixelRatio;
      const height = canvas.height / window.devicePixelRatio;
      
      ctx.fillStyle = "rgba(18, 18, 24, 0.18)";
      ctx.fillRect(0, 0, width, height);
      
      if (analyserRef.current && audioPlaying) {
        analyserRef.current.getByteFrequencyData(dataArray);
        
        const centerX = width / 2;
        const centerY = height / 2;
        const baseRadius = Math.min(width, height) * 0.28;
        
        ctx.shadowBlur = 18;
        ctx.shadowColor = "rgba(96, 165, 250, 0.4)";
        
        ctx.beginPath();
        for (let i = 0; i < bufferLength; i++) {
          const angle = (i / bufferLength) * Math.PI * 2;
          const value = dataArray[i] / 255;
          const radius = baseRadius + value * 22;
          
          const x = centerX + Math.cos(angle) * radius;
          const y = centerY + Math.sin(angle) * radius;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        
        const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius, centerX, centerY, baseRadius + 22);
        gradient.addColorStop(0, "#60a5fa");
        gradient.addColorStop(1, "#a78bfa");
        
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        
        ctx.shadowBlur = 4;
        ctx.beginPath();
        for (let i = 0; i < bufferLength; i++) {
          const angle = (i / bufferLength) * Math.PI * 2;
          const value = dataArray[bufferLength - 1 - i] / 255;
          const radius = baseRadius - 6 - value * 10;
          
          const x = centerX + Math.cos(angle) * radius;
          const y = centerY + Math.sin(angle) * radius;
          
          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.closePath();
        ctx.strokeStyle = "rgba(167, 139, 250, 0.3)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        
        ctx.shadowBlur = 0;
      } else {
        const centerX = width / 2;
        const centerY = height / 2;
        const baseRadius = Math.min(width, height) * 0.28;
        
        ctx.beginPath();
        ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };
    
    draw();
    
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [audioPlaying]);

  /* ═══════════════════════════════════════════════════════
     EPUB EBOOK LOADER
     ═══════════════════════════════════════════════════════ */

  useEffect(() => {
    if (!isEpub || !url || !epubContainerRef.current) return;
    let cancelled = false;
    const controller = new AbortController();
    const container = epubContainerRef.current;
    setLoadingEpub(true);
    setEpubError(null);
    setEpubToc([]);
    setEpubCurrentChapterRef("");
    setEpubProgress("0%");

    const handleResize = () => {
      if (renditionRef.current) {
        try {
          renditionRef.current.resize();
        } catch {}
      }
    };
    window.addEventListener("resize", handleResize);
    
    loadScript([
      "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
      "https://unpkg.com/jszip@3.10.1/dist/jszip.min.js"
    ], "JSZip")
      .then(() => loadScript([
        "https://cdn.jsdelivr.net/npm/epubjs@0.3.88/dist/epub.min.js",
        "https://unpkg.com/epubjs@0.3.88/dist/epub.min.js",
        "https://cdn.jsdelivr.net/npm/epubjs@0.3.93/dist/epub.min.js",
        "https://unpkg.com/epubjs@0.3.93/dist/epub.min.js"
      ], "ePub"))
      .then(() => fetch(url, { signal: controller.signal }))
      .then((r) => {
        if (!r.ok) {
          throw new Error(`Failed to fetch book content (HTTP ${r.status})`);
        }
        return r.arrayBuffer();
      })
      .then((buffer) => {
        if (cancelled || !container) return;
        const ePub = window.ePub;
        if (!ePub) throw new Error("EPUB reader library did not load");
        
        container.innerHTML = "";
        const book = ePub(buffer);
        const rendition = book.renderTo(container, {
          width: "100%",
          height: "100%",
          flow: "paginated",
          stylesheet: "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;700&display=swap"
        });
        
        renditionRef.current = rendition;
        
        // Register beautiful reading themes
        rendition.themes.register("dark", {
          body: {
            background: "#121214 !important",
            color: "#e2e8f0 !important",
            "font-family": "'Outfit', sans-serif !important",
            "line-height": "1.8 !important",
            "font-size": "16px !important",
            padding: "0 30px !important"
          },
          p: { "margin-bottom": "1.25rem !important", "text-align": "justify !important" },
          h1: { color: "#ffffff !important", "font-weight": "700 !important", "margin-top": "2rem !important", "margin-bottom": "1rem !important" },
          h2: { color: "#ffffff !important", "font-weight": "600 !important", "margin-top": "1.75rem !important", "margin-bottom": "0.75rem !important" }
        });
        
        rendition.themes.register("light", {
          body: {
            background: "#ffffff !important",
            color: "#18181b !important",
            "font-family": "'Outfit', sans-serif !important",
            "line-height": "1.8 !important",
            "font-size": "16px !important",
            padding: "0 30px !important"
          },
          p: { "margin-bottom": "1.25rem !important", "text-align": "justify !important" },
          h1: { color: "#09090b !important", "font-weight": "700 !important", "margin-top": "2rem !important", "margin-bottom": "1rem !important" },
          h2: { color: "#09090b !important", "font-weight": "600 !important", "margin-top": "1.75rem !important", "margin-bottom": "0.75rem !important" }
        });
        
        rendition.themes.register("sepia", {
          body: {
            background: "#f4ecd8 !important",
            color: "#5c4033 !important",
            "font-family": "'Outfit', sans-serif !important",
            "line-height": "1.8 !important",
            "font-size": "16px !important",
            padding: "0 30px !important"
          },
          p: { "margin-bottom": "1.25rem !important", "text-align": "justify !important" },
          h1: { color: "#3d2b1f !important", "font-weight": "700 !important", "margin-top": "2rem !important", "margin-bottom": "1rem !important" },
          h2: { color: "#3d2b1f !important", "font-weight": "600 !important", "margin-top": "1.75rem !important", "margin-bottom": "0.75rem !important" }
        });
        
        rendition.themes.register("cream", {
          body: {
            background: "#faf6ee !important",
            color: "#2d241e !important",
            "font-family": "'Outfit', sans-serif !important",
            "line-height": "1.8 !important",
            "font-size": "16px !important",
            padding: "0 30px !important"
          },
          p: { "margin-bottom": "1.25rem !important", "text-align": "justify !important" },
          h1: { color: "#1c140e !important", "font-weight": "700 !important", "margin-top": "2rem !important", "margin-bottom": "1rem !important" },
          h2: { color: "#1c140e !important", "font-weight": "600 !important", "margin-top": "1.75rem !important", "margin-bottom": "0.75rem !important" }
        });
        
        // Select initial style settings
        rendition.themes.select(epubTheme);
        rendition.themes.fontSize(`${epubFontSize}%`);
        
        // Load TOC navigation
        if (book.loaded && book.loaded.navigation) {
          book.loaded.navigation.then((nav: any) => {
            if (cancelled) return;
            const tocItems = (nav && nav.toc) ? nav.toc : (Array.isArray(nav) ? nav : []);
            const flattenToc = (items: any[]): any[] => {
              let result: any[] = [];
              items.forEach((item) => {
                result.push({
                  label: item.label ? item.label.trim() : "Untitled Chapter",
                  href: item.href
                });
                if (item.subitems && item.subitems.length > 0) {
                  result = result.concat(flattenToc(item.subitems));
                }
              });
              return result;
            };
            setEpubToc(flattenToc(tocItems));
          }).catch((err: any) => {
            console.warn("Failed to load navigation:", err);
          });
        }

        // Handle location relocation progress & current chapter updates
        rendition.on("relocated", (location: any) => {
          if (cancelled) return;
          if (location && location.start) {
            const percentage = location.start.percentage;
            setEpubProgress(`${Math.round(percentage * 100)}%`);
            if (location.start.href) {
              setEpubCurrentChapterRef(location.start.href);
            }
          }
        });

        // Generate locations for progress bar accuracy (non-blocking)
        if (book.ready) {
          book.ready.then(() => {
            if (cancelled) return;
            if (book.locations) {
              book.locations.generate(1000).catch(() => {});
            }
          }).catch((err: any) => {
            console.warn("Book ready failed:", err);
          });
        }

        return rendition.display();
      })
      .then(() => {
        if (!cancelled) {
          setLoadingEpub(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("EPUB render error:", err);
          setEpubError(err.message || "Failed to render EPUB.");
          setLoadingEpub(false);
        }
      });
      
    return () => {
      cancelled = true;
      controller.abort();
      window.removeEventListener("resize", handleResize);
      if (renditionRef.current) {
        try {
          renditionRef.current.destroy();
        } catch {}
      }
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [isEpub, url]);

  useEffect(() => {
    if (renditionRef.current) {
      try {
        renditionRef.current.themes.select(epubTheme);
      } catch (err) {
        console.warn("Failed to apply EPUB theme:", err);
      }
    }
  }, [epubTheme]);

  useEffect(() => {
    if (renditionRef.current) {
      try {
        renditionRef.current.themes.fontSize(`${epubFontSize}%`);
      } catch (err) {
        console.warn("Failed to apply EPUB font size:", err);
      }
    }
  }, [epubFontSize]);

  /* ═══════════════════════════════════════════════════════
     LOADING FLAGS
     ═══════════════════════════════════════════════════════ */

  const isTextLoading = isText && Boolean(url) && textContent === null;
  const isSheetLoading = isSheet && Boolean(url) && sheetData === null && sheetNames.length === 0;

  /* ═══════════════════════════════════════════════════════
     FILE DATE HELPER
     ═══════════════════════════════════════════════════════ */

  const fileDate = new Date(file.date * 1000);
  const fileDateStr = fileDate.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  /* ═══════════════════════════════════════════════════════
     EPUB THEME STYLES MAP
     ═══════════════════════════════════════════════════════ */

  const themeStyles: Record<string, { bg: string; text: string; selectBg: string; border: string }> = {
    dark: {
      bg: "bg-[#121214]",
      text: "text-[#e2e8f0]",
      selectBg: "bg-[#18181b]",
      border: "border-white/[0.06]"
    },
    light: {
      bg: "bg-[#ffffff]",
      text: "text-[#18181b]",
      selectBg: "bg-[#f4f4f5]",
      border: "border-black/[0.08]"
    },
    sepia: {
      bg: "bg-[#f4ecd8]",
      text: "text-[#5c4033]",
      selectBg: "bg-[#eae0c6]",
      border: "border-[#e0d4b8]"
    },
    cream: {
      bg: "bg-[#faf6ee]",
      text: "text-[#2d241e]",
      selectBg: "bg-[#f0e6d6]",
      border: "border-[#e6dcbf]"
    }
  };

  const currentThemeStyle = themeStyles[epubTheme] || themeStyles.dark;

  /* ═══════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════ */

  return (
    <div
      className={`preview-modal-container fixed inset-0 z-50 flex items-center justify-center transition-none`}
      onMouseUp={handlePanEnd}
      onTouchEnd={handlePanEnd}
    >
      {/* ─── Backdrop ─── */}
      <div
        className={`absolute inset-0 preview-overlay ${closing ? "animate-backdrop-exit" : fromSwipe ? "" : "animate-backdrop-enter"}`}
        onClick={handleClose}
      />

      {/* ─── Modal Container ─── */}
      <div
        className={`preview-card relative w-full h-full sm:w-[calc(100%_-_1.5rem)] sm:h-[calc(100%_-_1.5rem)] sm:max-w-[1440px] sm:max-h-[960px] bg-[#0a0a0a] sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col ${closing ? "animate-preview-exit" : fromSwipe ? "" : "animate-preview-enter"}`}
      >

        {/* ═══════════════════════════════════════════════
            HEADER BAR
            ═══════════════════════════════════════════════ */}
        <div className={`absolute top-0 left-0 right-0 z-30 min-h-14 sm:min-h-[3.5rem] px-3 sm:px-4 flex items-center gap-2 bg-[#0a0a0a]/95 border-b border-white/[0.06] select-none transition-all duration-300 ease-out ${immersive ? "opacity-0 pointer-events-none -translate-y-3" : ""}`} style={{ paddingTop: "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))", paddingLeft: "max(var(--safe-area-inset-left, env(safe-area-inset-left, 0px)), 0.75rem)", paddingRight: "max(var(--safe-area-inset-right, env(safe-area-inset-right, 0px)), 0.75rem)" }}>
          {/* Back button */}
          <button
            onClick={handleClose}
            className="w-10 h-10 shrink-0 rounded-full hover:bg-white/10 flex items-center justify-center transition-all duration-200 active:scale-90 cursor-pointer group"
            title="Back"
          >
            <svg className="w-5 h-5 text-white/80 group-hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* File name */}
          <div className="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
            <h3 className="font-semibold text-white/95 truncate text-[13px] sm:text-sm leading-tight">{file.name}</h3>
            <p className="text-[10px] text-white/40 font-medium truncate mt-0.5 leading-tight">
              {formatBytes(file.size)} <span className="hidden sm:inline">• {fileDateStr}</span>
            </p>
          </div>

          {/* More options */}
          <button
            onClick={() => {
              setShowPreviewMenu(true);
            }}
            className="w-10 h-10 shrink-0 rounded-full hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-all duration-200 cursor-pointer active:scale-90"
            title="More options"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
            </svg>
          </button>
        </div>

        {/* ─── File Info Sheet ─── */}
        {showFileInfo && (
          <Modal
            open={showFileInfo}
            onClose={() => setShowFileInfo(false)}
            sheet
            title="File info"
          >
            <div className="space-y-3 px-1 text-xs select-none">
              <div className="flex items-center justify-between py-1 border-b border-md-outline-variant/20">
                <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">Name</span>
                <span className="font-medium text-md-on-surface truncate max-w-[200px] text-right">{file.name}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-md-outline-variant/20">
                <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">Size</span>
                <span className="font-mono font-semibold text-md-on-surface">{formatBytes(file.size)}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-md-outline-variant/20">
                <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">Date</span>
                <span className="font-medium text-md-on-surface">{fileDateStr}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-md-outline-variant/20">
                <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">Extension</span>
                <span className="font-mono font-semibold text-md-primary bg-md-primary-container px-2 py-0.5 rounded-md text-[10px]">.{ext}</span>
              </div>
              {file.mimeType && (
                <div className="flex items-center justify-between py-1 border-b border-md-outline-variant/20">
                  <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">MIME</span>
                  <span className="font-mono text-[11px] text-md-on-surface-variant truncate max-w-[200px]" title={file.mimeType}>{file.mimeType}</span>
                </div>
              )}
              {file.uploaderName && (
                <div className="flex items-center justify-between py-1 border-b border-md-outline-variant/20">
                  <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">Uploader</span>
                  <span className="font-medium text-md-on-surface truncate max-w-[200px] text-right">{file.uploaderName}</span>
                </div>
              )}
              <div className="flex items-center justify-between py-1">
                <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">ID</span>
                <span className="font-mono text-[10px] text-md-on-surface">{file.id}</span>
              </div>
            </div>
          </Modal>
        )}

        {/* ═══════════════════════════════════════════════
            CONTENT AREA
            ═══════════════════════════════════════════════ */}
        <div
          ref={contentAreaRef}
          className="relative flex-1 min-h-0 overflow-hidden bg-black"
          /* Device rotation resizes the WebView in intermediate steps;
             without a transition the gallery jumps at each step.
             This transition blends the steps into a single smooth morph: each
             resize retargets the animation (the image, being 100% of the
             container, follows it frame by frame). */
          style={{ transition: "width 0.3s ease, height 0.3s ease" }}
        >
          {!url && (!isImage || error) ? (
            /* ─── Loading / Error State ─── */
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-full max-w-sm p-8 text-center space-y-6">
                {error ? (
                  <>
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-white/[0.06] flex items-center justify-center">
                      <svg className="w-8 h-8 text-red-400/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                      </svg>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-white font-semibold text-base">Preview unavailable</p>
                      <p className="text-sm text-white/40 leading-relaxed">{error}</p>
                    </div>
                    {onDownload && (
                      <button
                        onClick={onDownload}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 transition-colors active:scale-95"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download Instead
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    {/* Gradient ring progress */}
                    <div className="relative w-20 h-20 mx-auto">
                      <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="35" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
                        <circle
                          cx="40" cy="40" r="35" fill="none"
                          stroke="url(#progressGrad)" strokeWidth="4"
                          strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * 35}`}
                          strokeDashoffset={`${2 * Math.PI * 35 * (1 - (progress ?? 0) / 100)}`}
                          className="transition-all duration-500 ease-out"
                        />
                        <defs>
                          <linearGradient id="progressGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#6366f1" />
                            <stop offset="100%" stopColor="#06b6d4" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-white font-bold text-sm tabular-nums">
                          {progress !== undefined && progress !== null ? `${progress}%` : "0%"}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-white font-semibold text-base">Preparing preview</p>
                      <p className="text-sm text-white/35">
                        {progress !== undefined && progress !== null && progress > 0
                          ? `Downloading... ${progress}%`
                          : "Connecting to Telegram..."}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>
          ) : isImage ? (
            <SwiperGallery
              className={`w-full h-full ${!fromSwipe && navDir === "right" ? "animate-slide-in-right" : !fromSwipe && navDir === "left" ? "animate-slide-in-left" : ""}`}
              photos={galleryPhotosFinal}
              thumbMap={thumbUrls}
              initialIndex={galleryIndex}
              onIndexChange={handleGalleryIndexChange}
              onTap={handleGalleryTap}
              prefetched={
                prefetchedImagesRef.current.has(String(file.id))
                  ? { id: String(file.id), el: prefetchedImagesRef.current.get(String(file.id))! }
                  : null
              }
            />
          ) : (
            <div className="relative w-full h-full overflow-hidden">
              <div
              ref={imageContainerRef}
              className={`relative w-full h-full flex items-center justify-center overflow-hidden ${zoom > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"} ${!fromSwipe && navDir === "right" ? "animate-slide-in-right" : !fromSwipe && navDir === "left" ? "animate-slide-in-left" : ""}`}
              style={{ touchAction: "none" }}
              onWheel={handleWheel}
              onDoubleClick={handleImageDoubleClick}
              onMouseDown={handlePanStart}
              onMouseMove={handlePanMove}
              onClick={handleImmersiveTap}
              onTouchStart={handleImageTouchStart}
              onTouchMove={handleImageTouchMove}
              onTouchEnd={handleImageTouchEnd}
              onTouchCancel={() => {
                gestureActiveRef.current = false;
                setGestureActive(false);
              }}
            >
                  {(() => {
                    const filesList = files && files.length > 1 ? files : null;
                    const prev = filesList ? findAdjacentPreviewable(filesList, file.id, -1) : null;
                    const next = filesList ? findAdjacentPreviewable(filesList, file.id, 1) : null;
                    const trackTransition = gestureActive || (dragX !== 0 && !swipeOutDir) ? "none" : "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)";
                    /* willChange on the track's 3 wrappers: when moving with
                       translateX (2D) they are not promoted to a compositor
                       layer on their own; without a layer, each frame
                       re-rasterizes the content (video/canvas) on the CPU →
                       jank on low-end devices. With a layer, the swipe is a
                       mere GPU re-composite. */
                    const trackLayer = { willChange: "transform" as const, contain: "layout" as const };
                    return (
                      <>
                        <div
                          key={prev ? prev.id : "pool-prev"}
                          ref={prevWrapperRef}
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ transform: `translateX(calc(-100% + ${dragX}px))`, transition: trackTransition, ...trackLayer }}
                        >
                          {prev && (isVideoFile(prev) ? (
                            <MemoVideoPlayerView
                              f={prev}
                              isCurrent={false}
                              client={client}
                              driveConfig={driveConfig}
                              ext={ext}
                              videoRef={videoRef}
                              ogvContainerRef={ogvContainerRef}
                              videoContainerRef={videoContainerRef}
                              onMouseMove={resetControlsTimer}
                              onImmersiveTap={handleVideoImmersiveTap}
                              onPlay={handleVideoPlay}
                              onPause={handleVideoPause}
                              onTimeUpdate={onVideoTimeUpdate}
                              onLoadedMetadata={handleVideoLoadedMetadata}
                              onLoadedData={handleVideoLoadedData}
                              onCanPlay={handleVideoCanPlay}
                              onCanPlayThrough={handleVideoCanPlayThrough}
                              onSeeking={handleVideoSeeking}
                              onSeeked={handleVideoSeeked}
                              onWaiting={handleVideoWaiting}
                              onPlaying={handleVideoPlaying}
                              onError={handleVideoError}
                              onSeek={handleVideoSeek}
                              onSeekTooltip={handleSeekTooltip}
                              onSeekTooltipLeave={handleSeekTooltipLeave}
                              onTogglePlay={toggleVideoPlay}
                              onToggleMute={handleVideoMuteToggle}
                              onVolumeChange={handleVideoVolumeChange}
                              onToggleSpeedMenu={handleToggleSpeedMenu}
                              onSpeedSelect={handleSpeedSelect}
                              onTogglePiP={togglePiP}
                              onToggleFullscreen={toggleFullscreen}
                              onNativePlay={handleNativePlay}
                              nativePlayProgress={nativePlayProgress}
                              canNativePlay={canNativePlay}
                            />
                          ) : (
                            <GalleryMediaSlot f={prev} onImagePrefetch={handleImagePrefetch} />
                          ))}
                        </div>
                        <div
                          key={next ? next.id : "pool-next"}
                          ref={nextWrapperRef}
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ transform: `translateX(calc(100% + ${dragX}px))`, transition: trackTransition, ...trackLayer }}
                        >
                          {next && (isVideoFile(next) ? (
                            <MemoVideoPlayerView
                              f={next}
                              isCurrent={false}
                              client={client}
                              driveConfig={driveConfig}
                              ext={ext}
                              videoRef={videoRef}
                              ogvContainerRef={ogvContainerRef}
                              videoContainerRef={videoContainerRef}
                              onMouseMove={resetControlsTimer}
                              onImmersiveTap={handleVideoImmersiveTap}
                              onPlay={handleVideoPlay}
                              onPause={handleVideoPause}
                              onTimeUpdate={onVideoTimeUpdate}
                              onLoadedMetadata={handleVideoLoadedMetadata}
                              onLoadedData={handleVideoLoadedData}
                              onCanPlay={handleVideoCanPlay}
                              onCanPlayThrough={handleVideoCanPlayThrough}
                              onSeeking={handleVideoSeeking}
                              onSeeked={handleVideoSeeked}
                              onWaiting={handleVideoWaiting}
                              onPlaying={handleVideoPlaying}
                              onError={handleVideoError}
                              onSeek={handleVideoSeek}
                              onSeekTooltip={handleSeekTooltip}
                              onSeekTooltipLeave={handleSeekTooltipLeave}
                              onTogglePlay={toggleVideoPlay}
                              onToggleMute={handleVideoMuteToggle}
                              onVolumeChange={handleVideoVolumeChange}
                              onToggleSpeedMenu={handleToggleSpeedMenu}
                              onSpeedSelect={handleSpeedSelect}
                              onTogglePiP={togglePiP}
                              onToggleFullscreen={toggleFullscreen}
                              onNativePlay={handleNativePlay}
                              nativePlayProgress={nativePlayProgress}
                              canNativePlay={canNativePlay}
                            />
                          ) : (
                            <GalleryMediaSlot f={next} onImagePrefetch={handleImagePrefetch} />
                          ))}
                        </div>
                        <div
                          key={file.id}
                          ref={currentWrapperRef}
                          className="absolute inset-0 flex items-center justify-center"
                          style={{ transform: `translateX(${dragX}px)`, transition: gestureActive || (dragX !== 0 && !swipeOutDir) ? "none" : "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)", ...trackLayer }}
                        >
                          {isImage ? (
                            <GalleryMediaSlot
                              f={file}
                              url={url}
                              isCurrent
                              imageElRef={imageElRef}
                              zoom={zoom}
                              panOffset={panOffset}
                              rotation={rotation}
                              isPanning={isPanning}
                              isPinching={isPinching}
                              imageLoaded={imageLoaded}
                              onImageLoad={() => setImageLoaded(true)}
                            />
                          ) : isVideo ? (
                            <MemoVideoPlayerView
                              f={file}
                              url={url}
                              isCurrent
                              client={client}
                              driveConfig={driveConfig}
                              ext={ext}
                              videoRef={videoRef}
                              ogvContainerRef={ogvContainerRef}
                              videoContainerRef={videoContainerRef}
                              videoError={videoError}
                              immersive={immersive}
                              useOgv={useOgv}
                              videoPlaying={videoPlaying}
                              buffering={buffering}
                              controlsVisible={controlsVisible}
                              videoTime={videoTime}
                              videoDuration={videoDuration}
                              videoBuffered={videoBuffered}
                              videoMuted={videoMuted}
                              videoVolume={videoVolume}
                              playbackSpeed={playbackSpeed}
                              showSpeedMenu={showSpeedMenu}
                              seekTooltip={seekTooltip}
                              isFullscreen={isFullscreen}
                              onDownload={onDownload}
                              onMouseMove={resetControlsTimer}
                              onImmersiveTap={handleVideoImmersiveTap}
                              onPlay={handleVideoPlay}
                              onPause={handleVideoPause}
                              onTimeUpdate={onVideoTimeUpdate}
                              onLoadedMetadata={handleVideoLoadedMetadata}
                              onLoadedData={handleVideoLoadedData}
                              onCanPlay={handleVideoCanPlay}
                              onCanPlayThrough={handleVideoCanPlayThrough}
                              onSeeking={handleVideoSeeking}
                              onSeeked={handleVideoSeeked}
                              onWaiting={handleVideoWaiting}
                              onPlaying={handleVideoPlaying}
                              onError={handleVideoError}
                              onSeek={handleVideoSeek}
                              onSeekTooltip={handleSeekTooltip}
                              onSeekTooltipLeave={handleSeekTooltipLeave}
                              onTogglePlay={toggleVideoPlay}
                              onToggleMute={handleVideoMuteToggle}
                              onVolumeChange={handleVideoVolumeChange}
                              onToggleSpeedMenu={handleToggleSpeedMenu}
                              onSpeedSelect={handleSpeedSelect}
                              onTogglePiP={togglePiP}
                              onToggleFullscreen={toggleFullscreen}
                              onNativePlay={handleNativePlay}
                              nativePlayProgress={nativePlayProgress}
                              canNativePlay={canNativePlay}
                            />
                ) : isAudio ? (
              <div className="w-full max-w-md mx-auto p-8 select-none">
                  <div className="bg-[#111115] border border-white/[0.06] rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
                    {isDsd && dsdLoading ? (
                      <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                        <svg className="animate-spin h-6 w-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                        </svg>
                        <span className="text-white/40 text-xs font-semibold">Decoding high-resolution DSD stream...</span>
                      </div>
                    ) : isDsd && dsdError ? (
                      <div className="text-center py-12 space-y-3">
                        <svg className="w-10 h-10 mx-auto text-danger/75" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span className="text-danger/80 text-xs font-semibold block">{dsdError}</span>
                      </div>
                    ) : (
                      <>
                        {/* Album art cover / Visualizer */}
                        <div className="relative w-36 h-36 sm:w-44 sm:h-44 mx-auto overflow-hidden rounded-2xl border border-white/10 shadow-2xl bg-slate-900 flex items-center justify-center group">
                          <FileCardThumbnail
                            file={file}
                            client={client}
                            driveConfig={driveConfig}
                            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                          <canvas 
                            ref={canvasRef} 
                            className="absolute inset-0 w-full h-full pointer-events-none opacity-40 mix-blend-screen" 
                          />
                          <div className={`z-10 w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-black/70 border border-white/20 flex items-center justify-center transition-all ${audioPlaying ? "scale-90 opacity-40 hover:opacity-100" : "scale-100 shadow-lg"}`}>
                            <svg className="w-6 h-6 sm:w-7 sm:h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                            </svg>
                          </div>
                        </div>

                        {/* File name */}
                        <div className="text-center">
                          <h4 className="text-white/90 text-sm font-semibold truncate px-4">{file.name}</h4>
                          <p className="text-white/30 text-[10px] uppercase tracking-wider font-medium mt-1">{formatBytes(file.size)} • {isDsdFile ? "DSD Audio" : "Audio"}</p>
                        </div>

                        <audio
                          ref={audioRef}
                          src={isDsd ? (dsdDecodedUrl || "") : (url || "")}
                          preload="auto"
                          onTimeUpdate={() => { if (audioRef.current) setAudioTime(audioRef.current.currentTime); }}
                          onLoadedMetadata={() => { if (audioRef.current) setAudioDuration(audioRef.current.duration); }}
                          onEnded={() => setAudioPlaying(false)}
                          className="hidden"
                        />
                      </>
                    )}

                    {/* Seek bar */}
                    <div className="space-y-2">
                      <div className="relative h-6 flex items-center">
                        <div className="absolute left-0 right-0 h-1 rounded-full bg-white/[0.08]" />
                        <div className="absolute left-0 h-1 rounded-full bg-brand-400 transition-all duration-100" style={{ width: `${audioDuration > 0 ? (audioTime / audioDuration) * 100 : 0}%` }} />
                        <input
                          type="range"
                          min={0}
                          max={audioDuration || 100}
                          step={0.1}
                          value={audioTime}
                          onChange={(e) => { const t = parseFloat(e.target.value); if (audioRef.current) { audioRef.current.currentTime = t; } setAudioTime(t); }}
                          className="range-native absolute inset-0 w-full"
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-white/30 tabular-nums">
                        <span>{formatTime(audioTime)}</span>
                        <span>{formatTime(audioDuration)}</span>
                      </div>
                    </div>

                    {/* Controls row */}
                    <div className="flex items-center justify-center gap-4">
                      {/* Skip -15s */}
                      <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15); }} className="w-10 h-10 rounded-full bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 flex items-center justify-center transition-all cursor-pointer" title="Rewind 15s">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18.75 19.5l-7.5-7.5 7.5-7.5m-6 15L5.25 12l7.5-7.5" /></svg>
                      </button>

                      {/* Play/Pause */}
                      <button
                        onClick={toggleAudioPlay}
                        className="w-14 h-14 rounded-full bg-brand-500 hover:bg-brand-400 text-white flex items-center justify-center shadow-lg shadow-brand-500/25 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                      >
                        {audioPlaying ? (
                          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
                        ) : (
                          <svg className="w-6 h-6 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        )}
                      </button>

                      {/* Skip +15s */}
                      <button onClick={() => { if (audioRef.current) audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 15); }} className="w-10 h-10 rounded-full bg-white/[0.06] hover:bg-white/[0.1] text-white/50 hover:text-white/80 flex items-center justify-center transition-all cursor-pointer" title="Forward 15s">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5" /></svg>
                      </button>
                    </div>

                    {/* Secondary controls */}
                    <div className="flex items-center justify-between px-2">
                      {/* Volume */}
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={audioVolume}
                          onChange={(e) => setAudioVolume(parseFloat(e.target.value))}
                          className="range-native range-volume w-16"
                        />
                      </div>

                      {/* Speed */}
                      <button
                        onClick={() => {
                          const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
                          const idx = speeds.indexOf(audioSpeed);
                          setAudioSpeed(speeds[(idx + 1) % speeds.length]);
                        }}
                        className="h-6 px-2.5 rounded-md bg-white/[0.06] hover:bg-white/[0.1] text-[10px] font-bold text-white/50 hover:text-white/80 transition-all cursor-pointer"
                        title="Playback Speed"
                      >
                        {audioSpeed}x
                      </button>
                    </div>
                  </div>
                </div>
              ) : isText ? (
              <div className="w-full h-full max-w-4xl mx-auto p-3 sm:p-4 overflow-auto">
                  <div className="bg-[#0d1117] border border-white/[0.06] rounded-xl overflow-hidden min-h-full">
                    {isTextLoading ? (
                      <div className="flex items-center justify-center p-20 gap-3">
                        <svg className="animate-spin h-5 w-5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                          <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                        </svg>
                        <span className="text-white/40 text-sm">Loading document...</span>
                      </div>
                    ) : (
                      <div className="flex text-xs font-mono leading-relaxed">
                        {/* Line numbers */}
                        <div className="select-none text-right pr-3 pl-3 py-4 text-white/15 border-r border-white/[0.04] bg-white/[0.02] shrink-0 sticky left-0">
                          {(textContent || "").split("\n").map((_, i) => (
                            <div key={i} className="leading-relaxed">{i + 1}</div>
                          ))}
                        </div>
                        {/* Content */}
                        <pre className="whitespace-pre-wrap p-4 text-white/75 select-text flex-1 min-w-0 overflow-x-auto">
                          {textContent || "(Empty file)"}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              ) : isPdf ? (
              <div className="w-full h-full max-w-5xl mx-auto p-2 sm:p-4 flex flex-col">
                  {/* Browser-style header */}
                  <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-[#141414] border border-white/[0.06] rounded-t-xl">
                    {/* Traffic lights */}
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                    </div>
                    {/* Document badge */}
                    <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-1 flex-1 min-w-0">
                      <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      <span className="text-[11px] font-semibold text-white/50 truncate">{file.name}</span>
                      <span className="text-[10px] font-bold text-red-400/80 bg-red-500/10 border border-red-500/15 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">PDF</span>
                    </div>
                    {/* Download shortcut */}
                    {onDownload && (
                      <button
                        onClick={onDownload}
                        className="h-7 px-3 rounded-lg bg-white/[0.06] hover:bg-brand-500/20 text-[10px] font-bold text-white/50 hover:text-brand-400 transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Save
                      </button>
                    )}
                  </div>
                  {/* Iframe */}
                  <div className="flex-1 min-h-0 bg-[#111] border-x border-b border-white/[0.06] rounded-b-xl overflow-hidden shadow-2xl">
                    <iframe
                      src={`${url}#toolbar=0&navpanes=0`}
                      className="w-full h-full border-0 bg-[#111]"
                      title={file.name}
                    />
                  </div>
                </div>
              ) : isSheet ? (
              <div className="w-full h-full max-w-5xl mx-auto p-2 sm:p-4 flex flex-col text-left">
                  {isSheetLoading ? (
                    <div className="flex-1 flex items-center justify-center gap-3">
                      <svg className="animate-spin h-5 w-5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                      </svg>
                      <span className="text-white/40 text-sm font-medium">Parsing spreadsheet data...</span>
                    </div>
                  ) : (
                    <>
                      {/* Sheet tabs */}
                      {sheetNames.length > 0 && (
                        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto pb-1 shrink-0">
                          {sheetNames.map((name, index) => (
                            <button
                              key={name}
                              onClick={() => handleSheetSwitch(index)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 ${
                                activeSheetIndex === index
                                  ? "bg-brand-500 text-white shadow-md"
                                  : "bg-white/[0.06] text-white/50 hover:text-white/80 hover:bg-white/[0.1]"
                              }`}
                            >
                              {name}
                            </button>
                          ))}
                        </div>
                      )}
                      
                      {/* Table */}
                      <div className="flex-1 overflow-auto rounded-xl border border-white/[0.06] bg-[#0d1117]">
                        {sheetData && sheetData.length > 0 ? (
                          <table className="w-full border-collapse text-left text-xs text-white/75">
                            <thead className="sticky top-0 z-10">
                              <tr className="bg-[#161b22] border-b border-white/[0.06] divide-x divide-white/[0.04]">
                                <th className="px-3 py-2.5 text-center text-white/30 font-bold w-10">#</th>
                                {sheetData[0].map((_, colIdx) => (
                                  <th key={colIdx} className="px-3 py-2.5 text-white/40 font-bold min-w-[125px] tracking-wide text-[10px] uppercase">
                                    {String.fromCharCode(65 + (colIdx % 26)) + (colIdx >= 26 ? Math.floor(colIdx / 26) : "")}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.03]">
                              {sheetData.map((row, rowIdx) => (
                                <tr key={rowIdx} className="hover:bg-white/[0.03] divide-x divide-white/[0.03]">
                                  <td className="px-3 py-1.5 text-center bg-[#161b22]/60 text-white/25 select-none font-bold w-10 text-[10px]">{rowIdx + 1}</td>
                                  {row.map((cell, colIdx) => (
                                    <td key={colIdx} className="px-3 py-1.5 truncate max-w-[200px] font-medium" title={String(cell)}>
                                      {String(cell ?? "")}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="flex items-center justify-center p-20 text-white/30 font-medium">
                            No data found in this sheet
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : isDocx ? (
              <div className="w-full h-full max-w-4xl mx-auto p-2 sm:p-4 flex flex-col relative">
                  {loadingDocx && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 gap-3">
                      <svg className="animate-spin h-5 w-5 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeWidth={4} className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                      </svg>
                      <span className="text-white/40 text-sm">Rendering document pages...</span>
                    </div>
                  )}
                  {/* Document desk header */}
                  <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-[#1a1a1a] border border-white/[0.06] rounded-t-xl">
                    <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span className="text-[11px] font-semibold text-white/50 truncate flex-1">{file.name}</span>
                    <span className="text-[10px] font-bold text-blue-400/80 bg-blue-500/10 border border-blue-500/15 px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0">DOCX</span>
                  </div>
                  {/* White page with shadow - simulates real paper */}
                  <div className="flex-1 overflow-auto bg-[#2a2a2e] border-x border-b border-white/[0.06] rounded-b-xl">
                    <div className="mx-auto my-6 sm:my-8 max-w-[720px] bg-white rounded-sm shadow-[0_2px_24px_rgba(0,0,0,0.35)] p-8 sm:p-12 md:p-16 text-left select-text min-h-[80%]">
                      <style dangerouslySetInnerHTML={{__html: `
                        .docx-preview-body { background: transparent !important; color: #1a1a1a !important; font-family: 'Inter', 'Georgia', serif !important; font-size: 14px !important; }
                        .docx-preview-body p { margin-bottom: 0.75rem !important; line-height: 1.75 !important; color: #333 !important; }
                        .docx-preview-body h1, .docx-preview-body h2, .docx-preview-body h3 { color: #111111 !important; font-weight: 700 !important; margin-top: 1.5rem !important; margin-bottom: 0.75rem !important; }
                        .docx-preview-body table { width: 100% !important; border-collapse: collapse !important; margin: 1rem 0 !important; }
                        .docx-preview-body td, .docx-preview-body th { border: 1px solid #ddd !important; padding: 8px !important; }
                      `}} />
                      <div ref={docxContainerRef} className="w-full h-full" />
                    </div>
                  </div>
                </div>
              ) : isEpub ? (
              <div className="w-full h-full max-w-4xl mx-auto p-2 sm:p-4 flex flex-col relative animate-fade-in select-none">
                  {loadingEpub && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-20 gap-3 rounded-2xl">
                      <svg className="animate-spin h-6 w-6 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <circle cx="12" cy="12" r="10" strokeWidth={3.5} className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                      </svg>
                      <span className="text-white/50 text-xs font-semibold tracking-wider">PREPARING PAGES...</span>
                    </div>
                  )}
                  {epubError ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-[#121214] border border-white/[0.06] rounded-2xl">
                      <svg className="w-12 h-12 text-danger/60 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <p className="text-white font-semibold">{epubError}</p>
                    </div>
                  ) : (
                    <div className={`flex-1 flex flex-col overflow-hidden ${currentThemeStyle.bg} border ${currentThemeStyle.border} rounded-2xl relative shadow-2xl transition-all duration-300`}>
                      
                      {/* Premium Top Toolbar */}
                      <div className={`flex items-center justify-between border-b ${currentThemeStyle.border} px-4 py-2.5 shrink-0 gap-3`}>
                        {/* Left: TOC Dropdown */}
                        {epubToc.length > 0 ? (
                          <div className="flex items-center gap-2 max-w-[50%] sm:max-w-[60%]">
                            <svg className={`w-3.5 h-3.5 opacity-60 ${currentThemeStyle.text}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                            <select
                              value={epubCurrentChapterRef}
                              onChange={(e) => {
                                setEpubCurrentChapterRef(e.target.value);
                                renditionRef.current?.display(e.target.value);
                              }}
                              className={`text-[11px] font-semibold tracking-wide ${currentThemeStyle.text} bg-transparent border-0 cursor-pointer focus:outline-none max-w-[140px] sm:max-w-[280px] truncate`}
                            >
                              {epubToc.map((chapter, idx) => (
                                <option key={idx} value={chapter.href} className="bg-[#18181b] text-white">
                                  {chapter.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <span className={`text-[10px] font-bold tracking-wide uppercase opacity-40 select-none ${currentThemeStyle.text}`}>
                            EPUB eBook Reader
                          </span>
                        )}

                        {/* Right: Font Settings & Themes */}
                        <div className="flex items-center gap-3">
                          {/* Font controls */}
                          <div className={`flex items-center bg-black/[0.04] dark:bg-white/[0.04] border ${currentThemeStyle.border} p-0.5 rounded-lg`}>
                            <button
                              onClick={() => setEpubFontSize(prev => Math.max(70, prev - 10))}
                              disabled={epubFontSize <= 70}
                              className={`w-6 h-6 text-[10px] font-bold flex items-center justify-center rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.05] disabled:opacity-20 active:scale-95 transition-all cursor-pointer ${currentThemeStyle.text}`}
                            >
                              A-
                            </button>
                            <span className={`text-[10px] font-bold px-1.5 min-w-[32px] text-center opacity-70 ${currentThemeStyle.text}`}>{epubFontSize}%</span>
                            <button
                              onClick={() => setEpubFontSize(prev => Math.min(180, prev + 10))}
                              disabled={epubFontSize >= 180}
                              className={`w-6 h-6 text-[10px] font-bold flex items-center justify-center rounded hover:bg-black/[0.05] dark:hover:bg-white/[0.05] disabled:opacity-20 active:scale-95 transition-all cursor-pointer ${currentThemeStyle.text}`}
                            >
                              A+
                            </button>
                          </div>

                          {/* Theme circles */}
                          <div className="flex items-center gap-1">
                            {(["light", "cream", "sepia", "dark"] as const).map((t) => (
                              <button
                                key={t}
                                onClick={() => setEpubTheme(t)}
                                className={`w-5 h-5 rounded-full border transition-all relative cursor-pointer active:scale-90 ${
                                  epubTheme === t
                                    ? "ring-1.5 ring-brand-400 border-transparent scale-110"
                                    : "border-black/10 dark:border-white/10 hover:scale-105"
                                }`}
                                style={{
                                  backgroundColor: t === "light" ? "#ffffff" : t === "cream" ? "#faf6ee" : t === "sepia" ? "#f4ecd8" : "#121214"
                                }}
                                title={`${t.charAt(0).toUpperCase() + t.slice(1)} Theme`}
                              />
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Viewport Frame with Floating Side-Paginators */}
                      <div className="flex-1 w-full relative flex items-center justify-between p-2 sm:p-4 overflow-hidden">
                        
                        {/* Floating Left Arrow */}
                        <button
                          onClick={() => renditionRef.current?.prev()}
                          className={`absolute left-4 z-15 w-10 h-10 rounded-full flex items-center justify-center bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 active:scale-95 border ${currentThemeStyle.border} ${currentThemeStyle.text} transition-all shadow-md group cursor-pointer hidden md:flex`}
                        >
                          <svg className="w-4 h-4 translate-x-[-1px] group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>

                        {/* Reading iframe container */}
                        <div ref={epubContainerRef} className="flex-1 h-full w-full overflow-hidden px-4 md:px-12" />

                        {/* Floating Right Arrow */}
                        <button
                          onClick={() => renditionRef.current?.next()}
                          className={`absolute right-4 z-15 w-10 h-10 rounded-full flex items-center justify-center bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 active:scale-95 border ${currentThemeStyle.border} ${currentThemeStyle.text} transition-all shadow-md group cursor-pointer hidden md:flex`}
                        >
                          <svg className="w-4 h-4 translate-x-[1px] group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>

                      {/* Sleek Bottom Pagination Bar */}
                      <div className={`flex items-center justify-between border-t ${currentThemeStyle.border} pt-3 mt-auto pb-1.5 px-4 shrink-0`}>
                        <button
                          onClick={() => renditionRef.current?.prev()}
                          className={`px-3 py-1.5 text-xs font-bold ${currentThemeStyle.text} bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg active:scale-95 transition-all cursor-pointer flex md:hidden`}
                        >
                          Previous
                        </button>

                        <div className={`text-[10px] font-bold opacity-45 uppercase tracking-wider mx-auto select-none ${currentThemeStyle.text}`}>
                          {epubProgress !== "0%" ? `Progress: ${epubProgress}` : "eBook Preview"}
                        </div>

                        <button
                          onClick={() => renditionRef.current?.next()}
                          className={`px-3 py-1.5 text-xs font-bold ${currentThemeStyle.text} bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-lg active:scale-95 transition-all cursor-pointer flex md:hidden`}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </div>
) : (
              <div className="text-center p-8">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-white/[0.06] flex items-center justify-center mb-4">
                    <FileIcon fileName={file.name} className="w-8 h-8" />
                  </div>
                  <p className="text-white font-semibold">No preview available</p>
                  <p className="text-white/35 text-sm mt-1">Download to view this file.</p>
                  {onDownload && (
                    <button
                      onClick={onDownload}
                      className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 transition-colors active:scale-95"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Download
                    </button>
                  )}
                </div>
              )}
            </div>
            </>
            );
          })()}

            </div>
            </div>
          )}
        </div>

        {/* ─── Header action menu ─── */}
        <ActionSheet
          open={showPreviewMenu}
          onClose={() => setShowPreviewMenu(false)}
          title={file.name}
          subtitle={`${formatBytes(file.size)} • ${fileDateStr}`}
          actions={[
            {
              id: "info",
              label: "File info",
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              onClick: () => setShowFileInfo(true),
            },
            ...(onToggleLike
              ? [
                  {
                    id: "fav",
                    label: isLiked ? "Remove from favourites" : "Add to favourites",
                    icon: (
                      <svg className="w-5 h-5" fill={isLiked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isLiked ? 0 : 2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    ),
                    onClick: onToggleLike,
                  },
                ]
              : []),
            ...(onOpenMoveCopy
              ? [
                  {
                    id: "move",
                    label: "Move or copy",
                    icon: (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                    ),
                    onClick: onOpenMoveCopy,
                  },
                ]
              : []),
            ...(onDownload
              ? [
                  {
                    id: "download",
                    label: "Download",
                    accent: true,
                    icon: (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    ),
                    onClick: onDownload,
                  },
                ]
              : []),
            {
              id: "close",
              label: "Close preview",
              danger: true,
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ),
              onClick: handleClose,
            },
          ]}
        />

        {/* ─── Video playback options (3 dots) ─── */}
        <ActionSheet
          open={showSpeedMenu}
          onClose={() => setShowSpeedMenu(false)}
          title="Playback options"
          subtitle={`${playbackSpeed}x speed${videoLoop ? " · Loop ON" : ""}`}
          actions={[
            {
              id: "loop",
              label: "Loop video",
              accent: videoLoop,
              icon: videoLoop ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4.1 9a8 8 0 0113.6-3.7L20 7M4 17l2.3 1.7A8 8 0 0019.9 15" />
                </svg>
              ),
              onClick: handleToggleLoop,
            },
            ...([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((speed) => ({
              id: `speed-${speed}`,
              label: `${speed}x${speed === 1 ? " (Normal)" : ""}`,
              accent: playbackSpeed === speed,
              icon:
                playbackSpeed === speed ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" /></svg>
                ),
              onClick: () => handleSpeedSelect(speed),
            }))),
          ]}
        />
      </div>
    </div>
  );
}
