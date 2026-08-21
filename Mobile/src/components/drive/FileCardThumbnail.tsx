import React, { useState, useEffect } from "react";
import type { TelegramClient } from "@mtcute/web";
import type { DriveConfig, DriveFile } from "../../types";
import { downloadChunkToCache, downloadThumbnailById } from "../../lib/downloader";
import { generateAnyThumbnail } from "../../lib/thumbnailGenerators";
import { generateVideoCover } from "../../lib/videoCover";
import { loadThumbFromDB, saveThumbToDB } from "../../lib/db";

function getPlaceholderConfig(fileName: string): { colorText: string; colorBg: string; emblem: React.ReactNode } {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  const c = {
    green:    { text: "#10b981", bg: "#10b9811c" },
    purple:   { text: "#8b5cf6", bg: "#8b5cf61c" },
    cyan:     { text: "#06b6d4", bg: "#06b6d41c" },
    red:      { text: "#ef4444", bg: "#ef44441c" },
    blue:     { text: "#3b82f6", bg: "#3b82f61c" },
    orange:   { text: "#f97316", bg: "#f973161c" },
    amber:    { text: "#f59e0b", bg: "#f59e0b1c" },
    slate:    { text: "#64748b", bg: "#64748b1c" },
    lime:     { text: "#84cc16", bg: "#84cc161c" },
    indigo:   { text: "#6366f1", bg: "#6366f11c" },
    grey:     { text: "#94a3b8", bg: "#94a3b81c" },
    charcoal: { text: "#4b5563", bg: "#4b55631c" },
  };

  if (["png","jpg","jpeg","gif","webp","svg","bmp","avif","heic","tiff"].includes(ext)) {
    return {
      colorText: c.green.text,
      colorBg: c.green.bg,
      emblem: <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />,
    };
  }

  if (["mp4","mkv","avi","mov","webm","flv","3gp","ts","mts","m2ts"].includes(ext)) {
    return {
      colorText: c.purple.text,
      colorBg: c.purple.bg,
      emblem: <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />,
    };
  }

  if (["mp3","wav","m4a","flac","ogg","aac","opus","oga","caf","wma","dsf","dff","ape","alac","mka"].includes(ext)) {
    return {
      colorText: c.cyan.text,
      colorBg: c.cyan.bg,
      emblem: <path d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />,
    };
  }

  if (ext === "pdf") {
    return {
      colorText: c.red.text,
      colorBg: c.red.bg,
      emblem: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    };
  }

  if (["doc","docx","pages"].includes(ext)) {
    return {
      colorText: c.blue.text,
      colorBg: c.blue.bg,
      emblem: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    };
  }

  if (["xls","xlsx","numbers"].includes(ext)) {
    return {
      colorText: c.green.text,
      colorBg: c.green.bg,
      emblem: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    };
  }

  if (["ppt","pptx","key","keynote"].includes(ext)) {
    return {
      colorText: c.orange.text,
      colorBg: c.orange.bg,
      emblem: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    };
  }

  if (["zip","rar","7z","tar","gz","tgz"].includes(ext)) {
    return {
      colorText: c.amber.text,
      colorBg: c.amber.bg,
      emblem: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    };
  }

  if (["js","ts","jsx","tsx","py","rs","go","java","cpp","c","html","css","json","sql","db","xml","yaml","yml"].includes(ext)) {
    return {
      colorText: c.slate.text,
      colorBg: c.slate.bg,
      emblem: <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />,
    };
  }

  if (ext === "apk") {
    return {
      colorText: c.lime.text,
      colorBg: c.lime.bg,
      emblem: <path d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9h14M5 15h14M3 6h18v12H3z" />,
    };
  }

  if (["exe","msi","dmg","pkg","bat","cmd","sh"].includes(ext)) {
    return {
      colorText: c.indigo.text,
      colorBg: c.indigo.bg,
      emblem: <path d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9h14M5 15h14M3 6h18v12H3z" />,
    };
  }

  if (ext === "iso") {
    return {
      colorText: c.grey.text,
      colorBg: c.grey.bg,
      emblem: <circle cx="12" cy="12" r="9" />,
    };
  }

  return {
    colorText: c.charcoal.text,
    colorBg: c.charcoal.bg,
    emblem: <path d="M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />,
  };
}

const MAX_MEMORY_THUMBS = 300;

interface MemoryThumb {
  url: string;
  blob: Blob;
  lastAccess: number;
}

// Two-level cache: RAM (instant) backed by IndexedDB (survives restarts).
// Keys are namespaced (`up:<msgId>` / `gen:<fileId>`) to avoid collisions.
const thumbnailCache = new Map<string, MemoryThumb>();
const loadingPromises = new Map<string, Promise<string | null>>();

function thumbCacheKey(file: DriveFile): string {
  // v2: thumbnails generated before v2 squashed photos into 640x640 squares;
  // the versioned prefix discards those cached blobs (RAM + IndexedDB) so
  // they regenerate with the correct aspect ratio.
  return file.manifest.thumb !== undefined ? `up-v2:${file.manifest.thumb}` : `gen-v2:${file.id}`;
}

function rememberThumb(key: string, blob: Blob, url: string): void {
  thumbnailCache.set(key, { url, blob, lastAccess: Date.now() });
  if (thumbnailCache.size > MAX_MEMORY_THUMBS) {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [k, v] of thumbnailCache) {
      if (v.lastAccess < oldest) {
        oldest = v.lastAccess;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      const evicted = thumbnailCache.get(oldestKey)!;
      thumbnailCache.delete(oldestKey);
      URL.revokeObjectURL(evicted.url);
    }
  }
}

class ConcurrencyQueue {
  private activeCount = 0;
  private queue: (() => void)[] = [];

  constructor(private maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const thumbnailQueue = new ConcurrencyQueue(6); // Increased concurrency for faster thumbnail rendering

async function fetchThumbBlob(
  file: DriveFile,
  client: TelegramClient,
  driveConfig: DriveConfig
): Promise<Blob | null> {
  const thumbMsgId = file.manifest.thumb;

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isVideo = ["mp4", "webm", "mkv", "avi", "mov", "3gp", "flv", "ts"].includes(ext);
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "tiff"].includes(ext);

  // Images: always regenerate the thumb from the first chunk instead of
  // trusting the uploaded thumbnail — older uploads stored a 640x640
  // squashed square (aspect ratio lost), which showed photos flattened
  // until the full image loaded. Regenerating keeps the aspect correct
  // for both new and existing files.
  if (isImage) {
    try {
      const data = await downloadChunkToCache(client, driveConfig, file.id.toString(), file.manifest, 0, Math.min(file.size, 3 * 1024 * 1024));
      if (data) {
        const rawBlob = new Blob([Uint8Array.from(data)]);
        const thumbBlob = await generateAnyThumbnail(rawBlob, file.name);
        if (thumbBlob) return thumbBlob;
      }
    } catch (err) {
      console.warn("Failed to generate image thumbnail on the fly", file.id, err);
    }
  }

  // 1. Uploaded thumbnail stored on Telegram (videos and other files):
  if (thumbMsgId !== undefined) {
    try {
      const data = await downloadThumbnailById(client, driveConfig, thumbMsgId);
      return new Blob([Uint8Array.from(data)], { type: "image/jpeg" });
    } catch (err) {
      console.warn("Failed to download thumbnail", thumbMsgId, err);
      return null;
    }
  }

  console.warn(`[COVER] ${file.name}: no uploaded thumb, ext=${ext}, size=${file.size}`);

  try {
    if (isVideo) {
      // Staged head download (faststart) or moov-at-end stitching — see videoCover.ts
      return await generateVideoCover(file, client, driveConfig);
    }
    const data = await downloadChunkToCache(client, driveConfig, file.id.toString(), file.manifest, 0, Math.min(file.size, 3 * 1024 * 1024));
    if (!data) return null;
    const rawBlob = new Blob([Uint8Array.from(data)]);
    const thumbBlob = await generateAnyThumbnail(rawBlob, file.name);
    if (thumbBlob) return thumbBlob;
    // Fallback only for small files: returning the raw blob means
    // decoding at full resolution on the main thread when painting it
    // (several MB → jank while scrolling). For large files, placeholder.
    if (isImage && file.size <= 2 * 1024 * 1024) return rawBlob;
    return null;
  } catch (err) {
    console.warn("Failed to generate thumbnail on the fly", file.id, err);
    return null;
  }
}

async function loadThumbnail(
  file: DriveFile,
  client: TelegramClient,
  driveConfig: DriveConfig
): Promise<string | null> {
  const cacheKey = thumbCacheKey(file);

  // 1. RAM cache → instant
  const mem = thumbnailCache.get(cacheKey);
  if (mem) {
    mem.lastAccess = Date.now();
    return mem.url;
  }

  // 2. Dedupe concurrent requests for the same file
  if (loadingPromises.has(cacheKey)) {
    return loadingPromises.get(cacheKey)!;
  }

  const promise = (async () => {
    // 3. IndexedDB → near-instant (local async read)
    const persisted = await loadThumbFromDB(cacheKey);
    if (persisted) {
      const url = URL.createObjectURL(persisted);
      rememberThumb(cacheKey, persisted, url);
      return url;
    }

    // 4. Network (Telegram) — bounded concurrency
    return thumbnailQueue.run(async () => {
      const blob = await fetchThumbBlob(file, client, driveConfig);
      if (!blob) return null;
      saveThumbToDB(cacheKey, blob).catch(() => undefined);
      const url = URL.createObjectURL(blob);
      rememberThumb(cacheKey, blob, url);
      return url;
    });
  })().finally(() => {
    loadingPromises.delete(cacheKey);
  });

  loadingPromises.set(cacheKey, promise);
  return promise;
}

/**
 * Public helper: resolve a cover URL for a file (RAM → IndexedDB → Telegram).
 * Used by the preview modal to show the video's first frame as poster while
 * the player loads.
 */
export async function getFileCoverUrl(
  file: DriveFile,
  client?: TelegramClient | null,
  driveConfig?: DriveConfig | null
): Promise<string | null> {
  if (!client || !driveConfig) return null;
  return loadThumbnail(file, client, driveConfig);
}

/** Synchronous lookup of the in-memory thumbnail cache. Lets the preview mount
 *  photos with their 640px thumbnail already available if the list loaded it,
 *  without waiting for the network. */
export function getCachedThumbUrl(file: DriveFile): string | null {
  return thumbnailCache.get(thumbCacheKey(file))?.url ?? null;
}

interface FileCardThumbnailProps {
  file: DriveFile;
  client?: TelegramClient | null;
  driveConfig?: DriveConfig | null;
  className?: string;
}

export function FileCardThumbnail({
  file,
  client,
  driveConfig,
  className = "w-full h-full",
}: FileCardThumbnailProps) {
  const { id: fileId, name: fileName } = file;
  const cfg = getPlaceholderConfig(fileName);

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const EXCLUDED_THUMB_EXTS = ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "apk", "apks", "xapk", "exe", "msi", "dmg", "pkg", "iso", "bin"];
  const isExcluded = EXCLUDED_THUMB_EXTS.includes(ext);
  const isVideo = ["mp4", "webm", "mkv", "avi", "mov", "3gp", "flv", "ts"].includes(ext);
  const isImage = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "tiff"].includes(ext);
  const isAudio = ["mp3", "wav", "m4a", "flac", "ogg", "aac", "opus", "oga", "caf", "wma", "dsf", "dff", "ape", "alac", "mka"].includes(ext);

  const hasUploadedThumb = file.manifest.thumb !== undefined;
  // Videos: always (only the 8 MB header prefix is fetched).
  // Images: up to 25 MB so large photos also get covers (one-time, persisted).
  // Audio: up to 50 MB to extract embedded album artwork.
  // Other files: only tiny ones.
  const sizeCap = isVideo
    ? Number.MAX_SAFE_INTEGER
    : isImage
      ? 25 * 1024 * 1024
      : isAudio
        ? 50 * 1024 * 1024
        : 3 * 1024 * 1024;
  const canLoadThumb = hasUploadedThumb || (!isExcluded && file.size <= sizeCap);

  const cacheKey = hasUploadedThumb ? `up:${file.manifest.thumb!}` : `gen:${fileId}`;

  const [thumbUrl, setThumbUrl] = useState<string | null>(() => thumbnailCache.get(cacheKey)?.url ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!client || !driveConfig || !canLoadThumb) {
      return;
    }

    let active = true;

    /* Pre-decode OUTSIDE the paint frame: if the <img> mounts with the just-
       resolved URL, the browser decodes synchronously DURING paint (scrolling
       while thumbs load = jank). Decoding beforehand in a separate task makes
       the paint reuse the already-decoded image. */
    const applyThumb = (url: string | null) => {
      if (!url || !active) {
        if (!url) setLoading(false);
        return;
      }
      const probe = new Image();
      probe.src = url;
      const commit = () => {
        if (active) {
          setThumbUrl(url);
          setLoading(false);
        }
      };
      probe.decode().then(commit).catch(commit);
    };

    const mem = thumbnailCache.get(cacheKey);
    if (mem) {
      mem.lastAccess = Date.now();
      applyThumb(mem.url);
      return;
    }

    if (loadingPromises.has(cacheKey)) {
      loadingPromises.get(cacheKey)!.then((url) => {
        applyThumb(url);
      });
      return;
    }

    setLoading(true);

    loadThumbnail(file, client, driveConfig)
      .then((url) => {
        applyThumb(url);
      })
      .catch(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [file, client, driveConfig, fileId, cacheKey, canLoadThumb, hasUploadedThumb]);

  if (loading) {
    return (
      <div className="relative w-full h-full flex items-center justify-center overflow-hidden bg-transparent">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center animate-pulse"
          style={{ backgroundColor: cfg.colorBg }}
        >
          <div
            className="w-4 h-4 border-2 border-transparent rounded-full animate-spin"
            style={{ borderTopColor: cfg.colorText, borderLeftColor: cfg.colorText }}
          />
        </div>
      </div>
    );
  }

  if (thumbUrl) {
    return (
      <img
        src={thumbUrl}
        alt={fileName}
        className={className}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="50" cy="50" r="42" fill={cfg.colorBg} />
      <g transform="translate(26, 26) scale(2.0)" stroke={cfg.colorText} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {cfg.emblem}
      </g>
    </svg>
  );
}