import React, { useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { UploadProgress, DownloadProgress } from "../../types";
import { ProgressBar } from "../ui/ProgressBar";
import { formatBytes } from "../../lib/manifest";

interface FloatingTransferWidgetProps {
  uploads: UploadProgress[];
  downloadProgress: DownloadProgress | null;
  onCancelUpload?: (fileId: string) => void;
  onCancelDownload?: () => void;
}

export function FloatingTransferWidget({
  uploads,
  downloadProgress,
  onCancelUpload,
  onCancelDownload,
}: FloatingTransferWidgetProps) {
  const activeUploads = uploads.filter((u) => u.status !== "done");
  const hasTransfers = activeUploads.length > 0 || downloadProgress !== null;

  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef<{ pointerX: number; pointerY: number; initialOffsetX: number; initialOffsetY: number } | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = (e: React.PointerEvent) => {
    // Prevent drag if clicking close/cancel buttons
    if ((e.target as HTMLElement).closest("button")) {
      return;
    }
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);

    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      initialOffsetX: dragOffset.x,
      initialOffsetY: dragOffset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartRef.current) return;
    const deltaX = e.clientX - dragStartRef.current.pointerX;
    const deltaY = e.clientY - dragStartRef.current.pointerY;

    setDragOffset({
      x: dragStartRef.current.initialOffsetX + deltaX,
      y: dragStartRef.current.initialOffsetY + deltaY,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragStartRef.current = null;
    }
  };

  if (!hasTransfers) {
    return null;
  }

  const totalSpeed =
    activeUploads.reduce((acc, u) => acc + (u.speedBps || 0), 0) +
    (downloadProgress?.speedBps || 0);

  const transferCount = activeUploads.length + (downloadProgress ? 1 : 0);

  const widgetJSX = (
    <div
      ref={widgetRef}
      style={{
        transform: `translate(calc(-50% + ${dragOffset.x}px), ${dragOffset.y}px)`,
      }}
      className={`fixed top-16 sm:top-5 left-1/2 z-[10000] select-none touch-none transition-shadow duration-200 ${
        isDragging ? "cursor-grabbing opacity-90 scale-[1.02]" : "cursor-grab"
      }`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {!isExpanded ? (
        /* Collapsed Floating Badge */
        <div
          onClick={() => setIsExpanded(true)}
          className="flex items-center gap-2.5 sm:gap-3 px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-full anymex-glass text-md-on-surface hover:border-md-primary/40 transition-all group"
        >
          {/* Animated Transfer Indicator */}
          <div className="relative flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-md-primary-container text-md-on-primary-container shrink-0">
            <svg
              className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-md-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-md-primary"></span>
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-xs font-bold text-md-on-surface leading-tight whitespace-nowrap">
              {transferCount} Active {transferCount === 1 ? "Transfer" : "Transfers"}
            </span>
            {totalSpeed > 0 && (
              <span className="text-[10px] font-semibold text-md-primary font-mono">
                {formatBytes(totalSpeed)}/s
              </span>
            )}
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(true);
            }}
            className="p-1 text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-highest rounded-full transition-all cursor-pointer"
            title="Expand Details"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      ) : (
        /* Expanded Floating Progress Card */
        <div className="w-[calc(100vw_-_24px)] max-w-[360px] rounded-2xl anymex-glass text-md-on-surface p-4 space-y-3">
          {/* Header Drag Bar */}
          <div className="flex items-center justify-between border-b border-md-outline-variant/30 pb-2.5">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-md-primary animate-pulse" />
              <span className="text-xs font-bold text-md-on-surface tracking-wide uppercase">
                Active Transfers ({transferCount})
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsExpanded(false)}
                className="p-1 text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-highest rounded-full transition-all cursor-pointer"
                title="Collapse"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                </svg>
              </button>
            </div>
          </div>

          {/* Active Uploads */}
          {activeUploads.map((u) => (
            <div
              key={u.fileId}
              className="p-3 rounded-2xl bg-md-surface-container-low dark:bg-md-surface-container border border-md-outline-variant/20 space-y-2"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-md-on-surface truncate mr-2">
                  ⬆️ {u.fileName}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono font-bold text-md-primary">
                    {u.status === "uploading"
                      ? `${Math.round((u.uploadedBytes / (u.totalBytes || 1)) * 100)}%`
                      : u.status === "finalizing"
                      ? "Finalizing..."
                      : u.status === "error"
                      ? "Error"
                      : "Preparing..."}
                  </span>
                  {(u.status === "uploading" || u.status === "preparing") && onCancelUpload && (
                    <button
                      onClick={() => onCancelUpload(u.fileId)}
                      className="p-1 text-md-on-surface-variant hover:text-md-error hover:bg-md-surface-container-highest rounded-full transition-all cursor-pointer"
                      title="Cancel Upload"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <ProgressBar
                value={u.totalBytes > 0 ? (u.uploadedBytes / u.totalBytes) * 100 : 0}
                color={u.status === "error" ? "brand" : "accent"}
              />
              <div className="flex justify-between text-[10px] text-md-on-surface-variant font-mono font-semibold uppercase">
                <span>
                  {formatBytes(u.uploadedBytes)} / {formatBytes(u.totalBytes)}
                </span>
                {u.speedBps ? <span>{formatBytes(u.speedBps)}/s</span> : null}
              </div>
            </div>
          ))}

          {/* Active Download */}
          {downloadProgress && (
            <div className="p-3 rounded-2xl bg-md-surface-container-low dark:bg-md-surface-container border border-md-outline-variant/20 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-md-on-surface truncate mr-2">
                  ⬇️ {downloadProgress.name}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono font-bold text-success">
                    {downloadProgress.progress}%
                  </span>
                  {onCancelDownload && (
                    <button
                      onClick={onCancelDownload}
                      className="p-1 text-md-on-surface-variant hover:text-md-error hover:bg-md-surface-container-highest rounded-full transition-all cursor-pointer"
                      title="Cancel Download"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
              <ProgressBar value={downloadProgress.progress} color="success" />
              <div className="flex justify-between text-[10px] text-md-on-surface-variant font-mono font-semibold uppercase">
                <span>
                  {formatBytes(downloadProgress.downloadedBytes)} / {formatBytes(downloadProgress.totalBytes)}
                </span>
                {downloadProgress.speedBps ? (
                  <span>{formatBytes(downloadProgress.speedBps)}/s</span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return typeof document !== "undefined" ? createPortal(widgetJSX, document.body) : null;
}
