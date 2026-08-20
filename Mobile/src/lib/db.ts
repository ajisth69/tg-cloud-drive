import type { DriveFile } from "../types";

const DB_NAME = "ClashDriveDB";
const DB_VERSION = 3;
const STORE_NAME = "folder_index";
const CHUNK_STORE = "chunk_cache";
const THUMB_STORE = "thumb_cache";
const OFFLINE_STORE = "offline_files";
const META_SYNC_STORE = "meta_sync";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB not supported"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        db.createObjectStore(CHUNK_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(THUMB_STORE)) {
        db.createObjectStore(THUMB_STORE, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(OFFLINE_STORE)) {
        db.createObjectStore(OFFLINE_STORE, { keyPath: "fileId" });
      }
      if (!db.objectStoreNames.contains(META_SYNC_STORE)) {
        db.createObjectStore(META_SYNC_STORE, { keyPath: "topicId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function sanitizeDriveFile(file: DriveFile): DriveFile {
  // Strip raw Telegram message object to save memory and avoid non-cloneable reference errors in IndexedDB
  const { message, ...rest } = file;
  return rest;
}

export async function saveTopicFilesToDB(topicId: number, files: DriveFile[]): Promise<void> {
  try {
    const db = await openDB();
    const cleanFiles = files.map(sanitizeDriveFile);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(cleanFiles, topicId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Failed to save topic ${topicId} files to storage:`, err);
  }
}

export async function loadTopicFilesFromDB(topicId: number): Promise<DriveFile[] | null> {
  try {
    const db = await openDB();
    return await new Promise<DriveFile[] | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(topicId);
      req.onsuccess = () => {
        const result = req.result;
        resolve(Array.isArray(result) ? (result as DriveFile[]) : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Failed to load topic ${topicId} files from storage:`, err);
    return null;
  }
}

export async function deleteTopicFilesFromDB(topicId: number): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(topicId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Failed to delete topic ${topicId} from storage:`, err);
  }
}

export async function clearAllTopicFilesDB(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to clear topic index storage:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Volatile persistent chunk cache (previews / streaming).
// The OS may purge this storage when the device runs out of space — the app
// must tolerate the loss (it just re-downloads on demand).
// ─────────────────────────────────────────────────────────────────────────────

export interface ChunkCacheEntry {
  key: string;
  data: ArrayBuffer;
  size: number;
  lastAccess: number;
}

export async function saveChunkToDB(key: string, data: Uint8Array): Promise<void> {
  try {
    const db = await openDB();
    const entry: ChunkCacheEntry = {
      key,
      data: data.slice().buffer as ArrayBuffer,
      size: data.byteLength,
      lastAccess: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE, "readwrite");
      const store = tx.objectStore(CHUNK_STORE);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to save chunk to storage:", err);
  }
}

export async function loadChunkFromDB(key: string): Promise<Uint8Array | null> {
  try {
    const db = await openDB();
    const entry = await new Promise<ChunkCacheEntry | undefined>((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE, "readwrite");
      const store = tx.objectStore(CHUNK_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const result = req.result as ChunkCacheEntry | undefined;
        if (result) {
          result.lastAccess = Date.now();
          store.put(result);
        }
        resolve(result);
      };
      req.onerror = () => reject(req.error);
    });
    if (!entry) return null;
    return new Uint8Array(entry.data);
  } catch (err) {
    console.warn("[IndexedDB] Failed to load chunk from storage:", err);
    return null;
  }
}

export async function deleteChunkFromDB(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE, "readwrite");
      const store = tx.objectStore(CHUNK_STORE);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to delete chunk from storage:", err);
  }
}

export async function listChunkEntriesDB(): Promise<ChunkCacheEntry[]> {
  try {
    const db = await openDB();
    return await new Promise<ChunkCacheEntry[]>((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE, "readonly");
      const store = tx.objectStore(CHUNK_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as ChunkCacheEntry[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to list chunk cache:", err);
    return [];
  }
}

export async function clearChunkCacheDB(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CHUNK_STORE, "readwrite");
      const store = tx.objectStore(CHUNK_STORE);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to clear chunk cache:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent thumbnail cache (file covers / first frames).
// Small JPEG blobs (~30-80 KB each) so covers load instantly on next launch.
// ─────────────────────────────────────────────────────────────────────────────

export interface ThumbCacheEntry {
  key: string;
  data: ArrayBuffer;
  size: number;
  lastAccess: number;
  mime?: string;
}

const THUMB_CACHE_MAX_ENTRIES = 800;
const THUMB_CACHE_MAX_BYTES = 120 * 1024 * 1024;

export async function saveThumbToDB(key: string, blob: Blob): Promise<void> {
  try {
    const buffer = await blob.arrayBuffer();
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(THUMB_STORE, "readwrite");
      const store = tx.objectStore(THUMB_STORE);
      const req = store.put({
        key,
        data: buffer,
        size: buffer.byteLength,
        lastAccess: Date.now(),
        mime: blob.type || "image/jpeg",
      } as ThumbCacheEntry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    await pruneThumbCache();
  } catch (err) {
    console.warn("[IndexedDB] Failed to save thumb to storage:", err);
  }
}

export async function loadThumbFromDB(key: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    const entry = await new Promise<ThumbCacheEntry | undefined>((resolve, reject) => {
      const tx = db.transaction(THUMB_STORE, "readwrite");
      const store = tx.objectStore(THUMB_STORE);
      const req = store.get(key);
      req.onsuccess = () => {
        const result = req.result as ThumbCacheEntry | undefined;
        if (result) {
          result.lastAccess = Date.now();
          store.put(result);
        }
        resolve(result);
      };
      req.onerror = () => reject(req.error);
    });
    if (!entry) return null;
    return new Blob([entry.data], { type: entry.mime || "image/jpeg" });
  } catch (err) {
    console.warn("[IndexedDB] Failed to load thumb from storage:", err);
    return null;
  }
}

export async function deleteThumbFromDB(key: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(THUMB_STORE, "readwrite");
      const store = tx.objectStore(THUMB_STORE);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to delete thumb from storage:", err);
  }
}

export async function clearThumbCacheDB(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(THUMB_STORE, "readwrite");
      const store = tx.objectStore(THUMB_STORE);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to clear thumb cache:", err);
  }
}

async function pruneThumbCache(): Promise<void> {
  try {
    const db = await openDB();
    const entries = await new Promise<ThumbCacheEntry[]>((resolve, reject) => {
      const tx = db.transaction(THUMB_STORE, "readonly");
      const store = tx.objectStore(THUMB_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as ThumbCacheEntry[]) || []);
      req.onerror = () => reject(req.error);
    });
    if (entries.length <= THUMB_CACHE_MAX_ENTRIES) {
      const total = entries.reduce((s, e) => s + e.size, 0);
      if (total <= THUMB_CACHE_MAX_BYTES) return;
    }
    const sorted = [...entries].sort((a, b) => b.lastAccess - a.lastAccess);
    const tx = db.transaction(THUMB_STORE, "readwrite");
    const store = tx.objectStore(THUMB_STORE);
    let keptBytes = 0;
    let keptCount = 0;
    for (const entry of sorted) {
      if (keptCount < THUMB_CACHE_MAX_ENTRIES && keptBytes + entry.size <= THUMB_CACHE_MAX_BYTES) {
        keptBytes += entry.size;
        keptCount++;
      } else {
        store.delete(entry.key);
      }
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to prune thumb cache:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistent metadata sync registry (delta sync bookkeeping)
// ─────────────────────────────────────────────────────────────────────────────

export interface MetaSyncEntry {
  topicId: number;
  lastMaxId: number;
  lastSyncAt: number;
}

export async function saveMetaSyncToDB(entry: MetaSyncEntry): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_SYNC_STORE, "readwrite");
      const store = tx.objectStore(META_SYNC_STORE);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Failed to save meta sync for topic ${entry.topicId}:`, err);
  }
}

export async function loadMetaSyncFromDB(topicId: number): Promise<MetaSyncEntry | null> {
  try {
    const db = await openDB();
    return await new Promise<MetaSyncEntry | null>((resolve, reject) => {
      const tx = db.transaction(META_SYNC_STORE, "readonly");
      const store = tx.objectStore(META_SYNC_STORE);
      const req = store.get(topicId);
      req.onsuccess = () => resolve((req.result as MetaSyncEntry) || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[IndexedDB] Failed to load meta sync for topic ${topicId}:`, err);
    return null;
  }
}

export async function clearMetaSyncDB(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_SYNC_STORE, "readwrite");
      const store = tx.objectStore(META_SYNC_STORE);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[IndexedDB] Failed to clear meta sync:", err);
  }
}