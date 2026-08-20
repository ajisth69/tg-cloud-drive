import React, { useState, useRef, useEffect } from "react";
import type { TelegramClient } from "@mtcute/web";
import type { DriveFile, DriveConfig } from "../../types";
import { formatBytes } from "../../lib/manifest";
import { FileIcon } from "./FileIcon";
import { FileCardThumbnail } from "./FileCardThumbnail";
import { ActionSheet } from "../ui/ActionSheet";

interface FileGridProps {
  client?: TelegramClient | null;
  driveConfig?: DriveConfig | null;
  files: DriveFile[];
  loading: boolean;
  onDownload: (file: DriveFile) => void;
  onPreview: (file: DriveFile) => void;
  onRename?: (file: DriveFile) => void;
  onDelete?: (file: DriveFile) => void;
  selectedFileIds?: Set<number>;
  onToggleSelect?: (fileId: number) => void;
  onToggleSelectAll?: () => void;
  favouriteChunks?: Set<string>;
  onToggleLike?: (file: DriveFile) => void;
  onShare?: (file: DriveFile) => void;
  onOpenMoveCopy?: (files: DriveFile[]) => void;
  onOpenDetails?: (file: DriveFile) => void;
  gridBoxSize?: "small" | "medium" | "large";
}

const PAGE_SIZE = 50;

const ICON_CLASSES = "w-10 h-10 sm:w-11 sm:h-11 shrink-0";

function FileThumb({ file, client, driveConfig }: { file: DriveFile; client?: TelegramClient | null; driveConfig?: DriveConfig | null }) {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const isImage = file.mimeType?.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "heic", "tiff"].includes(ext);
  const isVideo = ["mp4", "webm", "mkv", "avi", "mov", "3gp", "flv", "ts"].includes(ext);
  if (isImage || isVideo) {
    return (
      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl overflow-hidden bg-md-surface-container shrink-0">
        <FileCardThumbnail
          file={file}
          client={client}
          driveConfig={driveConfig}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }
  return <FileIcon fileName={file.name} className={ICON_CLASSES} />;
}

export function FileGrid({
  client,
  driveConfig,
  files,
  loading,
  onDownload,
  onPreview,
  onRename,
  onDelete,
  selectedFileIds = new Set(),
  onToggleSelect,
  onToggleSelectAll,
  favouriteChunks = new Set(),
  onToggleLike,
  onShare,
  onOpenMoveCopy,
  onOpenDetails,
}: FileGridProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [actionFile, setActionFile] = useState<DriveFile | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const didLongPressRef = useRef(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const allVisible = visibleCount >= files.length;

  /* Infinite scroll (mobile): loads more rows when the sentinel enters
     the viewport, instead of the desktop "Load more" button. */
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || allVisible) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((c) => Math.min(c + PAGE_SIZE, files.length));
        }
      },
      { rootMargin: "600px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [allVisible, files.length]);

  if (loading) {
    return (
      <div className="space-y-1.5 animate-fade-in">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3.5 px-3 py-3 rounded-2xl bg-md-surface-container-low animate-pulse"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="w-10 h-10 rounded-xl bg-md-surface-container-high shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-md-surface-container-high rounded-md w-2/5" />
              <div className="h-2.5 bg-md-surface-container-high rounded-md w-1/4" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 animate-fade-in text-center select-none">
        <div className="w-20 h-20 mb-4 rounded-full bg-md-primary/10 flex items-center justify-center">
          <svg className="w-9 h-9 text-md-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-md-on-surface font-bold mb-1 text-[15px]">No files here</p>
        <p className="text-md-on-surface-variant text-xs max-w-[260px] leading-relaxed">
          Upload files to this folder to see them here.
        </p>
      </div>
    );
  }

  const groups = new Map<string, DriveFile[]>();
  for (const f of files) {
    const d = new Date(f.date * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  const visibleFiles = files.slice(0, visibleCount);

  const visibleGroups = new Map<string, DriveFile[]>();
  for (const f of visibleFiles) {
    const d = new Date(f.date * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!visibleGroups.has(key)) visibleGroups.set(key, []);
    visibleGroups.get(key)!.push(f);
  }
  const visibleKeys = Array.from(visibleGroups.keys()).sort((a, b) => b.localeCompare(a));

  const buildActions = (file: DriveFile) => {
    const isLiked = favouriteChunks.has(file.manifest.chunks.join(","));
    return [
      {
        id: "preview",
        label: "Open / View",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        ),
        onClick: () => onPreview(file),
      },
      {
        id: "share",
        label: "Share",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
        ),
        onClick: () => onShare?.(file),
        disabled: !onShare,
      },
      {
        id: "download",
        label: "Download",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        ),
        onClick: () => onDownload(file),
      },
      {
        id: "favourite",
        label: isLiked ? "Remove from Starred" : "Add to Starred",
        accent: true,
        icon: (
          <svg className="w-5 h-5" fill={isLiked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isLiked ? 0 : 2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        ),
        onClick: () => onToggleLike?.(file),
        disabled: !onToggleLike,
      },
      {
        id: "move",
        label: "Move / Copy",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        ),
        onClick: () => onOpenMoveCopy?.([file]),
        disabled: !onOpenMoveCopy,
      },
      {
        id: "details",
        label: "Details",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        onClick: () => onOpenDetails?.(file),
        disabled: !onOpenDetails,
      },
      {
        id: "select",
        label: selectedFileIds.has(file.id) ? "Deselect" : "Select",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        onClick: () => onToggleSelect?.(file.id),
        disabled: !onToggleSelect,
      },
      ...(onRename
        ? [
            {
              id: "rename",
              label: "Rename",
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
              ),
              onClick: () => onRename(file),
            },
          ]
        : []),
      ...(onDelete
        ? [
            {
              id: "delete",
              label: "Delete",
              danger: true,
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              ),
              onClick: () => onDelete(file),
            },
          ]
        : []),
    ];
  };

  const handleLongPressStart = (file: DriveFile, e: React.TouchEvent) => {
    didLongPressRef.current = false;
    const target = e.target as HTMLElement;
    if (target.closest("button")) return; // don't select when tapping the row's buttons
    const t = e.touches[0];
    longPressStartRef.current = { x: t.clientX, y: t.clientY };
    longPressTimer.current = window.setTimeout(() => {
      didLongPressRef.current = true;
      onToggleSelect?.(file.id);
    }, 450);
  };

  /* Cancels if the finger moves (the user is scrolling), not on any
     touchmove: previously a slow scroll accidentally selected rows. */
  const handleLongPressMove = (e: React.TouchEvent) => {
    if (longPressTimer.current == null || !longPressStartRef.current) return;
    const t = e.touches[0];
    const dist = Math.hypot(t.clientX - longPressStartRef.current.x, t.clientY - longPressStartRef.current.y);
    if (dist > 12) {
      handleLongPressEnd();
    }
  };

  const handleLongPressEnd = () => {
    longPressStartRef.current = null;
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const anySelected = selectedFileIds.size > 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* File rows grouped by month */}
      {visibleKeys.map((key) => {
        const sectionFiles = visibleGroups.get(key)!;
        const d = new Date(parseInt(key.split("-")[0]), parseInt(key.split("-")[1]) - 1);
        const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });

        return (
          <div key={key} className="space-y-1">
            <h3 className="text-[11px] font-bold uppercase tracking-wide text-md-on-surface-variant px-1 py-1 select-none">
              {label}
            </h3>
            {sectionFiles.map((file) => {
              const isSelected = selectedFileIds.has(file.id);
              const isLiked = favouriteChunks.has(file.manifest.chunks.join(","));
              const size = formatBytes(file.size);
              const date = new Date(file.date * 1000).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              });

              return (
                <div
                  key={file.id}
                  onClick={() => {
                    /* The synthetic click the browser fires after a long-press
                       is consumed: it must not toggle the just-made selection
                       nor open the preview. */
                    if (didLongPressRef.current) {
                      didLongPressRef.current = false;
                      return;
                    }
                    isSelected || anySelected ? onToggleSelect?.(file.id) : onPreview(file);
                  }}
                  onTouchStart={(e) => handleLongPressStart(file, e)}
                  onTouchEnd={handleLongPressEnd}
                  onTouchMove={handleLongPressMove}
                  onTouchCancel={handleLongPressEnd}
                  className={`drive-row flex items-center gap-3 sm:gap-3.5 px-3.5 py-3.5 rounded-xl cursor-pointer select-none border ${
                    isSelected
                      ? "bg-md-primary-container/50 border-md-primary/30"
                      : "border-md-outline-variant/10"
                  }`}
                >
                  {/* Checkbox / select */}
                  {(anySelected || isSelected) && (
                    <span
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-all ${
                        isSelected ? "bg-md-primary border-md-primary" : "border-md-outline"
                      }`}
                    >
                      {isSelected && (
                        <svg className="w-3.5 h-3.5 text-md-on-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  )}

                  <FileThumb file={file} client={client} driveConfig={driveConfig} />

                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-md-on-surface truncate leading-tight">
                      {file.name}
                    </p>
                    <p className="text-[11px] text-md-on-surface-variant mt-0.5 flex items-center gap-1.5">
                      <span>{size}</span>
                      <span className="w-0.5 h-0.5 rounded-full bg-md-outline inline-block" />
                      <span>{date}</span>
                      {isLiked && (
                        <svg className="w-3 h-3 text-md-primary inline-block shrink-0" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
                        </svg>
                      )}
                    </p>
                  </div>

                  {/* More button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActionFile(file);
                    }}
                    className="w-10 h-10 rounded-lg hover:bg-md-surface-container-high text-md-on-surface-variant flex items-center justify-center transition-all cursor-pointer active:scale-90 shrink-0"
                    title="More options"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Infinite scroll: sentinel that triggers loading more rows */}
      {!allVisible && (
        <div ref={loadMoreRef} className="h-1" />
      )}

      {/* Action sheet (row menu) */}
      {actionFile && (
        <ActionSheet
          open={Boolean(actionFile)}
          onClose={() => setActionFile(null)}
          title={actionFile.name}
          subtitle={`${formatBytes(actionFile.size)}`}
          actions={buildActions(actionFile)}
        />
      )}
    </div>
  );
}