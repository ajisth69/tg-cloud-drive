import type { ChunkManifest } from "../types";

export function isChunkOrThumbFileName(fileName?: string): boolean {
  if (!fileName) return false;
  const name = fileName.toLowerCase();
  if (/(^|\.)part\d*$/i.test(name)) return true;
  if (/\.thumb\.(jpg|jpeg|png|webp|gif)$/i.test(name)) return true;
  return false;
}

/**
 * Try to parse a message as a file manifest.
 * Returns null if the message text isn't a valid segmented_file JSON payload.
 */
export function parseManifest(text: string): ChunkManifest | null {
  if (!text) return null;

  const tryParse = (jsonStr: string): ChunkManifest | null => {
    try {
      const data = JSON.parse(jsonStr);
      // Older ClashDrive builds used a couple of spelling variants.  Keep
      // these manifests readable: the chunk list is the only source of the
      // original byte order, so it must never be re-sorted.
      const fileName = data?.fileName ?? data?.file_name ?? data?.filename;
      const rawFileSize = data?.fileSize ?? data?.file_size ?? data?.size;
      const chunks = data?.chunks ?? data?.chunkIds ?? data?.chunk_ids ?? data?.parts;
      const rawChunkSize = data?.chunkSize ?? data?.chunk_size;
      const thumb = data?.thumb ?? data?.thumbnail;
      const fileSize = typeof rawFileSize === "string" && /^\d+$/.test(rawFileSize)
        ? Number(rawFileSize)
        : rawFileSize;
      const chunkSize = typeof rawChunkSize === "string" && /^\d+$/.test(rawChunkSize)
        ? Number(rawChunkSize)
        : rawChunkSize;
      if (
        data &&
        data.type === "segmented_file" &&
        typeof fileName === "string" &&
        fileName.length > 0 &&
        fileName.length <= 255 &&
        !isChunkOrThumbFileName(fileName) &&
        typeof fileSize === "number" &&
        Number.isSafeInteger(fileSize) &&
        fileSize >= 0 &&
        fileSize <= 1024 * 1024 * 1024 * 500 && // 500 GB max
        Array.isArray(chunks) &&
        chunks.length > 0 &&
        chunks.every(
          (id: unknown) =>
            (typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id))) &&
            Number(id) > 0
        )
      ) {
        const orderedChunks = chunks.map((id: unknown) => Number(id));

        const manifest: ChunkManifest = {
          type: "segmented_file",
          fileName,
          fileSize,
          chunks: orderedChunks,
          ...(typeof chunkSize === "number" && chunkSize > 0
            ? { chunkSize }
            : {}),
          ...(typeof thumb === "number" || (typeof thumb === "string" && /^\d+$/.test(thumb))
            ? { thumb: Number(thumb) }
            : {}),
        };
        return manifest;
      }
    } catch {
      return null;
    }
    return null;
  };

  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (direct) return direct;

  // Extract JSON object containing "segmented_file" if embedded in markdown/code blocks/captions
  const match = trimmed.match(/\{[\s\S]*?"type"\s*:\s*"segmented_file"[\s\S]*?\}/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted) return extracted;
  }

  return null;
}

/**
 * Build the JSON string that gets sent as the final manifest message.
 */
export function buildManifest(
  fileName: string,
  fileSize: number,
  chunkMsgIds: number[],
  thumbMsgId?: number,
  chunkSize?: number
): string {
  const manifest: ChunkManifest = {
    type: "segmented_file",
    fileName,
    fileSize,
    chunks: chunkMsgIds,
    ...(chunkSize !== undefined ? { chunkSize } : {}),
    ...(thumbMsgId !== undefined ? { thumb: thumbMsgId } : {}),
  };
  return JSON.stringify(manifest);
}

export function getFileChunkSize(manifest: ChunkManifest): number {
  if (manifest.chunkSize && manifest.chunkSize > 0) {
    return manifest.chunkSize;
  }
  // All legacy files uploaded prior to dynamic chunking used fixed 50 MB (52,428,800 bytes) chunks
  return 50 * 1024 * 1024;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "tiff"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mkv", "avi", "mov", "3gp", "flv", "ts", "m4v", "wmv", "mts", "m2ts", "ogv"]);

/**
 * Whether a file is an image (by mime or extension).
 */
export function isImageFile(file: { name: string; mimeType?: string | null }): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return (file.mimeType || "").startsWith("image/") || IMAGE_EXTENSIONS.has(ext);
}

/**
 * Whether a file is a video (by mime or extension).
 */
export function isVideoFile(file: { name: string; mimeType?: string | null }): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return (file.mimeType || "").startsWith("video/") || VIDEO_EXTENSIONS.has(ext);
}

/**
 * Whether a file belongs to the swipe gallery: images and videos.
 */
export function isGalleryFile(file: { name: string; mimeType?: string | null }): boolean {
  return isImageFile(file) || isVideoFile(file);
}

/**
 * Find the nearest image file in `dir` direction from `currentId`, wrapping
 * around the list. Returns null when there is no other image.
 */
export function findAdjacentImage<T extends { id: number | string; name: string; mimeType?: string | null }>(
  files: T[],
  currentId: number | string,
  dir: 1 | -1
): T | null {
  const idx = files.findIndex((f) => f.id === currentId);
  if (idx === -1 || files.length <= 1) return null;
  for (let step = 1; step < files.length; step++) {
    const candidate = files[(idx + dir * step + files.length) % files.length];
    if (isImageFile(candidate)) return candidate;
    if (candidate.id === currentId) break;
  }
  return null;
}

/**
 * Find the nearest gallery file (image or video) in `dir` direction from
 * `currentId`, wrapping around the list. Returns null when there is no
 * other gallery file.
 */
export function findAdjacentMedia<T extends { id: number | string; name: string; mimeType?: string | null }>(
  files: T[],
  currentId: number | string,
  dir: 1 | -1
): T | null {
  const idx = files.findIndex((f) => f.id === currentId);
  if (idx === -1 || files.length <= 1) return null;
  for (let step = 1; step < files.length; step++) {
    const candidate = files[(idx + dir * step + files.length) % files.length];
    if (isGalleryFile(candidate)) return candidate;
    if (candidate.id === currentId) break;
  }
  return null;
}

const LARGE_IMAGE_THRESHOLD = 5 * 1024 * 1024;

/**
 * Categorize how a file is previewed. Single source of truth for the
 * swipe gallery sequence: everything except "unsupported" is swipeable.
 */
export function getPreviewKind(file: { name: string; mimeType?: string | null; size: number }) {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const mimeType = file.mimeType || "";

  // Streaming media: Videos and Audio
  if (
    mimeType.startsWith("video/") ||
    ["mp4", "webm", "ogg", "mov", "mkv", "avi", "3gp", "flv", "ts", "mts", "m2ts", "wmv"].includes(ext) ||
    mimeType.startsWith("audio/") ||
    ["mp3", "wav", "m4a", "flac", "ogg", "opus", "oga", "caf", "aac", "dsf", "dff", "ape", "alac", "mka"].includes(ext)
  ) {
    return "stream";
  }

  // Images: large images stream for progressive render
  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic", "tiff"].includes(ext)) {
    if (file.size > LARGE_IMAGE_THRESHOLD) return "stream";
    return "image";
  }

  // PDF, EPUB, Docs, and text files download whole file and play/view
  if (mimeType === "application/pdf" || ext === "pdf") return "memory";
  if (ext === "epub") return "memory";
  if (["xlsx", "xls", "csv", "docx", "doc"].includes(ext)) return "office";
  if (["txt", "md", "json", "js", "ts", "py", "rs", "go", "html", "css", "xml"].includes(ext)) return "memory";

  return "unsupported";
}

/**
 * Whether a file can be previewed in the modal (everything ClashDrive
 * supports: images, videos, audio, PDFs, documents, sheets, text, EPUB).
 */
export function isPreviewableFile(file: { name: string; mimeType?: string | null; size: number }): boolean {
  return getPreviewKind(file) !== "unsupported";
}

/**
 * Find the nearest previewable file in `dir` direction from `currentId`,
 * wrapping around the list. Returns null when there is no other
 * previewable file.
 */
export function findAdjacentPreviewable<T extends { id: number | string; name: string; mimeType?: string | null; size: number }>(
  files: T[],
  currentId: number | string,
  dir: 1 | -1
): T | null {
  const idx = files.findIndex((f) => f.id === currentId);
  if (idx === -1 || files.length <= 1) return null;
  // NO wrap: reaching the first/last file returns null (the edge
  // bounces like in Google Photos). Previously the module made the last
  // file's "next" the first → the swipe jumped from the end.
  for (let step = 1; step < files.length; step++) {
    const i = idx + dir * step;
    if (i < 0 || i >= files.length) return null;
    if (isPreviewableFile(files[i])) return files[i];
  }
  return null;
}



/**
 * Format bytes into a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || !isFinite(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Guess a file's icon based on its extension.
 */
export function getFileIcon(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    // Images
    png: "🖼️",
    jpg: "🖼️",
    jpeg: "🖼️",
    gif: "🖼️",
    webp: "🖼️",
    svg: "🖼️",
    // Video
    mp4: "🎬",
    mkv: "🎬",
    avi: "🎬",
    mov: "🎬",
    webm: "🎬",
    // Audio
    mp3: "🎵",
    wav: "🎵",
    flac: "🎵",
    ogg: "🎵",
    aac: "🎵",
    // Documents
    pdf: "📕",
    doc: "📝",
    docx: "📝",
    txt: "📄",
    md: "📄",
    // Archives
    zip: "📦",
    rar: "📦",
    "7z": "📦",
    tar: "📦",
    gz: "📦",
    // Code
    js: "💻",
    ts: "💻",
    py: "💻",
    rs: "💻",
    go: "💻",
    java: "💻",
    // Data
    json: "📊",
    csv: "📊",
    xlsx: "📊",
    // Executables
    exe: "⚙️",
    msi: "⚙️",
    apk: "📱",
    iso: "💿",
  };
  return map[ext] || "📁";
}
