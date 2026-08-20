import { useState, useCallback, useRef, useEffect } from "react";
import { TelegramClient } from "@mtcute/web";
import { listFilesInTopic } from "../lib/downloader";
import { uploadFile as uploadFileLib, getUploadChunkSize } from "../lib/uploader";
import { deleteDriveFile, downloadFile as downloadFileLib, normalizeRenamedFileName, renameDriveFile } from "../lib/downloader";
import { ensureConnected } from "../lib/client";
import type { DriveFile, UploadProgress, DriveConfig, DownloadProgress } from "../types";
import { loadTopicFilesFromDB, saveTopicFilesToDB, deleteTopicFilesFromDB } from "../lib/db";

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }).map(() => worker())
  );
  return results;
}

export function useFiles() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const indexingRef = useRef(false);
  const [indexingProgress, setIndexingProgress] = useState({ current: 0, total: 0 });
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [favouriteFiles, setFavouriteFiles] = useState<DriveFile[]>([]);
  const fileCache = useRef<Map<number, DriveFile[]>>(new Map());
  /* Reactive version of the cache: background indexing fills fileCache
     without touching `files`, and "recent/all" (which read fileCache) need
     to know when it changes to recompute themselves (bug: empty recents
     until opening a folder). */
  const [cacheVersion, setCacheVersion] = useState(0);
  const updateCache = (fn: () => void) => {
    fn();
    setCacheVersion((v) => v + 1);
  };
  const activeTopicIdRef = useRef<number | null>(null);
  const uploadQueue = useRef<(() => Promise<void>)[]>([]);
  const activeUploadCount = useRef<number>(0);
  const MAX_CONCURRENT_UPLOADS = 3;
  const processQueueRef = useRef<() => void>(() => {});

  const uploadAbortControllers = useRef<Map<string, AbortController>>(new Map());
  const downloadAbortControllers = useRef<Map<string, AbortController>>(new Map());
  const batchAbortController = useRef<AbortController | null>(null);

  /**
   * Load files from a given topic. Uses local cache if available.
   */
  const loadFiles = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      topicId: number,
      force = false
    ) => {
      activeTopicIdRef.current = topicId;
      if (!force && fileCache.current.has(topicId)) {
        setFiles(fileCache.current.get(topicId)!);
        return;
      }

      setLoadingFiles(true);
      try {
        if (!force) {
          const cached = await loadTopicFilesFromDB(topicId);
          if (cached && cached.length > 0) {
            updateCache(() => fileCache.current.set(topicId, cached));
            setFiles(cached);
            setLoadingFiles(false);
            return;
          }
        }
        await ensureConnected();
        const existing = force ? null : fileCache.current.get(topicId);
        const result = await listFilesInTopic(client, config, topicId, existing);
        updateCache(() => fileCache.current.set(topicId, result));
        void saveTopicFilesToDB(topicId, result);
        setFiles(result);
      } finally {
        setLoadingFiles(false);
      }
    },
    []
  );

  useEffect(() => {
    processQueueRef.current = () => {
      if (activeUploadCount.current >= MAX_CONCURRENT_UPLOADS || uploadQueue.current.length === 0) {
        return;
      }

      activeUploadCount.current++;
      const nextTask = uploadQueue.current.shift()!;
      void nextTask().finally(() => {
        activeUploadCount.current--;
        processQueueRef.current();
      });

      if (activeUploadCount.current < MAX_CONCURRENT_UPLOADS && uploadQueue.current.length > 0) {
        processQueueRef.current();
      }
    };
  }, []);

  /**
   * Upload a file to the specified topic.
   */
  const uploadFile = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      topicId: number,
      file: File
    ) => {
      const fileId = `${file.name}-${Date.now()}`;
      const controller = new AbortController();
      uploadAbortControllers.current.set(fileId, controller);

      setUploads((prev) => [
        ...prev,
        {
          fileId,
          fileName: file.name,
          totalChunks: Math.ceil(file.size / getUploadChunkSize(file.size)),
          uploadedChunks: 0,
          totalBytes: file.size,
          uploadedBytes: 0,
          status: "preparing",
        },
      ]);

      return new Promise<void>((resolve, reject) => {
        const task = async () => {
          try {
            await ensureConnected();
            await uploadFileLib(
              client,
              config,
              topicId,
              file,
              (progress) => {
                setUploads((prev) => {
                  const idx = prev.findIndex((u) => u.fileId === progress.fileId);
                  if (idx >= 0) {
                    const copy = [...prev];
                    copy[idx] = progress;
                    return copy;
                  }
                  return [...prev, progress];
                });
              },
              fileId,
              controller.signal
            );
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            uploadAbortControllers.current.delete(fileId);
            setTimeout(() => {
              setUploads((prev) => prev.filter((u) => u.status === "uploading" || u.status === "preparing"));
            }, 2000);

            if (!controller.signal.aborted) {
              updateCache(() => fileCache.current.delete(topicId));
              await loadFiles(client, config, topicId, true);
            }
          }
        };

        uploadQueue.current.push(task);
        processQueueRef.current();
      });
    },
    [loadFiles]
  );

  /**
   * Cancel an active file upload.
   */
  const cancelUpload = useCallback((fileId: string) => {
    const controller = uploadAbortControllers.current.get(fileId);
    if (controller) {
      controller.abort();
      uploadAbortControllers.current.delete(fileId);
      setUploads((prev) =>
        prev.map((u) =>
          u.fileId === fileId
            ? { ...u, status: "error" as const, error: "Upload cancelled" }
            : u
        )
      );
      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.fileId !== fileId));
      }, 2000);
    }
  }, []);

  /**
   * Download a file by streaming its chunks.
   */
  const downloadFile = useCallback(
    async (client: TelegramClient, config: DriveConfig, file: DriveFile) => {
      downloadAbortControllers.current.forEach((controller) => controller.abort());
      downloadAbortControllers.current.clear();
      const controller = new AbortController();
      const downloadId = `${file.id}-${Date.now()}`;
      downloadAbortControllers.current.set(downloadId, controller);
      const startedAt = performance.now();

      setDownloadProgress({
        name: file.name,
        progress: 0,
        downloadedBytes: 0,
        totalBytes: file.size,
        speedBps: 0,
      });
      try {
        await ensureConnected();
        await downloadFileLib(
          client,
          config,
          file.manifest,
          (downloaded, total) => {
            const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
            setDownloadProgress({
              name: file.name,
              progress: total > 0 ? Math.round((downloaded / total) * 100) : 0,
              downloadedBytes: downloaded,
              totalBytes: total,
              speedBps: downloaded / elapsedSeconds,
            });
          },
          controller.signal
        );
      } catch (err) {
        console.error("Download failed:", err);
      } finally {
        downloadAbortControllers.current.delete(downloadId);
        setDownloadProgress(null);
      }
    },
    []
  );

  const downloadFilesBatch = useCallback(
    async (client: TelegramClient, config: DriveConfig, filesToDownload: DriveFile[]) => {
      if (filesToDownload.length === 0) return;

      if (batchAbortController.current) {
        batchAbortController.current.abort();
      }
      const masterController = new AbortController();
      batchAbortController.current = masterController;
      const signal = masterController.signal;

      downloadAbortControllers.current.forEach((controller) => controller.abort());
      downloadAbortControllers.current.clear();

      const totalBytes = filesToDownload.reduce((sum, file) => sum + file.size, 0);
      const downloadedById = new Map<number, number>();
      const startedAt = performance.now();
      const label = `${filesToDownload.length} files`;

      const emitProgress = () => {
        const downloadedBytes = Array.from(downloadedById.values()).reduce((sum, bytes) => sum + bytes, 0);
        const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
        setDownloadProgress({
          name: label,
          progress: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
          downloadedBytes,
          totalBytes,
          speedBps: downloadedBytes / elapsedSeconds,
        });
      };

      setDownloadProgress({
        name: label,
        progress: 0,
        downloadedBytes: 0,
        totalBytes,
        speedBps: 0,
      });

      const tasks = filesToDownload.map((file) => async () => {
        if (signal.aborted) return;
        const downloadId = `${file.id}-${Date.now()}`;
        const controller = new AbortController();
        downloadAbortControllers.current.set(downloadId, controller);
        const onMasterAbort = () => controller.abort();
        signal.addEventListener("abort", onMasterAbort);

        try {
          await ensureConnected();
          await downloadFileLib(
            client,
            config,
            file.manifest,
            (downloaded) => {
              downloadedById.set(file.id, downloaded);
              emitProgress();
            },
            controller.signal
          );
        } catch (err) {
          console.error(`Download failed for ${file.name}:`, err);
        } finally {
          signal.removeEventListener("abort", onMasterAbort);
          downloadAbortControllers.current.delete(downloadId);
        }
      });

      let abortPromise: Promise<never> | null = null;
      let abortHandler: (() => void) | null = null;
      abortPromise = new Promise((_, reject) => {
        abortHandler = () => reject(new DOMException("Download aborted", "AbortError"));
        signal.addEventListener("abort", abortHandler);
      });

      try {
        const batchPromise = runWithConcurrency(tasks, 3);
        await Promise.race([batchPromise, abortPromise]);
      } catch (err) {
        console.warn("Batch download aborted:", err);
      } finally {
        if (abortHandler) signal.removeEventListener("abort", abortHandler);
        setDownloadProgress(null);
        batchAbortController.current = null;
      }
    },
    []
  );

  const cancelDownload = useCallback(() => {
    if (batchAbortController.current) {
      batchAbortController.current.abort();
    }
    downloadAbortControllers.current.forEach((controller) => controller.abort());
    downloadAbortControllers.current.clear();
    setDownloadProgress(null);
  }, []);

  const deleteFile = useCallback(
    async (client: TelegramClient, config: DriveConfig, file: DriveFile) => {
      await ensureConnected();
      const ok = await deleteDriveFile(client, config, file);
      if (!ok) return false;
      updateCache(() => fileCache.current.delete(file.topicId));
      const sourceDbFiles = await loadTopicFilesFromDB(file.topicId);
      if (sourceDbFiles) {
        const updatedSource = sourceDbFiles.filter((item) => item.id !== file.id);
        await saveTopicFilesToDB(file.topicId, updatedSource);
        updateCache(() => fileCache.current.set(file.topicId, updatedSource));
      } else {
        await deleteTopicFilesFromDB(file.topicId);
      }
      setFiles((prev) => prev.filter((item) => item.id !== file.id));
      return true;
    },
    []
  );

  const renameFile = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      file: DriveFile,
      name: string
    ) => {
      const nextName = normalizeRenamedFileName(file, name);
      if (!nextName) return false;
      await ensureConnected();
      const ok = await renameDriveFile(client, config, file, nextName);
      if (!ok) return false;
      const renamed = {
        ...file,
        name: nextName,
        manifest: { ...file.manifest, fileName: nextName },
      };
      setFiles((prev) =>
        prev.map((item) => (item.id === file.id ? renamed : item))
      );
      const cached = fileCache.current.get(file.topicId);
      if (cached) {
        updateCache(() =>
          fileCache.current.set(
            file.topicId,
            cached.map((item) => (item.id === file.id ? renamed : item))
          )
        );
      }
      const sourceDbFiles = await loadTopicFilesFromDB(file.topicId);
      if (sourceDbFiles) {
        const updatedSource = sourceDbFiles.map((item) => (item.id === file.id ? renamed : item));
        await saveTopicFilesToDB(file.topicId, updatedSource);
      }
      return true;
    },
    []
  );

  const duplicateFilePayloadAndThumb = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      file: DriveFile,
      targetFolderId: number
    ): Promise<{ newChunkIds: number[]; newThumbId?: number }> => {
      const chatIdNumber = Number(config.chatId);

      const hasThumb = typeof file.manifest.thumb === "number";
      const allIdsToForward = [
        ...(hasThumb ? [file.manifest.thumb!] : []),
        ...file.manifest.chunks,
      ];

      const forwardedMap = new Map<number, number>();
      const BATCH_SIZE = 100;

      for (let i = 0; i < allIdsToForward.length; i += BATCH_SIZE) {
        const slice = allIdsToForward.slice(i, i + BATCH_SIZE);
        try {
          const forwardedMsgs = await client.forwardMessagesById({
            fromChatId: chatIdNumber,
            toChatId: chatIdNumber,
            messages: slice,
            toThreadId: targetFolderId > 0 ? targetFolderId : undefined,
            noAuthor: true,
          });

          if (forwardedMsgs && forwardedMsgs.length === slice.length) {
            slice.forEach((oldId, idx) => {
              forwardedMap.set(oldId, forwardedMsgs[idx].id);
            });
          } else {
            console.warn("Extracted forwarded ID count mismatch, falling back to original IDs for slice");
            slice.forEach((oldId) => forwardedMap.set(oldId, oldId));
          }
        } catch (err) {
          console.warn("Failed to forward chunk/thumb messages, using original IDs as fallback:", err);
          slice.forEach((oldId) => forwardedMap.set(oldId, oldId));
        }
      }

      const newThumbId = hasThumb ? forwardedMap.get(file.manifest.thumb!) : undefined;
      const newChunkIds = file.manifest.chunks.map(
        (oldId) => forwardedMap.get(oldId) ?? oldId
      );

      return { newChunkIds, newThumbId };
    },
    []
  );

  const moveFile = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      file: DriveFile,
      targetFolderId: number
    ) => {
      if (file.topicId === targetFolderId) return true;
      await ensureConnected();

      const chatIdNumber = Number(config.chatId);

      const { newChunkIds, newThumbId } = await duplicateFilePayloadAndThumb(
        client,
        config,
        file,
        targetFolderId
      );

      const isPayloadDuplicated = newChunkIds.some(
        (id, idx) => id !== file.manifest.chunks[idx]
      );

      try {
        const idsToDelete = [
          file.id,
          ...(isPayloadDuplicated
            ? [
                ...(file.manifest.thumb ? [file.manifest.thumb] : []),
                ...file.manifest.chunks,
              ]
            : []),
        ];
        await client.deleteMessagesById(chatIdNumber, idsToDelete);
      } catch (err) {
        console.warn("Failed to delete old messages during move:", err);
      }

      const newManifest = {
        ...file.manifest,
        chunks: newChunkIds,
        ...(newThumbId !== undefined ? { thumb: newThumbId } : {}),
      };

      const manifestStr = JSON.stringify(newManifest);
      const resMsg = await client.sendText(chatIdNumber, manifestStr, {
        replyTo: targetFolderId > 0 ? targetFolderId : undefined,
      });

      const movedFile: DriveFile = {
        ...file,
        id: resMsg.id,
        topicId: targetFolderId,
        manifest: newManifest,
      };

      updateCache(() => {
        fileCache.current.delete(file.topicId);
        fileCache.current.delete(targetFolderId);
      });

      const sourceDbFiles = await loadTopicFilesFromDB(file.topicId);
      if (sourceDbFiles) {
        const updatedSource = sourceDbFiles.filter((f) => f.id !== file.id);
        await saveTopicFilesToDB(file.topicId, updatedSource);
        updateCache(() => fileCache.current.set(file.topicId, updatedSource));
      } else {
        await deleteTopicFilesFromDB(file.topicId);
      }

      const targetDbFiles = await loadTopicFilesFromDB(targetFolderId);
      if (targetDbFiles) {
        const updatedTarget = [movedFile, ...targetDbFiles.filter((f) => f.id !== movedFile.id)];
        await saveTopicFilesToDB(targetFolderId, updatedTarget);
        updateCache(() => fileCache.current.set(targetFolderId, updatedTarget));
      } else {
        await deleteTopicFilesFromDB(targetFolderId);
      }

      setFiles((prev) =>
        prev
          .map((f) => (f.id === file.id ? movedFile : f))
          .filter((f) => f.topicId !== file.topicId || f.id === movedFile.id)
      );

      return true;
    },
    [duplicateFilePayloadAndThumb]
  );

  const copyFile = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      file: DriveFile,
      targetFolderId: number
    ) => {
      await ensureConnected();

      const chatIdNumber = Number(config.chatId);

      const { newChunkIds, newThumbId } = await duplicateFilePayloadAndThumb(
        client,
        config,
        file,
        targetFolderId
      );

      const newManifest = {
        ...file.manifest,
        chunks: newChunkIds,
        ...(newThumbId !== undefined ? { thumb: newThumbId } : {}),
      };

      const manifestStr = JSON.stringify(newManifest);
      const resMsg = await client.sendText(chatIdNumber, manifestStr, {
        replyTo: targetFolderId > 0 ? targetFolderId : undefined,
      });

      const copiedFile: DriveFile = {
        ...file,
        id: resMsg.id,
        topicId: targetFolderId,
        manifest: newManifest,
      };

      updateCache(() => fileCache.current.delete(targetFolderId));

      const targetDbFiles = await loadTopicFilesFromDB(targetFolderId);
      if (targetDbFiles) {
        const updatedTarget = [copiedFile, ...targetDbFiles.filter((f) => f.id !== copiedFile.id)];
        await saveTopicFilesToDB(targetFolderId, updatedTarget);
        updateCache(() => fileCache.current.set(targetFolderId, updatedTarget));
      } else {
        await deleteTopicFilesFromDB(targetFolderId);
      }

      setFiles((prev) => [copiedFile, ...prev]);

      return true;
    },
    [duplicateFilePayloadAndThumb]
  );

  const moveFilesBatch = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      filesToMove: DriveFile[],
      targetFolderId: number
    ) => {
      for (const file of filesToMove) {
        await moveFile(client, config, file, targetFolderId);
      }
      return true;
    },
    [moveFile]
  );

  const copyFilesBatch = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      filesToCopy: DriveFile[],
      targetFolderId: number
    ) => {
      for (const file of filesToCopy) {
        await copyFile(client, config, file, targetFolderId);
      }
      return true;
    },
    [copyFile]
  );

  const clearFinishedUploads = useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.status !== "done"));
  }, []);

  const filterFiles = useCallback(
    (query: string) => {
      if (!query.trim()) return files;
      const q = query.toLowerCase();
      return files.filter((f) => f.name.toLowerCase().includes(q));
    },
    [files]
  );

  const indexAllFolders = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      folders: { id: number; title: string }[]
    ) => {
      if (indexingRef.current) return;
      indexingRef.current = true;
      setIndexing(true);
      setIndexingProgress({ current: 0, total: folders.length });

      for (const folder of folders) {
        if (!fileCache.current.has(folder.id)) {
          const dbFiles = await loadTopicFilesFromDB(folder.id);
          if (dbFiles) {
            updateCache(() => fileCache.current.set(folder.id, dbFiles));
          }
        }
      }

      // IndexedDB is a fast startup snapshot, not the source of truth.  In
      // particular, older versions could persist a partial topic scan and
      // then never ask Telegram for that topic again.
      const pending = [...folders];
      const attempts = new Map<number, number>();
      let completed = 0;
      setIndexingProgress({ current: completed, total: folders.length });

      const CONCURRENCY = 1;
      const worker = async () => {
        while (pending.length > 0) {
          const folder = pending.shift();
          if (!folder) break;
          try {
            await ensureConnected();
            const existing = fileCache.current.get(folder.id);
            const result = await listFilesInTopic(client, config, folder.id, existing);
            updateCache(() => fileCache.current.set(folder.id, result));
            void saveTopicFilesToDB(folder.id, result);
            if (activeTopicIdRef.current === folder.id) {
              setFiles(result);
            }
            completed++;
            setIndexingProgress({ current: completed, total: folders.length });
            await new Promise((resolve) => setTimeout(resolve, 150));
          } catch (err) {
            const attempt = (attempts.get(folder.id) || 0) + 1;
            attempts.set(folder.id, attempt);
            if (attempt <= 5) {
              pending.push(folder);
            } else {
              console.error(`Skipping folder ${folder.title} after 5 failed attempts:`, err);
              completed++;
              setIndexingProgress({ current: completed, total: folders.length });
              continue;
            }

            const errorText = err instanceof Error ? err.message : String(err);
            const floodMatch = errorText.match(/FLOOD_WAIT_(\d+)/);
            // Telegram provides the precise cooldown. Retrying early creates a
            // new flood wait and prevents the folder from ever finishing.
            const retryMs = floodMatch
              ? (Number(floodMatch[1]) + 1) * 1_000
              : Math.min(30_000, 1_000 * 2 ** Math.min(attempt, 5));
            console.error(
              `Failed to index folder ${folder.title}; retrying in ${Math.ceil(retryMs / 1000)}s (attempt ${attempt}).`,
              err
            );
            await new Promise((resolve) => setTimeout(resolve, retryMs));
          }
        }
      };

      const workerCount = Math.min(CONCURRENCY, folders.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      setIndexing(false);
      indexingRef.current = false;
    },
    []
  );

  const getRecentFiles = useCallback((limit = 6) => {
    const all: DriveFile[] = [];
    fileCache.current.forEach((folderFiles) => {
      all.push(...folderFiles);
    });
    return all.sort((a, b) => b.date - a.date).slice(0, limit);
  }, []);

  const getAllFiles = useCallback(() => {
    const all: DriveFile[] = [];
    fileCache.current.forEach((folderFiles) => {
      all.push(...folderFiles);
    });
    return all;
  }, []);

  const deleteFilesBatch = useCallback(
    async (client: TelegramClient, config: DriveConfig, filesToDelete: DriveFile[]) => {
      if (filesToDelete.length === 0) return true;

      const topicIds = new Set(filesToDelete.map((f) => f.topicId));
      let allSuccess = true;

      for (const file of filesToDelete) {
        try {
          const ok = await deleteDriveFile(client, config, file);
          if (!ok) allSuccess = false;
        } catch (err) {
          console.error(`Failed to delete file ${file.name}:`, err);
          allSuccess = false;
        }
      }

      const toDeleteIds = new Set(filesToDelete.map((f) => f.id));

      for (const topicId of topicIds) {
        updateCache(() => fileCache.current.delete(topicId));
        const sourceDbFiles = await loadTopicFilesFromDB(topicId);
        if (sourceDbFiles) {
          const updatedSource = sourceDbFiles.filter((item) => !toDeleteIds.has(item.id));
          await saveTopicFilesToDB(topicId, updatedSource);
          updateCache(() => fileCache.current.set(topicId, updatedSource));
        } else {
          await deleteTopicFilesFromDB(topicId);
        }
      }

      setFiles((prev) => {
        return prev.filter((item) => !toDeleteIds.has(item.id));
      });

      return allSuccess;
    },
    []
  );

  const loadFavourites = useCallback(
    async (client: TelegramClient, config: DriveConfig, favFolderId: number) => {
      await ensureConnected();
      const result = await listFilesInTopic(client, config, favFolderId);
      updateCache(() => fileCache.current.set(favFolderId, result));
      setFavouriteFiles(result);
      return result;
    },
    []
  );

  const toggleFavourite = useCallback(
    async (client: TelegramClient, config: DriveConfig, file: DriveFile, favFolderId: number) => {
      const chatIdNumber = Number(config.chatId);
      const existing = favouriteFiles.find(
        (f) =>
          f.name === file.name &&
          f.size === file.size &&
          f.manifest.chunks.join(",") === file.manifest.chunks.join(",")
      );

      if (existing) {
        await client.deleteMessagesById(chatIdNumber, [existing.id]);
        
        const nextFavs = favouriteFiles.filter((f) => f.id !== existing.id);
        setFavouriteFiles(nextFavs);
        updateCache(() => fileCache.current.set(favFolderId, nextFavs));
        
        setFiles((prev) => prev.filter((f) => f.id !== existing.id));
      } else {
        const manifestStr = JSON.stringify(file.manifest);
        const resMsg = await client.sendText(chatIdNumber, manifestStr, {
          replyTo: favFolderId,
        });
        const newFav: DriveFile = {
          ...file,
          id: resMsg.id,
          topicId: favFolderId,
        };
        const nextFavs = [...favouriteFiles, newFav];
        setFavouriteFiles(nextFavs);
        updateCache(() => fileCache.current.set(favFolderId, nextFavs));
        
        setFiles((prev) => {
          if (prev.length > 0 && prev[0].topicId === favFolderId) {
            return nextFavs;
          }
          return prev;
        });
      }
    },
    [favouriteFiles]
  );

  return {
    favouriteFiles,
    loadFavourites,
    toggleFavourite,
    files,
    loadingFiles,
    uploads,
    downloadProgress,
    loadFiles,
    uploadFile,
    downloadFile,
    downloadFilesBatch,
    cancelUpload,
    cancelDownload,
    deleteFile,
    renameFile,
    clearFinishedUploads,
    filterFiles,
    indexing,
    indexingProgress,
    indexAllFolders,
    cacheVersion,
    getRecentFiles,
    getAllFiles,
    deleteFilesBatch,
    moveFile,
    copyFile,
    moveFilesBatch,
    copyFilesBatch,
  };
}
