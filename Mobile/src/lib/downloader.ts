import { TelegramClient } from "@mtcute/web";
import { Long } from "@mtcute/core";
import type { ChunkManifest, DriveFile, DriveConfig } from "../types";
import { buildManifest, parseManifest, getFileChunkSize, isChunkOrThumbFileName } from "./manifest";
import { getHelperClient } from "./client";
import {
  getCachedChunk,
  setCachedChunk,
  getCachedRange,
  getCachedBytes,
  appendCachedData,
  getFullCachedChunk,
  setFullCachedChunk,
  persistChunkToStorage,
  persistCompleteChunk,
  hydrateChunkFromStorage,
} from "./cache";
import { saveBlobToDevice } from "./native";

const g = (typeof window !== "undefined" ? window : {}) as any;
const MAX_MESSAGE_CACHE_SIZE = 200;
const messageCache: Map<number, any> = g.__messageCache || (g.__messageCache = new Map<number, any>());

function setCachedMessage(msgId: number, message: any): void {
  if (messageCache.has(msgId)) {
    messageCache.delete(msgId);
  } else if (messageCache.size >= MAX_MESSAGE_CACHE_SIZE) {
    const oldestKey = messageCache.keys().next().value;
    if (oldestKey !== undefined) {
      messageCache.delete(oldestKey);
    }
  }
  messageCache.set(msgId, message);
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

function getFloodWaitSeconds(err: unknown) {
  if (typeof err !== "object" || !err) return null;
  const candidate = err as { errorMessage?: unknown; message?: unknown };
  const text = typeof candidate.errorMessage === "string"
    ? candidate.errorMessage
    : typeof candidate.message === "string"
      ? candidate.message
      : "";
  const match = text.match(/FLOOD_WAIT_(\d+)/);
  return match ? parseInt(match[1], 10) || 30 : null;
}

/** Normalise raw Telegram seconds and mtcute's Date wrapper to Unix seconds. */
function getMessageDateSeconds(message: any): number {
  const rawDate = message?.raw?.date ?? message?.date;
  if (rawDate instanceof Date) return Math.floor(rawDate.getTime() / 1000);
  if (typeof rawDate === "number") {
    // Defensive support for already-normalised millisecond values.
    return rawDate > 100_000_000_000 ? Math.floor(rawDate / 1000) : rawDate;
  }
  return Math.floor(Date.now() / 1000);
}

function isMessageInTopic(message: any, topicId: number): boolean {
  const raw = message?.raw ?? message;
  const replyTo = raw?.replyTo;
  const threadId = replyTo?.replyToTopId
    ?? message?.replyToMessage?.threadId
    ?? replyTo?.replyToMsgId
    ?? message?.replyToMessage?.id;

  // The General topic is represented by topic id 1. Forum messages always
  // carry a top-message id, but treating messages with no topic header as
  // General also preserves files uploaded before forums were enabled.
  if (topicId === 1 || topicId <= 0) {
    return threadId === 1 || threadId == null;
  }

  return threadId === topicId;
}

async function getReplyMessages(
  client: TelegramClient,
  peer: any,
  topicId: number,
  minId = 0
): Promise<any[]> {
  const messagesById = new Map<number, any>();
  let offsetId = 0;
  const limit = 100;

  for (;;) {
    let result: any;
    let attempts = 0;
    while (attempts < 3) {
      try {
        result = await client.call({
          _: "messages.getReplies",
          peer,
          msgId: topicId,
          offsetId,
          offsetDate: 0,
          addOffset: 0,
          limit,
          maxId: 0,
          minId,
          hash: Long.ZERO,
        });
        break;
      } catch (error) {
        const wait = getFloodWaitSeconds(error);
        if (wait === null || ++attempts >= 3) throw error;
        console.warn(`[listFilesInTopic] Flood wait for topic ${topicId}; retrying in ${wait}s.`);
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      }
    }

    const page = result?.messages ?? [];
    if (page.length === 0) break;

    let added = 0;
    let oldestId = Number.POSITIVE_INFINITY;
    for (const message of page) {
      if (!message?.id) continue;
      if (!messagesById.has(message.id)) {
        messagesById.set(message.id, message);
        added++;
      }
      oldestId = Math.min(oldestId, message.id);
    }

    // Telegram returns newest first. The last/lowest id is the inclusive
    // cursor for the next page. Break cleanly when pagination reaches the end.
    if (
      !Number.isFinite(oldestId) ||
      (offsetId !== 0 && (added === 0 || oldestId >= offsetId))
    ) {
      break;
    }
    offsetId = oldestId;

    // Pace MTProto requests to avoid triggering Telegram FLOOD_WAIT
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return [...messagesById.values()];
}

async function getTopicMessagesFromHistory(
  client: TelegramClient,
  peer: any,
  topicId: number,
  minId = 0
): Promise<any[]> {
  const messagesById = new Map<number, any>();
  let offsetId = 0;
  const limit = 100;

  for (;;) {
    let result: any;
    let attempts = 0;
    while (attempts < 3) {
      try {
        result = await client.call({
          _: "messages.getHistory",
          peer,
          offsetId,
          offsetDate: 0,
          addOffset: 0,
          limit,
          maxId: 0,
          minId,
          hash: Long.ZERO,
        });
        break;
      } catch (error) {
        const wait = getFloodWaitSeconds(error);
        if (wait === null || ++attempts >= 3) throw error;
        console.warn(`[listFilesInTopic] Flood wait while scanning topic ${topicId}; retrying in ${wait}s.`);
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      }
    }
    const page = result?.messages ?? [];
    if (page.length === 0) break;

    let oldestId = Number.POSITIVE_INFINITY;
    let added = 0;
    for (const message of page) {
      if (!message?.id) continue;
      oldestId = Math.min(oldestId, message.id);
      if (isMessageInTopic(message, topicId) && !messagesById.has(message.id)) {
        messagesById.set(message.id, message);
      }
      added++;
    }

    if (
      !Number.isFinite(oldestId) ||
      (offsetId !== 0 && (added === 0 || oldestId >= offsetId))
    ) {
      break;
    }
    offsetId = oldestId;

    // Pace MTProto requests to avoid triggering Telegram FLOOD_WAIT
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return [...messagesById.values()];
}

function getMessageDocumentInfo(message: any): {
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
} {
  if (!message) return {};

  if (message.media) {
    const m = message.media;
    if (m.type === "document" || m.type === "video" || m.type === "audio" || m.type === "sticker") {
      return {
        mimeType: m.mimeType || "application/octet-stream",
        fileName: m.fileName || `${m.type || "file"}_${message.id}`,
        fileSize: m.fileSize || m.size || 0,
      };
    }
    if (m.type === "photo") {
      return {
        mimeType: "image/jpeg",
        fileName: `Photo_${message.id}.jpg`,
        fileSize: m.fileSize || m.size || 0,
      };
    }
  }

  const media = message.media || message.raw?.media;
  if (!media) return {};

  if ((media._ === "messageMediaDocument" || media._ === "messageMediaDocumentEmpty") && media.document) {
    const doc = media.document;
    if (doc && (doc._ === "document" || doc.id)) {
      const fileNameAttr = doc.attributes?.find(
        (attr: any) => attr._ === "documentAttributeFilename" || attr.fileName
      );
      const mimeType = doc.mimeType || "application/octet-stream";
      let fallbackExt = "";
      if (mimeType.startsWith("image/")) fallbackExt = ".jpg";
      else if (mimeType.startsWith("video/")) fallbackExt = ".mp4";
      else if (mimeType.startsWith("audio/")) fallbackExt = ".mp3";
      else if (mimeType === "application/pdf") fallbackExt = ".pdf";
      else if (mimeType === "application/zip") fallbackExt = ".zip";

      const finalName = fileNameAttr?.fileName || (doc.fileName ? doc.fileName : `File_${message.id}${fallbackExt}`);
      return {
        mimeType,
        fileName: finalName,
        fileSize: doc.size || 0,
      };
    }
  }

  if ((media._ === "messageMediaPhoto" || media.photo) && media.photo) {
    const photo = media.photo;
    const sizes = photo.sizes || photo.size || [];
    let largestSize = 0;
    if (Array.isArray(sizes)) {
      for (const s of sizes) {
        if (s && typeof s.size === "number" && s.size > largestSize) {
          largestSize = s.size;
        }
      }
    }
    return {
      mimeType: "image/jpeg",
      fileName: `Photo_${message.id}.jpg`,
      fileSize: largestSize || 0,
    };
  }

  return {};
}

async function downloadMediaWithWorkers(
  client: TelegramClient,
  message: any,
  options: {
    workers?: number;
    partSizeKb?: number;
    progressCallback?: (dl: number, total: number) => void;
  } = {}
): Promise<Uint8Array> {
  const targetLocation = message?.media ?? message;
  const buffer = await client.downloadAsBuffer(targetLocation, {
    // Telegram's maximum file part is 512 KB.  Requesting 1024 KB can be
    // rejected or silently reduced by the DC, depending on the client build.
    partSize: options.partSizeKb || 512,
    progressCallback: (dl, total) => {
      options.progressCallback?.(dl, total);
    },
  });
  return buffer;
}

export function mimeTypeFromName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext || "")) {
    if (ext === "jpg") return "image/jpeg";
    if (ext === "svg") return "image/svg+xml";
    return `image/${ext}`;
  }
  const videoTypes: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    ogg: "video/ogg",
    mov: "video/quicktime",
    mkv: "video/webm",
    avi: "video/x-msvideo",
    "3gp": "video/3gpp",
    flv: "video/x-flv",
    ts: "video/mp2t",
    mts: "video/mp2t",
    m2ts: "video/mp2t",
    wmv: "video/x-ms-wmv",
  };
  if (ext && videoTypes[ext]) return videoTypes[ext];
  if (["mp3", "wav", "m4a", "flac", "ogg"].includes(ext || "")) {
    return `audio/${ext === "mp3" ? "mpeg" : ext}`;
  }
  const map: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    json: "application/json; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    ts: "text/typescript; charset=utf-8",
    py: "text/x-python; charset=utf-8",
    rs: "text/plain; charset=utf-8",
    go: "text/plain; charset=utf-8",
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
  };
  if (ext && map[ext]) return map[ext];
  return "application/octet-stream";
}

function hasExtension(fileName: string): boolean {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  return /\.[^.\s]{1,12}$/.test(last);
}

function extensionFromName(fileName?: string): string {
  if (!fileName) return "";
  const withoutChunkSuffix = fileName.replace(/\.part\d+$/i, "");
  if (!hasExtension(withoutChunkSuffix)) return "";
  return withoutChunkSuffix.slice(withoutChunkSuffix.lastIndexOf("."));
}

export function normalizeRenamedFileName(file: DriveFile, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";

  if (hasExtension(trimmed)) {
    return trimmed;
  }

  const originalExt =
    extensionFromName(file.name) ||
    extensionFromName(file.manifest.fileName) ||
    extensionFromName(file.chunkFileName);

  return originalExt ? `${trimmed}${originalExt}` : trimmed;
}

export function getPeerInput(config: DriveConfig) {
  const markedIdNumber = Number(config.chatId);
  if (config.accessHash && config.accessHash !== "0") {
    const bareId = Number(config.chatId.replace(/^-100/, "").replace(/^-/, ""));
    return {
      _: "inputPeerChannel" as const,
      channelId: bareId,
      accessHash: Long.fromString(config.accessHash),
    };
  }
  return markedIdNumber;
}

export async function preFetchMessages(
  client: TelegramClient,
  config: DriveConfig,
  manifest: ChunkManifest
): Promise<void> {
  // Fetch just the near-playback window. Fetching every message reference of
  // a large file at open time can queue several requests ahead of its first
  // media range and delay startup.
  const missingIds = manifest.chunks
    .filter((id) => !messageCache.has(id))
    .slice(0, 12);
  if (missingIds.length > 0) {
    try {
      const peerInput = getPeerInput(config);
      const batchSize = 100;
      for (let i = 0; i < missingIds.length; i += batchSize) {
        const messages = await client.getMessages(peerInput, missingIds.slice(i, i + batchSize));
        for (const msg of messages) {
          if (msg && msg.id) {
            setCachedMessage(msg.id, msg);
          }
        }
      }
    } catch (err) {
      console.warn("Pre-fetch failed:", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Background prefetch state
// ---------------------------------------------------------------------------
const activePrefetchAbort = new Map<string, AbortController>();
const activePrefetchJobs = new Set<string>();

/**
 * Cancel any active background prefetch for a file (e.g. on seek or close).
 */
export function cancelPrefetch(fileId: string): void {
  const ctrl = activePrefetchAbort.get(fileId);
  if (ctrl) {
    ctrl.abort();
    activePrefetchAbort.delete(fileId);
  }
}

/**
 * Prefetch small segments ahead of the playback cursor using downloadAsIterable.
 * Each piece is cached incrementally via appendCachedData.
 */
async function triggerBackgroundPrefetch(
  client: TelegramClient,
  config: DriveConfig,
  fileId: string,
  manifest: ChunkManifest,
  chunkIndex: number,
  startOffset: number
) {
  const jobKey = `${fileId}-${chunkIndex}-${startOffset}`;
  if (activePrefetchJobs.has(jobKey)) return;
  activePrefetchJobs.add(jobKey);

  // Cancel any prior prefetch for this file before starting a new one
  cancelPrefetch(fileId);
  const abortCtrl = new AbortController();
  activePrefetchAbort.set(fileId, abortCtrl);

  try {
    const chatIdNumber = Number(config.chatId);
    const fileChunkSize = getFileChunkSize(manifest);
    const msgId = manifest.chunks[chunkIndex];
    if (!msgId) return;

    let message = messageCache.get(msgId);
    if (!message) {
      const messages = await client.getMessages(getPeerInput(config), [msgId]);
      if (!messages.length || !messages[0]) return;
      message = messages[0];
      setCachedMessage(msgId, message);
    }

    // Four megabytes is below a few seconds for high-bitrate 4K video. Keep
    // a useful playback cushion without loading the whole Telegram document.
    const PREFETCH_BYTES = 16 * 1024 * 1024;
    const cachedSoFar = getCachedBytes(fileId, chunkIndex);
    const fetchFrom = Math.max(startOffset, cachedSoFar);
    const fetchLimit = Math.min(PREFETCH_BYTES, fileChunkSize - fetchFrom);
    if (fetchLimit <= 0) {
      // This chunk is fully cached, try next chunk
      const nextIdx = chunkIndex + 1;
      if (nextIdx < manifest.chunks.length) {
        activePrefetchJobs.delete(jobKey);
        triggerBackgroundPrefetch(client, config, fileId, manifest, nextIdx, 0);
      }
      return;
    }
    // Keep prefetch off the connection currently feeding the media element.
    const activeClient = await getHelperClient(1 + (chunkIndex % 5));
    const targetLocation = message?.media ?? message;
    const PART_ALIGN = 512 * 1024;
    const alignedOffset = Math.floor(fetchFrom / PART_ALIGN) * PART_ALIGN;

    const iter = activeClient.downloadAsIterable(targetLocation, {
      offset: alignedOffset,
      partSize: 512,
      abortSignal: abortCtrl.signal,
    });

    let writeOffset = alignedOffset;
    for await (const rawPiece of iter) {
      if (abortCtrl.signal.aborted) break;
      const piece = rawPiece instanceof Uint8Array ? rawPiece : new Uint8Array(rawPiece);
      appendCachedData(fileId, chunkIndex, writeOffset, piece, fileChunkSize);
      writeOffset += piece.length;
      if (writeOffset >= fetchFrom + fetchLimit) {
        // mtcute continues scheduling iterable workers after a consumer
        // breaks. Abort explicitly so prefetch never consumes an entire
        // 50–500 MB Telegram document.
        abortCtrl.abort();
        break;
      }
    }
    if (getCachedBytes(fileId, chunkIndex) >= fileChunkSize) {
      persistCompleteChunk(fileId, chunkIndex).catch(() => undefined);
    }
  } catch (err) {
    if ((err as any)?.name !== "AbortError") {
      console.warn(`[PREFETCH] Chunk ${chunkIndex} prefetch failed:`, err);
    }
  } finally {
    activePrefetchJobs.delete(jobKey);
    if (activePrefetchAbort.get(fileId) === abortCtrl) {
      activePrefetchAbort.delete(fileId);
    }
  }
}

/**
 * Download a full chunk to cache. Used by non-streaming callers
 * (FileCardThumbnail, DSF header parsing, etc.). NOT used by the
 * streaming path — the stream handler uses sub-chunk downloadAsIterable directly.
 */
export async function downloadChunkToCache(
  client: TelegramClient,
  config: DriveConfig,
  fileId: string,
  manifest: ChunkManifest,
  chunkIndex: number,
  limitBytes?: number
): Promise<Uint8Array> {
  // 1. Check range cache for a complete chunk
  const existing = getFullCachedChunk(fileId, chunkIndex);
  if (existing) return existing;

  // 1b. Check persistent (IndexedDB) cache before hitting the network
  if (await hydrateChunkFromStorage(fileId, chunkIndex)) {
    const hydrated = getFullCachedChunk(fileId, chunkIndex);
    if (hydrated) return hydrated;
  }

  const msgId = manifest.chunks[chunkIndex];
  const chatIdNumber = Number(config.chatId);

  let message = messageCache.get(msgId);
  if (!message) {
    const messages = await client.getMessages(getPeerInput(config), [msgId]);
    if (!messages.length || !messages[0]) {
      throw new Error(`Message not found for chunk ${chunkIndex}`);
    }
    message = messages[0];
    messageCache.set(msgId, message);
  }

  let attempts = 0;
  while (attempts < 5) {
    try {
      const activeClient = await getHelperClient(chunkIndex % 6);
      const buffer = await downloadMediaWithWorkers(activeClient, message, { workers: 8 });

      if (buffer && buffer.byteLength > 0) {
        const arr = new Uint8Array(buffer);
        setFullCachedChunk(fileId, chunkIndex, arr);
        persistChunkToStorage(fileId, chunkIndex, arr).catch(() => undefined);
        return arr;
      }
    } catch (e) {
      const wait = getFloodWaitSeconds(e);
      if (wait !== null) {
        console.warn(`FloodWait: sleeping ${wait}s then retrying chunk ${chunkIndex}`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        attempts++;
        continue;
      }
      console.warn(`Chunk ${chunkIndex} download failed, retrying...`, e);
    }
    attempts++;
    await new Promise((r) => setTimeout(r, 1000 * attempts));
  }
  throw new Error(`Failed to download chunk ${chunkIndex}`);
}

/**
 * Download only the first `limitBytes` of a file (chunk 0 prefix) without
 * downloading the whole (up to 500 MB) chunk. Used to grab the container
 * header of a video so FileCardThumbnail can render a first-frame cover.
 * Served from the range cache on repeat calls; partial prefixes are never
 * persisted to IndexedDB.
 */
export async function downloadFilePrefix(
  client: TelegramClient,
  config: DriveConfig,
  fileId: string,
  manifest: ChunkManifest,
  limitBytes: number
): Promise<Uint8Array | null> {
  const chunkIndex = 0;
  const fileChunkSize = getFileChunkSize(manifest);
  const msgId = manifest.chunks[chunkIndex];
  if (!msgId) return null;

  const fromCache = () => {
    const full = getFullCachedChunk(fileId, chunkIndex);
    if (full) return full.subarray(0, Math.min(limitBytes, full.length));
    const partial = getCachedRange(fileId, chunkIndex, 0, limitBytes);
    if (partial && partial.length > 0) return partial;
    return null;
  };

  const cached = fromCache();
  if (cached) return cached;

  if (await hydrateChunkFromStorage(fileId, chunkIndex)) {
    const hydrated = fromCache();
    if (hydrated) return hydrated;
  }

  let message = messageCache.get(msgId);
  if (!message) {
    const messages = await client.getMessages(getPeerInput(config), [msgId]);
    if (!messages.length || !messages[0]) {
      throw new Error(`Message not found for chunk 0`);
    }
    message = messages[0];
    messageCache.set(msgId, message);
  }
  const targetLocation = message?.media ?? message;

  /* Small files (≤8MB): download the ENTIRE file through the same
     path used by images (downloadAsBuffer). The range path
     (downloadAsIterable with offset/limit) fails silently for files
     smaller than the requested range: mtcute requests chunks beyond the
     EOF and aborts the iterable with no data or error → empty cover (camera icon). */
  const fileSize = typeof targetLocation?.fileSize === "number" ? targetLocation.fileSize : undefined;
  if (fileSize !== undefined && fileSize <= 8 * 1024 * 1024) {
    const buffer = await downloadMediaWithWorkers(client, message, { workers: 4 });
    if (buffer && buffer.byteLength > 0) {
      const arr = new Uint8Array(buffer);
      setFullCachedChunk(fileId, chunkIndex, arr);
      const out = arr.subarray(0, Math.min(limitBytes, arr.length));
      if (out.length > 0) return out;
    }
  }

  let attempts = 0;
  while (attempts < 5) {
    try {
      const activeClient = await getHelperClient(chunkIndex % 6);
      // mtcute's `limit` stops the iterable exactly at limitBytes (no manual
      // abort needed, and it downloads the aligned parts in one pass).
      // Clamped to fileSize so it never requests chunks beyond the EOF.
      const safeLimit = fileSize !== undefined ? Math.min(limitBytes, fileSize) : limitBytes;
      const iter = activeClient.downloadAsIterable(targetLocation, {
        offset: 0,
        limit: safeLimit,
        partSize: 512,
      });

      let received = 0;
      for await (const rawPiece of iter) {
        const piece = rawPiece instanceof Uint8Array ? rawPiece : new Uint8Array(rawPiece);
        appendCachedData(fileId, chunkIndex, received, piece, fileChunkSize);
        received += piece.length;
      }

      const result = fromCache();
      if (result && result.length > 0) return result;
      return null;
    } catch (e) {
      const wait = getFloodWaitSeconds(e);
      if (wait !== null) {
        console.warn(`FloodWait: sleeping ${wait}s then retrying prefix`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        attempts++;
        continue;
      }
      console.warn(`Chunk prefix download failed, retrying...`, e);
    }
    attempts++;
    await new Promise((r) => setTimeout(r, 1000 * attempts));
  }
  throw new Error(`Failed to download chunk prefix`);
}

/**
 * Download an arbitrary byte range [startByte, startByte + lengthBytes) of a
 * file, spanning chunk boundaries. Telegram requires offsets aligned to
 * 512 KB, so the request is aligned down and the extra bytes sliced off.
 * Result is NOT written to the range cache (tail reads are one-shot; the
 * generated cover is persisted in the thumbnail cache instead).
 */
export async function downloadFileRange(
  client: TelegramClient,
  config: DriveConfig,
  fileId: string,
  manifest: ChunkManifest,
  startByte: number,
  lengthBytes: number
): Promise<Uint8Array | null> {
  if (startByte < 0 || lengthBytes <= 0) return null;
  const chunkSize = getFileChunkSize(manifest);
  const chunkIndex = Math.floor(startByte / chunkSize);
  if (chunkIndex >= manifest.chunks.length) return null;
  const msgId = manifest.chunks[chunkIndex];
  if (!msgId) return null;

  const offsetInChunk = startByte - chunkIndex * chunkSize;
  const PART_ALIGN = 512 * 1024;
  const alignedOffset = Math.floor(offsetInChunk / PART_ALIGN) * PART_ALIGN;
  const prefixSkip = offsetInChunk - alignedOffset;
  const fetchLen = prefixSkip + lengthBytes;
  const available = Math.min(alignedOffset + fetchLen, chunkSize) - alignedOffset;
  if (available <= 0) return null;

  let message = messageCache.get(msgId);
  if (!message) {
    const messages = await client.getMessages(getPeerInput(config), [msgId]);
    if (!messages.length || !messages[0]) {
      throw new Error(`Message not found for chunk ${chunkIndex}`);
    }
    message = messages[0];
    messageCache.set(msgId, message);
  }
  const targetLocation = message?.media ?? message;

  const fileSize = typeof targetLocation?.fileSize === "number" ? targetLocation.fileSize : undefined;
  // Never request beyond the EOF (the file's last chunk can be smaller
  // than 512 KB: Telegram returns an error and mtcute silently aborts the iterable).
  const safeAvail = fileSize !== undefined
    ? Math.min(available, Math.max(0, fileSize - alignedOffset))
    : available;
  if (safeAvail <= 0) return null;

  const out = new Uint8Array(safeAvail);
  let written = 0;
  let attempts = 0;
  while (attempts < 5 && written < safeAvail) {
    try {
      const activeClient = await getHelperClient(chunkIndex % 6);
      const iter = activeClient.downloadAsIterable(targetLocation, {
        offset: alignedOffset,
        limit: safeAvail,
        partSize: 512,
      });

      for await (const rawPiece of iter) {
        const piece = rawPiece instanceof Uint8Array ? rawPiece : new Uint8Array(rawPiece);
        const copyLen = Math.min(piece.length, safeAvail - written);
        out.set(piece.subarray(0, copyLen), written);
        written += copyLen;
        if (written >= safeAvail) break;
      }
    } catch (e) {
      const wait = getFloodWaitSeconds(e);
      if (wait !== null) {
        console.warn(`FloodWait: sleeping ${wait}s then retrying range`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        attempts++;
        continue;
      }
      console.warn(`Chunk range download failed, retrying...`, e);
    }
    attempts++;
    if (written < safeAvail) await new Promise((r) => setTimeout(r, 1000 * attempts));
  }

  if (written < safeAvail) return null;
  return prefixSkip > 0 ? out.subarray(prefixSkip) : out;
}

export async function downloadThumbnailById(
  client: TelegramClient,
  config: DriveConfig,
  msgId: number
): Promise<Uint8Array> {
  const chatIdNumber = Number(config.chatId);

  let message = messageCache.get(msgId);
  if (!message) {
    const messages = await client.getMessages(getPeerInput(config), [msgId]);
    if (!messages.length || !messages[0]) {
      throw new Error(`Message not found for thumbnail ${msgId}`);
    }
    message = messages[0];
    setCachedMessage(msgId, message);
  }
  const buffer = await downloadMediaWithWorkers(client, message, { workers: 4 });
  return new Uint8Array(buffer);
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

export async function handleStreamRequest(
  client: TelegramClient,
  config: DriveConfig,
  event: MessageEvent,
  files: DriveFile[]
) {
  if (event.data.type !== "FETCH_STREAM") return;
  const { fileId, range } = event.data;
  const port = event.ports[0];

  if (!port) return;

  const file = files.find((f) => f.id.toString() === fileId);
  if (!file) {
    port.postMessage({ type: "ERROR", error: "File not found" });
    return;
  }

  if (file.size <= 0) {
    port.postMessage({
      type: "HEADER",
      status: 200,
      start: 0,
      end: -1,
      totalSize: 0,
      contentLength: 0,
      mimeType: file.mimeType || mimeTypeFromName(file.name),
    });
    port.postMessage({ type: "END" });
    return;
  }

  const chatIdNumber = Number(config.chatId);

  const isDsfFile = file.name.toLowerCase().endsWith(".dsf");
  let dsdHeader = { dataOffset: 0, dataSize: 0, channels: 2, sampleRate: 2822400, blockSize: 4096 };

  if (isDsfFile) {
    try {
      const headerData = await downloadChunkToCache(client, config, file.id.toString(), file.manifest, 0);
      if (headerData && headerData.length >= 80) {
        const view = new DataView(headerData.buffer, headerData.byteOffset, headerData.byteLength);
        if (view.getUint32(0, true) === 0x20445344) {
          let offset = 28;
          while (offset < headerData.length - 12) {
            const chunkHeader = view.getUint32(offset, true);
            const chunkSize = Number(view.getBigUint64(offset + 4, true));
            if (chunkHeader === 0x20746d66) {
              dsdHeader.channels = view.getUint32(offset + 24, true);
              dsdHeader.sampleRate = view.getUint32(offset + 28, true);
              if (chunkSize >= 48) {
                dsdHeader.blockSize = view.getUint32(offset + 44, true);
              }
            } else if (chunkHeader === 0x61746164) {
              dsdHeader.dataOffset = offset + 12;
              dsdHeader.dataSize = chunkSize - 12;
              break;
            }
            offset += chunkSize;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to parse DSD header:", e);
    }
  }

  if (isDsfFile && (dsdHeader.dataSize === 0 || dsdHeader.channels <= 0 || dsdHeader.sampleRate <= 0)) {
    dsdHeader.dataOffset = 80;
    dsdHeader.dataSize = file.size - 80;
    dsdHeader.channels = 2;
    dsdHeader.sampleRate = 2822400;
  }

  const wavDataSize = Math.floor(dsdHeader.dataSize / 4);
  const wavTotalSize = 44 + wavDataSize;

  const wavSampleRate = dsdHeader.sampleRate / 64;
  const lpFilterLeft = isDsfFile ? new BiquadFilter(16000, wavSampleRate) : null;
  const lpFilterRight = isDsfFile ? new BiquadFilter(16000, wavSampleRate) : null;

  const hasRange = typeof range === "string" && range.startsWith("bytes=");
  let start = 0;
  let requestedEnd = (isDsfFile ? wavTotalSize : file.size) - 1;

  if (hasRange) {
    const firstRange = range.replace(/bytes=/, "").split(",")[0].trim();
    const [startPart, endPart] = firstRange.split("-");

    if (!startPart && endPart) {
      const suffixLength = parseInt(endPart, 10);
      if (!Number.isNaN(suffixLength)) {
        start = Math.max((isDsfFile ? wavTotalSize : file.size) - suffixLength, 0);
      }
    } else {
      const parsedStart = parseInt(startPart || "0", 10);
      if (!Number.isNaN(parsedStart)) {
        start = parsedStart;
      }
      if (endPart) {
        const parsedEnd = parseInt(endPart, 10);
        if (!Number.isNaN(parsedEnd)) {
          requestedEnd = parsedEnd;
        }
      }
    }
  }

  start = Math.max(0, Math.min(start, (isDsfFile ? wavTotalSize : file.size) - 1));
  requestedEnd = Math.max(start, Math.min(requestedEnd, (isDsfFile ? wavTotalSize : file.size) - 1));

  const end = requestedEnd;
  const contentLength = end - start + 1;

  const alignedStart = isDsfFile
    ? (start < 44 ? 0 : Math.floor((start - 44) / 2048) * 2048 + 44)
    : start;
  const alignedEnd = isDsfFile
    ? (end < 44 ? 43 : Math.ceil((end + 1 - 44) / 2048) * 2048 + 44 - 1)
    : end;

  let mimeType = file.mimeType || mimeTypeFromName(file.name);
  if (mimeType === "application/octet-stream") {
    mimeType = mimeTypeFromName(file.name);
  }

  let aborted = false;
  const streamAbortController = new AbortController();
  port.onmessage = (e) => {
    if (e.data?.type === "ABORT") {
      aborted = true;
      streamAbortController.abort();
    }
  };

  const sendBytes = (bytes: Uint8Array) => {
    if (aborted || bytes.length === 0) return;
    // Always send a private copy. Transferring a buffer that is a view into
    // the shared chunk cache would detach it, corrupting the cache.
    const bufferToSend = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    port.postMessage({ type: "CHUNK", chunk: bufferToSend }, [bufferToSend]);
  };

  let bytesDiscarded = 0;
  let bytesSentToPort = 0;
  const discardPrefix = start - alignedStart;
  const targetBytes = contentLength;

  const sendBytesSliced = (bytes: Uint8Array) => {
    if (aborted || bytesSentToPort >= targetBytes) return;

    let data = bytes;
    if (bytesDiscarded < discardPrefix) {
      const remainingToDiscard = discardPrefix - bytesDiscarded;
      if (data.length <= remainingToDiscard) {
        bytesDiscarded += data.length;
        return;
      }
      data = data.subarray(remainingToDiscard);
      bytesDiscarded = discardPrefix;
    }

    const remainingToSent = targetBytes - bytesSentToPort;
    if (data.length > remainingToSent) {
      data = data.subarray(0, remainingToSent);
    }

    if (data.length > 0) {
      sendBytes(data);
      bytesSentToPort += data.length;
    }
  };

  let dsdBuffer = new Uint8Array(0);
  const processAndSendDsdBytes = (rawDsdBytes: Uint8Array) => {
    if (aborted) return;
    const newBuf = new Uint8Array(dsdBuffer.length + rawDsdBytes.length);
    newBuf.set(dsdBuffer, 0);
    newBuf.set(rawDsdBytes, dsdBuffer.length);
    dsdBuffer = newBuf;

    const blockSize = dsdHeader.blockSize || 4096;
    const channels = dsdHeader.channels || 2;
    const groupSize = blockSize * channels;

    const numGroups = Math.floor(dsdBuffer.length / groupSize);
    if (numGroups === 0) return;

    const samplesPerChannelPerGroup = blockSize / 8;
    const pcmBytes = new Uint8Array(numGroups * samplesPerChannelPerGroup * channels * 2);
    const pcmView = new DataView(pcmBytes.buffer);

    let pcmOffset = 0;
    for (let g = 0; g < numGroups; g++) {
      const groupStart = g * groupSize;
      
      for (let s = 0; s < samplesPerChannelPerGroup; s++) {
        const leftByteOffset = groupStart + (0 * blockSize) + (s * 8);
        let leftOnes = 0;
        for (let b = 0; b < 8; b++) {
          let temp = dsdBuffer[leftByteOffset + b];
          while (temp > 0) {
            leftOnes += temp & 1;
            temp >>= 1;
          }
        }
        const leftVal = (leftOnes / 32) - 1.0;
        const leftFiltered = lpFilterLeft ? lpFilterLeft.process(leftVal) : leftVal;
        const leftSample = Math.max(-32768, Math.min(32767, leftFiltered * 32767));
        pcmView.setInt16(pcmOffset, leftSample, true);
        pcmOffset += 2;

        const rightByteOffset = groupStart + (1 * blockSize) + (s * 8);
        let rightOnes = 0;
        for (let b = 0; b < 8; b++) {
          let temp = dsdBuffer[rightByteOffset + b];
          while (temp > 0) {
            rightOnes += temp & 1;
            temp >>= 1;
          }
        }
        const rightVal = (rightOnes / 32) - 1.0;
        const rightFiltered = lpFilterRight ? lpFilterRight.process(rightVal) : rightVal;
        const rightSample = Math.max(-32768, Math.min(32767, rightFiltered * 32767));
        pcmView.setInt16(pcmOffset, rightSample, true);
        pcmOffset += 2;
      }
    }

    sendBytesSliced(pcmBytes);
    dsdBuffer = dsdBuffer.slice(numGroups * groupSize);
  };

  const getChunkMessage = async (chunkIndex: number) => {
    if (chunkIndex < 0 || chunkIndex >= file.manifest.chunks.length) {
      return null;
    }
    const msgId = file.manifest.chunks[chunkIndex];
    if (!msgId) {
      return null;
    }

    let message = messageCache.get(msgId);
    if (message) return message;

    try {
      const messages = await client.getMessages(getPeerInput(config), [msgId]);
      if (!messages.length || !messages[0]) {
        return null;
      }
      message = messages[0];
      messageCache.set(msgId, message);
      return message;
    } catch (err) {
      console.warn(`[STREAM] Failed to fetch message for chunk ${chunkIndex}:`, err);
      return null;
    }
  };

  /**
   * Stream sub-parts of chunk from Telegram via downloadAsIterable.
   */
  const streamChunkRange = async (
    message: any,
    offsetInChunk: number,
    bytesNeeded: number,
    chunkIndex: number
  ): Promise<number> => {
    const fileChunkSize = getFileChunkSize(file.manifest);
    let bytesSent = 0;
    let attempts = 0;
    const MAX_ATTEMPTS = 3;

    const PART_ALIGN = 512 * 1024; // 512 KB Telegram-aligned

    while (attempts < MAX_ATTEMPTS && bytesSent < bytesNeeded && !aborted) {
      let rangeCompleted = false;
      try {
        const activeClient = await getHelperClient(chunkIndex % 6);
        const targetLocation = message?.media ?? message;

        const resumeOffset = offsetInChunk + bytesSent;
        const alignedOffset = Math.floor(resumeOffset / PART_ALIGN) * PART_ALIGN;
        const rangeAbortController = new AbortController();
        const abortRange = () => rangeAbortController.abort();
        if (streamAbortController.signal.aborted) abortRange();
        else streamAbortController.signal.addEventListener("abort", abortRange, { once: true });

        const iter = activeClient.downloadAsIterable(targetLocation, {
          offset: alignedOffset,
          partSize: 512,
          abortSignal: rangeAbortController.signal,
        });

        let downloadPos = alignedOffset;

        try {
          for await (const rawPiece of iter) {
            if (aborted) break;

            const piece = rawPiece instanceof Uint8Array ? rawPiece : new Uint8Array(rawPiece);

            appendCachedData(fileId, chunkIndex, downloadPos, piece, fileChunkSize);

            const pieceStart = downloadPos;
            const pieceEnd = downloadPos + piece.length;
            const sendStart = offsetInChunk + bytesSent;
            const sendEnd = offsetInChunk + bytesNeeded;

            if (pieceEnd > sendStart && pieceStart < sendEnd) {
              const sliceFrom = Math.max(0, sendStart - pieceStart);
              const sliceTo = Math.min(piece.length, sendEnd - pieceStart);
              const dataToSend = piece.subarray(sliceFrom, sliceTo);

              if (dataToSend.length > 0) {
                if (isDsfFile) {
                  processAndSendDsdBytes(new Uint8Array(dataToSend));
                } else {
                  sendBytesSliced(new Uint8Array(dataToSend));
                }
                bytesSent += dataToSend.length;
              }
            }

            downloadPos += piece.length;
            if (bytesSent >= bytesNeeded) {
              rangeCompleted = true;
              rangeAbortController.abort();
              break;
            }
          }
        } finally {
          streamAbortController.signal.removeEventListener("abort", abortRange);
          rangeAbortController.abort();
        }

        if (getCachedBytes(fileId, chunkIndex) >= fileChunkSize) {
          persistCompleteChunk(fileId, chunkIndex).catch(() => undefined);
        }

        if (bytesSent >= bytesNeeded || aborted) break;
      } catch (err) {
        // The abort used to stop mtcute's background workers happens after
        // the requested bytes were delivered. It is successful completion.
        if (rangeCompleted || aborted || (err as { name?: string })?.name === "AbortError") {
          break;
        }
        const wait = getFloodWaitSeconds(err);
        if (wait !== null) {
          console.warn(`[STREAM] FloodWait: sleeping ${wait}s then retrying chunk ${chunkIndex}`);
          await new Promise((r) => setTimeout(r, wait * 1000));
        } else {
          console.warn(`[STREAM] Chunk ${chunkIndex} stream attempt ${attempts + 1} failed:`, err);
          await new Promise((r) => setTimeout(r, 1000 * (attempts + 1)));
        }
      }
      attempts++;
    }

    return bytesSent;
  };

  try {
    let dsdStartOffset = 0;
    let dsdEndOffset = 0;
    if (isDsfFile) {
      const pcmByteStart = alignedStart < 44 ? 0 : alignedStart - 44;
      const pcmByteEnd = Math.min(wavTotalSize - 1, alignedEnd) - 44;
      dsdStartOffset = dsdHeader.dataOffset + pcmByteStart * 4;
      dsdEndOffset = dsdHeader.dataOffset + (pcmByteEnd + 1) * 4 - 1;
    }

    const fileChunkSize = getFileChunkSize(file.manifest);

    // Send HTTP Header IMMEDIATELY to ServiceWorker so video/audio element response resolves instantly
    port.postMessage({
      type: "HEADER",
      status: hasRange ? 206 : 200,
      start,
      end,
      totalSize: isDsfFile ? wavTotalSize : file.size,
      contentLength,
      mimeType: isDsfFile ? "audio/wav" : mimeType,
    });

    if (isDsfFile && alignedStart < 44) {
      const wavHeader = new ArrayBuffer(44);
      const wavView = new DataView(wavHeader);
      const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };
      const wavSampleRate = dsdHeader.sampleRate / 64;
      const wavByteRate = wavSampleRate * dsdHeader.channels * 2;
      const wavBlockAlign = dsdHeader.channels * 2;

      writeString(wavView, 0, 'RIFF');
      wavView.setUint32(4, 36 + wavDataSize, true);
      writeString(wavView, 8, 'WAVE');
      writeString(wavView, 12, 'fmt ');
      wavView.setUint32(16, 16, true);
      wavView.setUint16(20, 1, true);
      wavView.setUint16(22, dsdHeader.channels, true);
      wavView.setUint32(24, wavSampleRate, true);
      wavView.setUint32(28, wavByteRate, true);
      wavView.setUint16(32, wavBlockAlign, true);
      wavView.setUint16(34, 16, true);
      writeString(wavView, 36, 'data');
      wavView.setUint32(40, wavDataSize, true);

      const headerBytes = new Uint8Array(wavHeader);
      sendBytesSliced(headerBytes);
    }

    let cursor = isDsfFile ? dsdStartOffset : alignedStart;
    const finalEnd = isDsfFile ? dsdEndOffset : alignedEnd;

    while (cursor <= finalEnd && !aborted) {
      const chunkIndex = Math.floor(cursor / fileChunkSize);
      if (chunkIndex >= file.manifest.chunks.length) {
        break;
      }
      const chunkStart = chunkIndex * fileChunkSize;
      const offsetInChunk = cursor - chunkStart;
      const bytesNeeded = Math.min(finalEnd - cursor + 1, fileChunkSize - offsetInChunk);

      // --- 0. Hydrate this chunk from persistent storage if not in RAM ---
      if (getCachedBytes(fileId, chunkIndex) === 0) {
        await hydrateChunkFromStorage(fileId, chunkIndex);
      }

      // --- 1. Serve from range cache if available ---
      const cachedData = getCachedRange(fileId, chunkIndex, offsetInChunk, bytesNeeded);
      if (cachedData && cachedData.length > 0) {
        if (isDsfFile) {
          processAndSendDsdBytes(cachedData);
        } else {
          sendBytesSliced(cachedData);
        }
        cursor += cachedData.length;

        if (cachedData.length >= bytesNeeded) {
          const prefetchChunk = chunkIndex;
          const prefetchOffset = offsetInChunk + bytesNeeded;
          if (prefetchOffset < fileChunkSize) {
            triggerBackgroundPrefetch(client, config, fileId, file.manifest, prefetchChunk, prefetchOffset);
          } else if (chunkIndex + 1 < file.manifest.chunks.length) {
            triggerBackgroundPrefetch(client, config, fileId, file.manifest, chunkIndex + 1, 0);
          }
        }
        continue;
      }

      // --- 2. Check for partial cache hit ---
      const cachedSoFar = getCachedBytes(fileId, chunkIndex);
      if (cachedSoFar > offsetInChunk) {
        const partialData = getCachedRange(fileId, chunkIndex, offsetInChunk, cachedSoFar - offsetInChunk);
        if (partialData && partialData.length > 0) {
          if (isDsfFile) {
            processAndSendDsdBytes(partialData);
          } else {
            sendBytesSliced(partialData);
          }
          cursor += partialData.length;
          continue;
        }
      }

      // --- 3. Stream sub-part of chunk from Telegram ---
      const message = await getChunkMessage(chunkIndex);
      if (!message) {
        console.warn(`[STREAM] Chunk ${chunkIndex} message missing or unavailable, ending stream gracefully.`);
        break;
      }
      let sent = await streamChunkRange(message, offsetInChunk, bytesNeeded, chunkIndex);

      if (sent <= 0 && !aborted) {
        console.warn(`[STREAM] Sub-chunk stream returned 0 bytes, downloading chunk ${chunkIndex} to cache fallback...`);
        const fullChunk = await downloadChunkToCache(client, config, fileId, file.manifest, chunkIndex);
        if (fullChunk && fullChunk.length > offsetInChunk) {
          const sliceEnd = Math.min(fullChunk.length, offsetInChunk + bytesNeeded);
          const dataToSend = fullChunk.subarray(offsetInChunk, sliceEnd);
          if (isDsfFile) {
            processAndSendDsdBytes(dataToSend);
          } else {
            sendBytesSliced(dataToSend);
          }
          sent = dataToSend.length;
        }
      }

      if (sent <= 0 && !aborted) {
        throw new Error(`No bytes returned for chunk ${chunkIndex} at offset ${offsetInChunk}`);
      }

      cursor += sent;

      // Background prefetch continuation
      const nextOffset = offsetInChunk + sent;
      if (nextOffset < fileChunkSize) {
        triggerBackgroundPrefetch(client, config, fileId, file.manifest, chunkIndex, nextOffset);
      } else if (chunkIndex + 1 < file.manifest.chunks.length) {
        triggerBackgroundPrefetch(client, config, fileId, file.manifest, chunkIndex + 1, 0);
      }
    }

    if (!aborted) {
      port.postMessage({ type: "END" });
    }
  } catch (e: unknown) {
    console.error("[STREAM] ERROR:", e);
    port.postMessage({ type: "ERROR", error: getErrorMessage(e) });
  }
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  signal?: AbortSignal
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }).map(() => worker());
  await Promise.all(workers);
  return results;
}

async function getManifestMessageMap(
  client: TelegramClient,
  chatId: number,
  chunkIds: number[],
  config?: DriveConfig
): Promise<Map<number, any>> {
  const messageMap = new Map<number, any>();

  for (const msgId of chunkIds) {
    const cachedMsg = messageCache.get(msgId);
    if (cachedMsg) {
      messageMap.set(msgId, cachedMsg);
    }
  }

  const missingMessageIds = chunkIds.filter((id) => !messageMap.has(id));
  const batchSize = 100;
  const peerInput = config ? getPeerInput(config) : chatId;
  const batches: number[][] = [];
  for (let i = 0; i < missingMessageIds.length; i += batchSize) {
    batches.push(missingMessageIds.slice(i, i + batchSize));
  }
  if (batches.length > 0) {
    const fetchedBatches = await Promise.all(
      batches.map((batch) => client.getMessages(peerInput, batch))
    );
    for (const fetchedMessages of fetchedBatches) {
      for (const msg of fetchedMessages) {
        if (msg && msg.id) {
          messageMap.set(msg.id, msg);
          messageCache.set(msg.id, msg);
        }
      }
    }
  }

  return messageMap;
}

export async function listFilesInTopic(
  client: TelegramClient,
  config: DriveConfig,
  topicId: number,
  existingFiles?: DriveFile[] | null
): Promise<DriveFile[]> {
  try {
    // Resolving the peer refreshes an absent/stale access hash from mtcute's
    // entity cache. Constructing inputPeerChannel with `0` made getReplies
    // fail for drives recovered from older localStorage entries.
    const peer = await client.resolvePeer(Number(config.chatId));
    const messageById = new Map<number, any>();
    const isGeneralTopic = topicId === 1 || topicId <= 0;

    let minId = 0;
    const existingFileMap = new Map<number, DriveFile>();
    if (existingFiles && existingFiles.length > 0) {
      let maxId = 0;
      for (const f of existingFiles) {
        existingFileMap.set(f.id, f);
        if (f.id > maxId) maxId = f.id;
        if (f.manifest?.chunks) {
          for (const cid of f.manifest.chunks) {
            if (cid > maxId) maxId = cid;
          }
        }
        if (typeof f.manifest?.thumb === "number" && f.manifest.thumb > maxId) {
          maxId = f.manifest.thumb;
        }
      }
      if (maxId > 0) {
        minId = maxId;
      }
    }

    if (!isGeneralTopic) {
      try {
        for (const message of await getReplyMessages(client, peer, topicId, 0)) {
          messageById.set(message.id, message);
        }
      } catch (error) {
        // The complete-history scan below is intentionally retained as a
        // compatibility path for migrated/legacy forum topics.
        // A rate limit is transient; falling through to getHistory doubles
        // request pressure and makes the flood wait worse.
        if (getFloodWaitSeconds(error) !== null) throw error;
        console.warn(`[listFilesInTopic] getReplies failed for topic ${topicId}; scanning history.`, error);
      }
    }

    const getMessageText = (m: any): string => {
      if (!m) return "";
      if (typeof m.message === "string" && m.message) return m.message;
      if (typeof m.text === "string" && m.text) return m.text;
      if (typeof m.caption === "string" && m.caption) return m.caption;
      if (typeof m.raw?.message === "string" && m.raw.message) return m.raw.message;
      if (typeof m.raw?.text === "string" && m.raw.text) return m.raw.text;
      if (typeof m.raw?.caption === "string" && m.raw.caption) return m.raw.caption;
      return "";
    };

    const extractFilesFromMap = async (): Promise<DriveFile[]> => {
      const parsedFiles: DriveFile[] = [];
      const manifestItems: { msg: any; manifest: ChunkManifest }[] = [];
      const referencedChunkAndThumbIds = new Set<number>();
      const missingChunkIds: number[] = [];

      for (const m of messageById.values()) {
        const text = getMessageText(m);
        if (!text) continue;
        const manifest = parseManifest(text);
        if (manifest && !isChunkOrThumbFileName(manifest.fileName)) {
          manifestItems.push({ msg: m, manifest });
          for (const chunkId of manifest.chunks) {
            referencedChunkAndThumbIds.add(chunkId);
            if (!messageById.has(chunkId)) {
              missingChunkIds.push(chunkId);
            }
          }
          if (typeof manifest.thumb === "number") {
            referencedChunkAndThumbIds.add(manifest.thumb);
            if (!messageById.has(manifest.thumb)) {
              missingChunkIds.push(manifest.thumb);
            }
          }
        }
      }

      if (missingChunkIds.length > 0) {
        try {
          const peerInput = getPeerInput(config);
          const batchSize = 100;
          for (let i = 0; i < missingChunkIds.length; i += batchSize) {
            const slice = missingChunkIds.slice(i, i + batchSize);
            const chunkMessages: any = await client.getMessages(peerInput, slice);
            for (const chunkMsg of chunkMessages) {
              if (chunkMsg && chunkMsg.id) {
                messageById.set(chunkMsg.id, chunkMsg);
              }
            }
          }
        } catch (err) {
          console.warn("[listFilesInTopic] Failed to batch fetch chunk messages:", err);
        }
      }

      const processedMessageIds = new Set<number>();

      for (const item of manifestItems) {
        const { msg, manifest } = item;
        if (referencedChunkAndThumbIds.has(msg.id) || isChunkOrThumbFileName(manifest.fileName)) {
          continue;
        }
        const chunkMsg = messageById.get(manifest.chunks[0]);
        const chunkInfo = getMessageDocumentInfo(chunkMsg);
        processedMessageIds.add(msg.id);
        for (const cid of manifest.chunks) processedMessageIds.add(cid);
        if (typeof manifest.thumb === "number") processedMessageIds.add(manifest.thumb);

        parsedFiles.push({
          id: msg.id,
          name: manifest.fileName,
          size: manifest.fileSize,
          topicId,
          manifest,
          date: getMessageDateSeconds(msg),
          mimeType: chunkInfo.mimeType || mimeTypeFromName(manifest.fileName),
          chunkFileName: chunkInfo.fileName,
          message: chunkMsg,
        });
      }

      // Fallback: Detect files/documents/media uploaded directly into topic without separate manifest
      for (const m of messageById.values()) {
        if (processedMessageIds.has(m.id) || referencedChunkAndThumbIds.has(m.id)) {
          continue;
        }
        const docInfo = getMessageDocumentInfo(m);
        if (docInfo.fileName) {
          if (isChunkOrThumbFileName(docInfo.fileName)) {
            continue;
          }
          const syntheticManifest: ChunkManifest = {
            type: "segmented_file",
            fileName: docInfo.fileName,
            fileSize: docInfo.fileSize || 0,
            chunks: [m.id],
          };

          parsedFiles.push({
            id: m.id,
            name: docInfo.fileName,
            size: docInfo.fileSize || 0,
            topicId,
            manifest: syntheticManifest,
            date: getMessageDateSeconds(m),
            mimeType: docInfo.mimeType || mimeTypeFromName(docInfo.fileName),
            chunkFileName: docInfo.fileName,
            message: m,
          });
        }
      }

      // Recovery path for interrupted legacy uploads.
      const orphanPartGroups = new Map<string, {
        partIndex: number;
        message: any;
        info: ReturnType<typeof getMessageDocumentInfo>;
      }[]>();

      for (const m of messageById.values()) {
        if (processedMessageIds.has(m.id) || referencedChunkAndThumbIds.has(m.id)) continue;
        const info = getMessageDocumentInfo(m);
        const match = info.fileName?.match(/^(.*)\.part(\d+)$/i);
        if (!match || !match[1]) continue;
        const partIndex = Number(match[2]);
        if (!Number.isSafeInteger(partIndex) || partIndex < 0) continue;
        const group = orphanPartGroups.get(match[1]) || [];
        group.push({ partIndex, message: m, info });
        orphanPartGroups.set(match[1], group);
      }

      for (const [fileName, group] of orphanPartGroups) {
        if (group.length < 2) continue;
        group.sort((a, b) => a.partIndex - b.partIndex);
        const firstPart = group[0].partIndex;
        if (firstPart !== 0 && firstPart !== 1) continue;
        if (group.some((part, index) => part.partIndex !== firstPart + index)) continue;

        const totalSize = group.reduce((sum, part) => sum + (part.info.fileSize || 0), 0);
        if (totalSize <= 0) continue;
        const chunkSize = Math.max(...group.map((part) => part.info.fileSize || 0));
        const first = group[0];
        for (const part of group) processedMessageIds.add(part.message.id);

        parsedFiles.push({
          id: first.message.id,
          name: fileName,
          size: totalSize,
          topicId,
          manifest: {
            type: "segmented_file",
            fileName,
            fileSize: totalSize,
            chunks: group.map((part) => part.message.id),
            ...(chunkSize > 0 ? { chunkSize } : {}),
          },
          date: Math.max(...group.map((part) => getMessageDateSeconds(part.message))),
          mimeType: mimeTypeFromName(fileName),
          chunkFileName: first.info.fileName,
          message: first.message,
        });
      }
      return parsedFiles;
    };

    let files = await extractFilesFromMap();

    // Fallback: scan every history page and keep only this topic.
    if (files.length === 0 && messageById.size === 0) {
      for (const message of await getTopicMessagesFromHistory(client, peer, topicId, 0)) {
        messageById.set(message.id, message);
      }

      files = await extractFilesFromMap();
    }

    return files;
  } catch (err) {
    console.error("Failed to list files in topic:", err);
    throw err;
  }
}

export async function deleteDriveFile(
  client: TelegramClient,
  config: DriveConfig,
  file: DriveFile
): Promise<boolean> {
  try {
    const chatIdNumber = Number(config.chatId);
    const ids = Array.from(
      new Set([
        file.id,
        ...(file.manifest.thumb ? [file.manifest.thumb] : []),
        ...file.manifest.chunks,
      ])
    );
    await client.deleteMessagesById(chatIdNumber, ids);
    return true;
  } catch (err) {
    console.error("Failed to delete file:", err);
    return false;
  }
}

export async function renameDriveFile(
  client: TelegramClient,
  config: DriveConfig,
  file: DriveFile,
  name: string
): Promise<boolean> {
  try {
    const chatIdNumber = Number(config.chatId);
    const nextName = normalizeRenamedFileName(file, name);
    await client.editMessage({
      chatId: chatIdNumber,
      message: file.id,
      text: buildManifest(
        nextName,
        file.size,
        file.manifest.chunks,
        file.manifest.thumb,
        file.manifest.chunkSize
      ),
    });
    return true;
  } catch (err) {
    console.error("Failed to rename file:", err);
    return false;
  }
}

function getDynamicConcurrency() {
  return { segments: 8, workers: 12 };
}

export async function downloadFile(
  client: TelegramClient,
  config: DriveConfig,
  manifest: ChunkManifest,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const { segments, workers } = getDynamicConcurrency();
  const chatIdNumber = Number(config.chatId);

  const chunkProgress = new Float64Array(manifest.chunks.length);
  const emitProgress = () => {
    const totalDownloaded = chunkProgress.reduce((a, b) => a + b, 0);
    onProgress?.(totalDownloaded, manifest.fileSize);
  };
  const progressInterval = setInterval(emitProgress, 250);

  let abortPromise: Promise<never> | null = null;
  let abortHandler: (() => void) | null = null;
  if (signal) {
    abortPromise = new Promise((_, reject) => {
      abortHandler = () => reject(new DOMException("Download aborted", "AbortError"));
      signal.addEventListener("abort", abortHandler);
    });
  }

  try {
    if (signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    emitProgress();

    const messageMap = await getManifestMessageMap(client, chatIdNumber, manifest.chunks, config);

    const tasks = manifest.chunks.map((msgId, index) => async () => {
      if (signal?.aborted) {
        throw new DOMException("Download aborted", "AbortError");
      }
      let message = messageMap.get(msgId);
      if (!message) {
        const messages = await client.getMessages(getPeerInput(config), [msgId]);
        if (messages.length > 0 && messages[0]) {
          message = messages[0];
          messageMap.set(msgId, message);
          messageCache.set(msgId, message);
        } else {
          throw new Error(`Message not found for chunk ${index}`);
        }
      }

      let attempts = 0;
      while (attempts < 5) {
        if (signal?.aborted) {
          throw new DOMException("Download aborted", "AbortError");
        }
        try {
          const activeClient = await getHelperClient(index % 6);
          const buffer = await downloadMediaWithWorkers(activeClient, message, {
            workers: workers,
            progressCallback: (dl) => {
              chunkProgress[index] = Math.max(chunkProgress[index], Number(dl));
            },
          });

          if (buffer && buffer.length > 0) {
            chunkProgress[index] = buffer.length;
            return { index, buffer: new Uint8Array(buffer) };
          }
        } catch (e) {
          if (signal?.aborted) {
            throw new DOMException("Download aborted", "AbortError");
          }
          const wait = getFloodWaitSeconds(e);
          if (wait !== null) {
            console.warn(`FloodWait: sleeping ${wait}s then retrying chunk ${index}`);
            await new Promise((r) => setTimeout(r, wait * 1000));
            attempts++;
            continue;
          }
          console.warn(`Chunk ${index} failed, retrying...`, e);
        }
        attempts++;
        await new Promise((r) => setTimeout(r, 1000 * attempts));
      }
      throw new Error(`Failed to download chunk ${index}`);
    });

    let results: any[];
    const downloadPromise = runWithConcurrency(tasks, segments, signal);
    if (abortPromise) {
      results = await Promise.race([downloadPromise, abortPromise]);
    } else {
      results = await downloadPromise;
    }
    results.sort((a, b) => a.index - b.index);

    const blob = new Blob(results.map((r) => r.buffer));
    const savedNatively = await saveBlobToDevice(blob, manifest.fileName);
    if (savedNatively) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = manifest.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 60000);
  } catch (err) {
    throw err;
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
    clearInterval(progressInterval);
    emitProgress();
  }
}

export async function downloadFileToMemory(
  client: TelegramClient,
  config: DriveConfig,
  manifest: ChunkManifest,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal,
  fileId?: string
): Promise<Blob> {
  const { segments } = getDynamicConcurrency();
  const chatIdNumber = Number(config.chatId);
  const chunkProgress = new Float64Array(manifest.chunks.length);
  const emitProgress = () => {
    const totalDownloaded = chunkProgress.reduce((a, b) => a + b, 0);
    onProgress?.(totalDownloaded, manifest.fileSize);
  };
  const progressInterval = setInterval(emitProgress, 250);

  let abortPromise: Promise<never> | null = null;
  let abortHandler: (() => void) | null = null;
  if (signal) {
    abortPromise = new Promise((_, reject) => {
      abortHandler = () => reject(new DOMException("Download aborted", "AbortError"));
      signal.addEventListener("abort", abortHandler);
    });
  }

  try {
    if (signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    emitProgress();

    const messageMap = await getManifestMessageMap(client, chatIdNumber, manifest.chunks, config);

    const tasks = manifest.chunks.map((msgId, index) => async () => {
      if (signal?.aborted) {
        throw new DOMException("Download aborted", "AbortError");
      }
      if (fileId) {
        let cached = getFullCachedChunk(fileId, index);
        if (!cached && (await hydrateChunkFromStorage(fileId, index))) {
          cached = getFullCachedChunk(fileId, index);
        }
        if (cached && cached.length > 0) {
          chunkProgress[index] = cached.length;
          return { index, buffer: cached };
        }
      }
      let message = messageMap.get(msgId);
      if (!message) {
        const messages = await client.getMessages(getPeerInput(config), [msgId]);
        if (messages.length > 0 && messages[0]) {
          message = messages[0];
          messageMap.set(msgId, message);
          messageCache.set(msgId, message);
        } else {
          throw new Error(`Message not found for chunk ${index}`);
        }
      }

      let attempts = 0;
      while (attempts < 3) {
        if (signal?.aborted) {
          throw new DOMException("Download aborted", "AbortError");
        }
        try {
          const activeClient = await getHelperClient(index % 6);
          const buffer = await downloadMediaWithWorkers(activeClient, message, {
            workers: 12,
            progressCallback: (dl) => {
              chunkProgress[index] = Number(dl);
            },
          });

          if (buffer && buffer.length > 0) {
            chunkProgress[index] = buffer.length;
            if (fileId) {
              const arr = new Uint8Array(buffer);
              setFullCachedChunk(fileId, index, arr);
              persistChunkToStorage(fileId, index, arr).catch(() => undefined);
            }
            return { index, buffer: new Uint8Array(buffer) };
          }
        } catch (e) {
          console.warn(`Chunk ${index} failed, retrying...`, e);
        }
        attempts++;
        await new Promise((r) => setTimeout(r, 1000 * attempts));
      }
      throw new Error(`Failed to download chunk ${index}`);
    });

    let results: any[];
    const downloadPromise = runWithConcurrency(tasks, segments, signal);
    if (abortPromise) {
      results = await Promise.race([downloadPromise, abortPromise]);
    } else {
      results = await downloadPromise;
    }
    results.sort((a, b) => a.index - b.index);

    return new Blob(results.map((r) => r.buffer));
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
    clearInterval(progressInterval);
    emitProgress();
  }
}
