/**
 * Range-aware streaming cache for video/audio chunk data.
 *
 * Instead of storing only fully-downloaded chunks, this cache supports
 * incremental appending of streamed bytes. Each chunk has a contiguous
 * buffer that grows from offset 0 as data arrives from Telegram.
 *
 * This enables the stream handler to:
 *  1. Serve cached bytes immediately for ranges already downloaded
 *  2. Stream only the missing tail from Telegram
 *  3. Cache new bytes as they arrive for future seeks
 *
 * LRU eviction keeps memory bounded.
 *
 * Completed chunks are additionally persisted to IndexedDB (volatile —
 * the OS may purge it under storage pressure; the app tolerates the loss
 * by re-downloading on demand). RAM is checked first, then disk.
 */

import {
  clearChunkCacheDB,
  deleteChunkFromDB,
  listChunkEntriesDB,
  loadChunkFromDB,
  saveChunkToDB,
} from "./db";

interface ChunkBuffer {
  /** Backing buffer — may be larger than validBytes (pre-allocated). */
  data: Uint8Array;
  /** Number of contiguous bytes valid from offset 0. */
  validBytes: number;
  /** Last access timestamp for LRU eviction. */
  lastAccess: number;
}

const chunkBuffers = new Map<string, ChunkBuffer>();
const MAX_CACHED_CHUNKS = 30;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const INITIAL_BUFFER_BYTES = 4 * 1024 * 1024;
const PERSISTENT_CACHE_MAX_BYTES = 256 * 1024 * 1024;

function makeKey(fileId: string, chunkIndex: number): string {
  return `${fileId}:${chunkIndex}`;
}

function touchEntry(buf: ChunkBuffer): void {
  buf.lastAccess = Date.now();
}

function evictIfNeeded(requiredBytes = 0, protectedKey?: string): void {
  const cacheBytes = () => {
    let total = 0;
    for (const buf of chunkBuffers.values()) total += buf.data.byteLength;
    return total;
  };

  while (
    chunkBuffers.size > 0 &&
    (chunkBuffers.size >= MAX_CACHED_CHUNKS || cacheBytes() + requiredBytes > MAX_CACHE_BYTES)
  ) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, buf] of chunkBuffers) {
      if (key !== protectedKey && buf.lastAccess < oldestTime) {
        oldestTime = buf.lastAccess;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    chunkBuffers.delete(oldestKey);
  }
}

// ---------------------------------------------------------------------------
// Public API — Range-based operations
// ---------------------------------------------------------------------------

/**
 * Returns how many contiguous bytes (from offset 0) are cached for a chunk.
 */
export function getCachedBytes(fileId: string, chunkIndex: number): number {
  const buf = chunkBuffers.get(makeKey(fileId, chunkIndex));
  if (!buf) return 0;
  touchEntry(buf);
  return buf.validBytes;
}

/**
 * Read cached data for a byte range within a chunk.
 *
 * Returns a slice of whatever is available starting at `offset`.
 * The returned array may be *shorter* than `length` if the cache
 * only has partial coverage.  Returns `null` if nothing is cached
 * at the requested offset.
 */
export function getCachedRange(
  fileId: string,
  chunkIndex: number,
  offset: number,
  length: number
): Uint8Array | null {
  const key = makeKey(fileId, chunkIndex);
  const buf = chunkBuffers.get(key);
  if (!buf || buf.validBytes <= offset) return null;
  if (buf.data.byteLength === 0) {
    // Detached buffer (was transferred away) — drop the entry, treat as miss
    chunkBuffers.delete(key);
    return null;
  }

  touchEntry(buf);
  const available = Math.min(length, buf.validBytes - offset);
  if (available <= 0) return null;

  return buf.data.subarray(offset, offset + available);
}

/**
 * Append contiguous data at a specific offset inside a chunk buffer.
 *
 * The caller is responsible for appending in order (offset should equal
 * the current validBytes for the append to extend the contiguous range).
 * Out-of-order writes are stored but do NOT advance `validBytes`.
 *
 * `totalChunkSize` is used to pre-allocate the backing buffer on first write.
 */
export function appendCachedData(
  fileId: string,
  chunkIndex: number,
  offset: number,
  data: Uint8Array,
  totalChunkSize: number
): void {
  const key = makeKey(fileId, chunkIndex);
  let buf = chunkBuffers.get(key);

  // This cache tracks a contiguous prefix.  Caching a seek near the end of a
  // 100+ MB Telegram document would otherwise allocate the whole gap and is
  // the main cause of playback stalls on large videos.
  if ((!buf && offset > 0) || (buf && offset > buf.validBytes)) return;

  if (!buf) {
    const allocSize = Math.min(totalChunkSize, Math.max(INITIAL_BUFFER_BYTES, offset + data.length));
    evictIfNeeded(allocSize);
    buf = {
      data: new Uint8Array(allocSize),
      validBytes: 0,
      lastAccess: Date.now(),
    };
    chunkBuffers.set(key, buf);
  }

  // Grow backing buffer if needed
  const end = offset + data.length;
  if (end > buf.data.length) {
    const nextSize = Math.min(totalChunkSize, Math.max(end, buf.data.length * 2));
    evictIfNeeded(nextSize - buf.data.length, key);
    const newBuf = new Uint8Array(nextSize);
    newBuf.set(buf.data.subarray(0, buf.validBytes));
    buf.data = newBuf;
  }

  buf.data.set(data, offset);

  // Only advance validBytes if this write is contiguous from the current end
  if (offset <= buf.validBytes) {
    buf.validBytes = Math.max(buf.validBytes, end);
  }

  touchEntry(buf);
}

// ---------------------------------------------------------------------------
// Public API — Full-chunk operations (backward compat)
// ---------------------------------------------------------------------------

/**
 * Store a fully-downloaded chunk.  Used by `downloadChunkToCache` and
 * `FileCardThumbnail` which download whole chunks at once.
 */
export function setFullCachedChunk(
  fileId: string,
  chunkIndex: number,
  data: Uint8Array
): void {
  const key = makeKey(fileId, chunkIndex);
  const existing = chunkBuffers.get(key);
  evictIfNeeded(data.byteLength - (existing?.data.byteLength ?? 0), key);
  chunkBuffers.set(key, {
    data,
    validBytes: data.length,
    lastAccess: Date.now(),
  });
}

/**
 * Get the cached data for a chunk (however much has been downloaded).
 * Returns `null` if nothing is cached.
 */
export function getFullCachedChunk(
  fileId: string,
  chunkIndex: number
): Uint8Array | null {
  const key = makeKey(fileId, chunkIndex);
  const buf = chunkBuffers.get(key);
  if (!buf || buf.validBytes === 0) return null;
  if (buf.data.byteLength === 0) {
    // Detached buffer (was transferred away) — drop the entry, treat as miss
    chunkBuffers.delete(key);
    return null;
  }
  touchEntry(buf);
  return buf.data.subarray(0, buf.validBytes);
}

/**
 * Evict all cached data for a specific file.
 */
export function evictFileCache(fileId: string): void {
  for (const key of [...chunkBuffers.keys()]) {
    if (key.startsWith(fileId + ":")) {
      chunkBuffers.delete(key);
    }
  }
  deleteChunkFromDBPrefix(fileId).catch(() => undefined);
}

async function deleteChunkFromDBPrefix(fileId: string): Promise<void> {
  const entries = await listChunkEntriesDB();
  await Promise.all(
    entries
      .filter((e) => e.key.startsWith(fileId + ":"))
      .map((e) => deleteChunkFromDB(e.key))
  );
}

// ---------------------------------------------------------------------------
// Persistent (IndexedDB) chunk cache — volatile, purgeable, LRU-bounded
// ---------------------------------------------------------------------------

async function evictPersistentIfNeeded(requiredBytes: number): Promise<void> {
  try {
    const entries = await listChunkEntriesDB();
    let total = 0;
    for (const e of entries) total += e.size;
    if (total + requiredBytes <= PERSISTENT_CACHE_MAX_BYTES) return;
    const sorted = [...entries].sort((a, b) => a.lastAccess - b.lastAccess);
    for (const entry of sorted) {
      if (total + requiredBytes <= PERSISTENT_CACHE_MAX_BYTES) break;
      await deleteChunkFromDB(entry.key);
      total -= entry.size;
    }
  } catch (err) {
    console.warn("[CACHE] Persistent eviction failed:", err);
  }
}

/**
 * Persist a completed chunk to IndexedDB. Best-effort: failures are logged
 * and silently ignored (the app re-downloads on demand).
 */
export async function persistChunkToStorage(
  fileId: string,
  chunkIndex: number,
  data: Uint8Array
): Promise<void> {
  if (data.byteLength === 0) return;
  try {
    await evictPersistentIfNeeded(data.byteLength);
    await saveChunkToDB(makeKey(fileId, chunkIndex), data);
  } catch (err) {
    console.warn("[CACHE] Chunk persist failed:", err);
  }
}

/**
 * Persist whatever is fully cached in RAM for this chunk.
 */
export async function persistCompleteChunk(fileId: string, chunkIndex: number): Promise<void> {
  const data = getFullCachedChunk(fileId, chunkIndex);
  if (data && data.length > 0) {
    await persistChunkToStorage(fileId, chunkIndex, data);
  }
}

/**
 * Load a chunk from IndexedDB into RAM (if present). Returns true on hit.
 */
export async function hydrateChunkFromStorage(fileId: string, chunkIndex: number): Promise<boolean> {
  try {
    const data = await loadChunkFromDB(makeKey(fileId, chunkIndex));
    if (!data || data.length === 0) return false;
    setFullCachedChunk(fileId, chunkIndex, data);
    return true;
  } catch (err) {
    console.warn("[CACHE] Chunk hydrate failed:", err);
    return false;
  }
}

/**
 * Wipe the persistent chunk cache entirely (e.g. "Clear Cache").
 */
export async function clearPersistentCache(): Promise<void> {
  try {
    await clearChunkCacheDB();
  } catch (err) {
    console.warn("[CACHE] Persistent cache clear failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Legacy aliases — kept so existing imports compile without changes
// ---------------------------------------------------------------------------

export async function getCachedChunk(
  fileId: string,
  chunkIndex: number
): Promise<Uint8Array | null> {
  return getFullCachedChunk(fileId, chunkIndex);
}

export async function setCachedChunk(
  fileId: string,
  chunkIndex: number,
  data: Uint8Array
): Promise<void> {
  setFullCachedChunk(fileId, chunkIndex, data);
}
