import { useEffect, useState, useCallback, useRef, useMemo, memo } from "react";
import { useAuth } from "./hooks/useAuth";
import { useDrive } from "./hooks/useDrive";
import { useFiles } from "./hooks/useFiles";
import { AuthWizard } from "./components/auth/AuthWizard";
import { Dashboard } from "./components/drive/Dashboard";
/* The Dashboard must NOT re-render while the preview navigates with swipe:
   App changes 3 states per photo and without memo the whole file tree gets
   reconciled DURING the landing animation → blocked UI thread, high input
   latency and gesture jank (the frames confirmed it).
   Google style: the viewer is independent of the UI behind it. */
const MemoDashboard = memo(Dashboard);
import { LoadingScreen } from "./components/layout/LoadingScreen";
import { PreviewModal } from "./components/drive/PreviewModal";
import { handleStreamRequest, normalizeRenamedFileName, downloadFileToMemory, mimeTypeFromName, preFetchMessages } from "./lib/downloader";

import { findAdjacentPreviewable, getPreviewKind } from "./lib/manifest";

import { useTheme } from "./hooks/useTheme";
import { useSafeInsets } from "./hooks/useSafeInsets";
import type { DriveFile, TopicFolder } from "./types";
import { Modal } from "./components/ui/Modal";
import { ShareModal } from "./components/drive/ShareModal";
import { ReceiveShareModal } from "./components/drive/ReceiveShareModal";
import { MoveCopyModal } from "./components/drive/MoveCopyModal";
import { RenameModal } from "./components/drive/RenameModal";
import { ensureBotIsAdmin, DEFAULT_WORKER_URL, BOT_USERNAME } from "./lib/bot";

import { clearPersistentCache } from "./lib/cache";
import { clearThumbCacheDB } from "./lib/db";

import { openExternalUrl, isNativePlatform } from "./lib/native";
import { performBack, handleWebPopState } from "./lib/back";
const MB = 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 80 * MB;
const MAX_OFFICE_PREVIEW_BYTES = 25 * MB;
const MAX_MEMORY_PREVIEW_BYTES = 100 * MB;

function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

async function ensureStreamWorkerReady() {
  if (!("serviceWorker" in navigator)) return false;

  try {
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      registration = await navigator.serviceWorker.register("/sw.js");
    }

    await navigator.serviceWorker.ready;
    if (registration.active) {
      try {
        registration.active.postMessage("CLAIM");
      } catch (_) {}
    }

    if (navigator.serviceWorker.controller) return true;

    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 1000);
      const handleControllerChange = () => {
        window.clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
        resolve();
      };
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    });

    return Boolean(navigator.serviceWorker.controller);
  } catch (err) {
    console.warn("Stream service worker is not ready:", err);
    return false;
  }
}

let streamReadyPromise: Promise<boolean> | null = null;
function getStreamReady() {
  if (!streamReadyPromise) streamReadyPromise = ensureStreamWorkerReady();
  return streamReadyPromise;
}

export default function App() {
  useSafeInsets();
  const { theme, setTheme } = useTheme();
  const {
    authState,
    connected,
    client,
    userProfile,
    accounts,
    activeAccountId,
    tryAutoConnect,
    goToPhone,
    goToCredentials,
    startAuth,
    submitOtp,
    submitPassword,
    beginAddAccount,
    switchAccount,
    removeAccount,
    logout,
    clearCache,
  } = useAuth();

  const {
    driveConfig,
    topics,
    syncing,
    syncStatus,
    initDrive,
    addFolder,
    removeFolder,
    renameFolder,
    filterTopics,
    resetDrive,
  } = useDrive();

  const {
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
    filterFiles,
    indexing,
    indexingProgress,
    indexAllFolders,
    getRecentFiles,
    getAllFiles,
    deleteFilesBatch,
    moveFilesBatch,
    copyFilesBatch,
    favouriteFiles,
    loadFavourites,
    toggleFavourite,
    cacheVersion,
  } = useFiles();

  const [booting, setBooting] = useState(true);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [refreshingFiles, setRefreshingFiles] = useState(false);

  /* Derived arrays with stable identity (they depend only on `files`):
     without this the memoized Dashboard would re-render anyway, since it
     would receive new arrays on every App render (e.g. when navigating the
     preview with swipe → reconciliation of the tree behind the viewer).
     `cacheVersion` recomputes them when background indexing fills fileCache
     without touching `files` (recents when opening the app without entering
     any folder). */
  const allFilesMemo = useMemo(() => getAllFiles(), [getAllFiles, files, cacheVersion]);
  const recentFilesMemo = useMemo(() => getRecentFiles(6), [getRecentFiles, files, cacheVersion]);
  
  // Preview state
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
  const [previewList, setPreviewList] = useState<DriveFile[]>([]);
  const [previewNavDir, setPreviewNavDir] = useState<"left" | "right" | null>(null);
  const [previewFromSwipe, setPreviewFromSwipe] = useState(false);
  const [previewMoveCopyFile, setPreviewMoveCopyFile] = useState<DriveFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewFileRef = useRef<DriveFile | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewRequestId = useRef(0);
  const previewAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    previewFileRef.current = previewFile;
  }, [previewFile]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  const revokePreviewBlobUrl = useCallback(() => {
    if (previewUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = null;
  }, []);

  // Toast & Custom Confirm modal states
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: "success" | "error" | "info";
  }>({ show: false, message: "", type: "info" });
  const toastTimeoutRef = useRef<number | null>(null);

  const triggerToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ show: true, message, type });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast((t) => ({ ...t, show: false }));
    }, 4000);
  }, []);

  // File sharing states
  const [fileSharingEnabled, setFileSharingEnabled] = useState<boolean>(() => {
    return localStorage.getItem("tg_file_sharing_enabled") === "true";
  });
  const [workerUrl, setWorkerUrl] = useState<string>(() => {
    return localStorage.getItem("tg_worker_url") || DEFAULT_WORKER_URL;
  });
  const [sharingFile, setSharingFile] = useState<DriveFile | null>(null);
  const [receiveShareOpen, setReceiveShareOpen] = useState(false);
  const [receiveShareHash, setReceiveShareHash] = useState("");

  /* Stable: the Dashboard is memoized and must not re-render when App
     changes only because of the preview (photo navigation with swipe). */
  const handleOpenShare = useCallback((file: DriveFile) => {
    setSharingFile(file);
  }, []);
  const handleOpenReceiveShare = useCallback((hash?: string) => {
    setReceiveShareHash(hash || "");
    setReceiveShareOpen(true);
  }, []);
  const [renameTarget, setRenameTarget] = useState<{
    type: "file" | "folder";
    file?: DriveFile;
    folder?: TopicFolder;
  } | null>(null);

  // Check URL share query param on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareParam = params.get("share");
    if (shareParam) {
      setReceiveShareHash(shareParam);
      setReceiveShareOpen(true);
    }
  }, []);

  // ─── Back navigation (hardware button / system gesture) ───
  // Native: @capacitor/app intercepts the back button/gesture; if no layer
  // handled it (nothing open), minimize the app like Android would.
  // Web: open layers are mirrored into history, so browser back/gesture
  // closes them step by step instead of leaving the page.
  useEffect(() => {
    if (!isNativePlatform()) {
      const onPop = () => handleWebPopState();
      window.addEventListener("popstate", onPop);
      return () => window.removeEventListener("popstate", onPop);
    }
    let removeListener: (() => void) | null = null;
    import("@capacitor/app")
      .then(async ({ App }) => {
        const handle = await App.addListener("backButton", () => {
          if (!performBack()) {
            App.minimizeApp().catch(() => {});
          }
        });
        removeListener = () => handle.remove();
        // Deep links (App Links): the app opens with a URL
        // https://clashdrive.pages.dev/?share=... → redeem the share.
        App.addListener("appUrlOpen", (data) => {
          try {
            const url = new URL(data.url);
            const shareParam = url.searchParams.get("share");
            if (shareParam) {
              setReceiveShareHash(shareParam);
              setReceiveShareOpen(true);
            }
          } catch (err) {
            console.warn("[deep-link] invalid URL:", data.url, err);
          }
        }).catch((err) => console.warn("[deep-link] appUrlOpen unavailable", err));
      })
      .catch((err) => console.warn("[back] @capacitor/app unavailable", err));
    return () => {
      if (removeListener) removeListener();
    };
  }, []);

  const handleToggleFileSharing = async () => {
    const nextState = !fileSharingEnabled;
    setFileSharingEnabled(nextState);
    localStorage.setItem("tg_file_sharing_enabled", String(nextState));

    if (nextState) {
      if (client && driveConfig) {
        triggerToast(`Checking @${BOT_USERNAME} admin permissions...`, "info");
        const status = await ensureBotIsAdmin(client, driveConfig);
        if (status.success) {
          triggerToast(status.message, "success");
        } else {
          triggerToast(status.message, "error");
        }
      } else {
        triggerToast("File sharing enabled. Bot will be auto-invited once connected.", "info");
      }
    } else {
      triggerToast("File sharing disabled.", "info");
    }
  };

  const handleUpdateWorkerUrl = (url: string) => {
    setWorkerUrl(url);
    localStorage.setItem("tg_worker_url", url);
    triggerToast("Worker URL updated successfully", "success");
  };

  const [confirmState, setConfirmState] = useState<{
    show: boolean;
    title: string;
    message: string;
    danger?: boolean;
    onConfirm: () => void | Promise<void>;
  }>({
    show: false,
    title: "",
    message: "",
    danger: false,
    onConfirm: () => {},
  });

  const triggerConfirm = useCallback((title: string, message: string, onConfirm: () => void | Promise<void>, danger = false) => {
    setConfirmState({
      show: true,
      title,
      message,
      danger,
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, show: false }));
        await onConfirm();
      },
    });
  }, []);

  const [showJoinPrompt, setShowJoinPrompt] = useState(false);
  const [joiningChannel, setJoiningChannel] = useState(false);

  // Auto-prompt join updates channel if first time login
  useEffect(() => {
    if (connected && userProfile?.id) {
      const prompted = localStorage.getItem(`tgcd_prompted_join_${userProfile.id}`);
      if (prompted !== "true") {
        setShowJoinPrompt(true);
      }
    }
  }, [connected, userProfile]);

  const handleJoinUpdateChannel = useCallback(async () => {
    if (!client || !userProfile?.id) return;
    setJoiningChannel(true);
    try {
      await client.joinChat("clashgramclient");
      triggerToast("Successfully joined Clashgram Update Channel! Thank you for your support.", "success");
    } catch (err) {
      console.warn("Failed to join channel automatically:", err);
      triggerToast("Auto-join failed. Opening updates channel page...", "info");
      // Fallback: open link externally (system browser on native)
      openExternalUrl("https://t.me/clashgramclient");
    } finally {
      localStorage.setItem(`tgcd_prompted_join_${userProfile.id}`, "true");
      setJoiningChannel(false);
      setShowJoinPrompt(false);
    }
  }, [client, userProfile, triggerToast]);

  const handleClearCache = useCallback(() => {
    triggerConfirm(
      "Clear Cache & Reset All Sessions",
      "This will erase all cached data, stored account credentials, sessions, and log out completely. Proceed?",
      async () => {
        await clearCache();
        await clearPersistentCache();
        await clearThumbCacheDB();
        resetDrive();
        triggerToast("Cache and stored sessions cleared completely.", "success");
      }
    );
  }, [clearCache, resetDrive, triggerConfirm, triggerToast]);

  const handleSkipJoinChannel = useCallback(() => {
    if (userProfile?.id) {
      localStorage.setItem(`tgcd_prompted_join_${userProfile.id}`, "true");
    }
    setShowJoinPrompt(false);
  }, [userProfile]);

  // Auto-connect and register stream worker on mount
  useEffect(() => {
    (async () => {
      getStreamReady().catch(() => {});
      await tryAutoConnect();
      setBooting(false);
    })();
  }, [tryAutoConnect]);

  // Load Favourite folder files on setup to sync star states
  useEffect(() => {
    if (client && driveConfig && topics.length > 0) {
      const favFolder = topics.find(
        (t) => t.title.toLowerCase() === "favourite" || t.title.toLowerCase() === "favorite"
      );
      if (favFolder) {
        loadFavourites(client, driveConfig, favFolder.id).catch((err) => {
          console.warn("Failed to load favourites on startup:", err);
        });
      }
    }
  }, [client, driveConfig, topics, loadFavourites]);

  const favouriteChunks = useMemo(() => {
    return new Set(favouriteFiles.map((f) => f.manifest.chunks.join(",")));
  }, [favouriteFiles]);

  const handleToggleLike = useCallback(
    async (file: DriveFile) => {
      if (!client || !driveConfig) return;
      const favFolder = topics.find(
        (t) => t.title.toLowerCase() === "favourite" || t.title.toLowerCase() === "favorite"
      );
      if (!favFolder) {
        triggerToast("Favourite folder not initialized. Please wait or refresh.", "error");
        return;
      }
      try {
        await toggleFavourite(client, driveConfig, file, favFolder.id);
      } catch (err) {
        console.error("Failed to toggle favourite state:", err);
        triggerToast("Failed to update Favourite status.", "error");
      }
    },
    [client, driveConfig, topics, toggleFavourite, triggerToast]
  );

  // Handle Service Worker streaming requests
  useEffect(() => {
    if (!client || !driveConfig) return;

    const handler = (event: MessageEvent) => {
      const currentPreviewFile = previewFileRef.current;
      const streamFiles = [
        ...(currentPreviewFile ? [currentPreviewFile] : []),
        ...files,
        ...getAllFiles(),
      ];
      handleStreamRequest(client, driveConfig, event, streamFiles);
    };

    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, [client, driveConfig, files, getAllFiles]);

  // Once connected, kick off the radar scan
  useEffect(() => {
    if (connected && client && !driveConfig && !syncing) {
      initDrive(client);
    }
  }, [connected, client, driveConfig, syncing, initDrive]);

  // Index all folders in the background when the drive is loaded
  useEffect(() => {
    if (client && driveConfig && topics.length > 0 && !indexing) {
      indexAllFolders(client, driveConfig, topics);
    }
  }, [client, driveConfig, topics, indexAllFolders]);

  // Pull-to-refresh: reloads the active folder from Telegram and reindexes
  // everything in the background (equivalent to refreshing a web page).
  const handleRefreshFiles = useCallback(async () => {
    if (!client || !driveConfig || refreshingFiles) return;
    setRefreshingFiles(true);
    try {
      if (activeFolderId !== null) {
        await loadFiles(client, driveConfig, activeFolderId, true);
      }
      if (topics.length > 0 && !indexing) {
        await indexAllFolders(client, driveConfig, topics);
      }
    } catch {
      // Network errors are transient; refresh leaves the current view intact.
    } finally {
      setRefreshingFiles(false);
    }
  }, [client, driveConfig, activeFolderId, loadFiles, indexAllFolders, topics, indexing, refreshingFiles]);

  // Auto-kick legacy bot and promote primary worker bot to admin on login
  const botCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (client && driveConfig?.chatId) {
      const key = `${driveConfig.chatId}`;
      if (botCheckedRef.current !== key) {
        botCheckedRef.current = key;
        ensureBotIsAdmin(client, driveConfig).catch((err) => {
          console.warn("[bot] Auto setup error:", err);
        });
      }
    }
  }, [client, driveConfig]);

  // When user navigates into a folder, load its files
  useEffect(() => {
    if (client && driveConfig && activeFolderId !== null) {
      loadFiles(client, driveConfig, activeFolderId);
    }
  }, [client, driveConfig, activeFolderId, loadFiles]);

  const handleFolderClick = useCallback((id: number) => {
    setActiveFolderId(id);
  }, []);

  const handleBackToRoot = useCallback(() => {
    setActiveFolderId(null);
  }, []);

  const handleCreateFolder = useCallback(
    async (name: string) => {
      if (client) {
        await addFolder(client, name);
      }
    },
    [client, addFolder]
  );

  const handleDeleteFolder = useCallback(
    (id: number) => {
      if (client) {
        triggerConfirm(
          "Delete Folder",
          "Are you sure you want to delete this folder and all its contents? This will permanently remove the folder from your drive.",
          async () => {
            await removeFolder(client, id);
            if (activeFolderId === id) {
              setActiveFolderId(null);
            }
            triggerToast("Folder deleted successfully.", "success");
          },
          true
        );
      }
    },
    [client, removeFolder, activeFolderId, triggerConfirm, triggerToast]
  );

  const handleRenameFolder = useCallback((folder: TopicFolder) => {
    setRenameTarget({ type: "folder", folder });
  }, []);

  const handleFileDrop = useCallback(
    async (droppedFiles: File[]) => {
      if (!client || !driveConfig || activeFolderId === null) return;
      const results = await Promise.allSettled(
        droppedFiles.map((file) => uploadFile(client, driveConfig, activeFolderId, file))
      );

      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(`Failed to upload ${droppedFiles[index].name}:`, result.reason);
        }
      });
    },
    [client, driveConfig, activeFolderId, uploadFile]
  );

  const handleDownload = useCallback(
    async (file: DriveFile) => {
      if (!client || !driveConfig) return;
      await downloadFile(client, driveConfig, file);
    },
    [client, driveConfig, downloadFile]
  );

  const handleDeleteFile = useCallback(
    (file: DriveFile) => {
      if (!client || !driveConfig) return;
      triggerConfirm(
        "Delete File",
        `Are you sure you want to delete "${file.name}"? This removes the manifest and all associated file chunks from Telegram.`,
        async () => {
          await deleteFile(client, driveConfig, file);
          triggerToast("File deleted successfully.", "success");
        },
        true
      );
    },
    [client, driveConfig, deleteFile, triggerConfirm, triggerToast]
  );

  const handleRenameFile = useCallback((file: DriveFile) => {
    setRenameTarget({ type: "file", file });
  }, []);

  const handleConfirmRename = useCallback(
    async (newName: string) => {
      if (!renameTarget || !client) return;

      if (renameTarget.type === "folder" && renameTarget.folder) {
        await renameFolder(client, renameTarget.folder.id, newName);
      } else if (renameTarget.type === "file" && renameTarget.file && driveConfig) {
        const file = renameTarget.file;
        const nextName = normalizeRenamedFileName(file, newName);
        if (!nextName || nextName === file.name) return;

        await renameFile(client, driveConfig, file, nextName);
        if (previewFile?.id === file.id) {
          setPreviewFile({
            ...file,
            name: nextName,
            manifest: { ...file.manifest, fileName: nextName },
          });
        }
      }
    },
    [client, driveConfig, renameFolder, renameFile, renameTarget, previewFile]
  );

  const handleMoveFile = useCallback(
    async (filesToMove: DriveFile[], targetFolderId: number) => {
      if (!client || !driveConfig) return false;
      const ok = await moveFilesBatch(client, driveConfig, filesToMove, targetFolderId);
      if (ok) {
        const folder = topics.find((t) => t.id === targetFolderId);
        const folderName = folder ? folder.title : "folder";
        triggerToast(
          filesToMove.length === 1
            ? `Moved "${filesToMove[0].name}" to ${folderName}`
            : `Moved ${filesToMove.length} files to ${folderName}`,
          "success"
        );
      }
      return ok;
    },
    [client, driveConfig, moveFilesBatch, topics, triggerToast]
  );

  const handleCopyFile = useCallback(
    async (filesToCopy: DriveFile[], targetFolderId: number) => {
      if (!client || !driveConfig) return false;
      const ok = await copyFilesBatch(client, driveConfig, filesToCopy, targetFolderId);
      if (ok) {
        const folder = topics.find((t) => t.id === targetFolderId);
        const folderName = folder ? folder.title : "folder";
        triggerToast(
          filesToCopy.length === 1
            ? `Copied "${filesToCopy[0].name}" to ${folderName}`
            : `Copied ${filesToCopy.length} files to ${folderName}`,
          "success"
        );
      }
      return ok;
    },
    [client, driveConfig, copyFilesBatch, topics, triggerToast]
  );

  const handlePreview = useCallback(
    async (file: DriveFile, list?: DriveFile[]) => {
      if (!client || !driveConfig) return;

      if (previewAbortControllerRef.current) {
        previewAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      previewAbortControllerRef.current = controller;

      const requestId = previewRequestId.current + 1;
      previewRequestId.current = requestId;
      previewFileRef.current = file;

      revokePreviewBlobUrl();
      setPreviewList(list && list.length > 0 ? list : [file]);
      setPreviewFile(file);
      setPreviewUrl(null);
      setPreviewError(null);

      const previewKind = getPreviewKind(file);
      const isCurrentPreview = () =>
        previewRequestId.current === requestId && previewFileRef.current?.id === file.id;

      if (previewKind === "unsupported") {
        setPreviewProgress(null);
        setPreviewError("Preview is not available for this file type. Download it to open it locally.");
        return;
      }

      if (previewKind === "office" && file.size > MAX_OFFICE_PREVIEW_BYTES) {
        setPreviewProgress(null);
        setPreviewError("This document is too large for a reliable in-browser preview. Download it to open it locally.");
        return;
      }

      if (previewKind === "image" && file.size > MAX_IMAGE_PREVIEW_BYTES) {
        setPreviewProgress(null);
        setPreviewError("This image is too large for a safe in-browser preview. Download it to view the full file.");
        return;
      }

      if (previewKind === "stream" || previewKind === "image") {
        setPreviewProgress(null);
        try {
          const streamReady = await getStreamReady();
          if (!isCurrentPreview()) return;

          if (streamReady || file.size > 100 * MB) {
            preFetchMessages(client, driveConfig, file.manifest).catch((err) => {
              console.warn("Message prefetch failed; stream will fetch on demand:", err);
            });
            setPreviewUrl(`/stream/${file.id}`);
            return;
          }

          // Fallback if Service Worker is unavailable (e.g. initial load or SW disabled)
          console.warn("Service Worker not active, falling back to progressive memory stream.");
          setPreviewProgress(0);
          const blob = await downloadFileToMemory(client, driveConfig, file.manifest, (dl, total) => {
            if (isCurrentPreview()) {
              setPreviewProgress(total > 0 ? Math.round((dl / total) * 100) : 0);
            }
          }, controller.signal, file.id.toString());
          if (!isCurrentPreview()) return;
          const blobUrl = URL.createObjectURL(blob);
          previewUrlRef.current = blobUrl;
          setPreviewProgress(null);
          setPreviewUrl(blobUrl);
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
          console.error("Streaming preview failed:", err);
          if (isCurrentPreview()) {
            setPreviewProgress(null);
            setPreviewError(err instanceof Error ? err.message : "Could not open the streaming preview.");
          }
        }
        return;
      }

      const ext = fileExtension(file.name);
      const limit = ["dsf", "dff"].includes(ext) ? 800 * MB : MAX_MEMORY_PREVIEW_BYTES;
      if (file.size > limit) {
        setPreviewProgress(null);
        setPreviewError("This file is too large for a memory preview. Download it to open it locally.");
        return;
      }

      setPreviewProgress(0);
      try {
        const blob = await downloadFileToMemory(client, driveConfig, file.manifest, (downloaded, total) => {
          if (isCurrentPreview()) {
            setPreviewProgress(total > 0 ? Math.round((downloaded / total) * 100) : 0);
          }
        }, controller.signal, file.id.toString());
        if (!isCurrentPreview()) return;

        let mime = file.mimeType || mimeTypeFromName(file.name);
        if (mime === "application/octet-stream") {
          mime = mimeTypeFromName(file.name);
        }
        const typedBlob = new Blob([blob], { type: mime });
        const blobUrl = URL.createObjectURL(typedBlob);
        previewUrlRef.current = blobUrl;
        setPreviewUrl(blobUrl);
        setPreviewProgress(null);
      } catch (err) {
        console.error("Preview download failed:", err);
        if (isCurrentPreview()) {
          setPreviewProgress(null);
          setPreviewError(err instanceof Error ? err.message : "Preview download failed.");
        }
      } finally {
        if (previewAbortControllerRef.current === controller) {
          previewAbortControllerRef.current = null;
        }
      }
    },
    [client, driveConfig, revokePreviewBlobUrl]
  );

  const handlePreviewNavigate = useCallback(
    (dir: number, fromSwipe?: boolean) => {
      if (!previewFileRef.current || previewList.length <= 1) return;
      const next = findAdjacentPreviewable(previewList, previewFileRef.current.id, dir as 1 | -1);
      if (!next || next.id === previewFileRef.current.id) return;
      setPreviewNavDir(dir > 0 ? "right" : "left");
      setPreviewFromSwipe(!!fromSwipe);
      handlePreview(next as DriveFile, previewList);
    },
    [previewList, handlePreview]
  );

  const handleLogout = useCallback(async () => {
    await logout();
    setActiveFolderId(null);
    previewRequestId.current += 1;
    previewFileRef.current = null;
    revokePreviewBlobUrl();
    setPreviewFile(null);
    setPreviewUrl(null);
    setPreviewProgress(null);
    setPreviewError(null);
    resetDrive();
  }, [logout, resetDrive, revokePreviewBlobUrl]);

  const handleAddAccount = useCallback(async () => {
    await beginAddAccount();
    setActiveFolderId(null);
    previewRequestId.current += 1;
    previewFileRef.current = null;
    revokePreviewBlobUrl();
    setPreviewFile(null);
    setPreviewUrl(null);
    setPreviewProgress(null);
    setPreviewError(null);
    resetDrive();
  }, [beginAddAccount, resetDrive, revokePreviewBlobUrl]);

  const handleSwitchAccount = useCallback(
    async (userId: string) => {
      await switchAccount(userId);
      setActiveFolderId(null);
      previewRequestId.current += 1;
      previewFileRef.current = null;
      revokePreviewBlobUrl();
      setPreviewFile(null);
      setPreviewUrl(null);
      setPreviewProgress(null);
      setPreviewError(null);
      resetDrive();
    },
    [switchAccount, resetDrive, revokePreviewBlobUrl]
  );

  // Boot screen
  if (booting) {
    return (
      <LoadingScreen
        message="Clash Drive"
        subtext="Checking your session..."
      />
    );
  }

  // Not connected — show auth wizard
  if (!connected) {
    return (
      <AuthWizard
        state={authState}
        onPhoneSubmit={(phone) => startAuth(phone, authState.apiId ?? 0, authState.apiHash ?? "")}
        onCredentialsSubmit={goToPhone}
        onOtpSubmit={submitOtp}
        onPasswordSubmit={submitPassword}
        onBackToCredentials={goToCredentials}
        onBackToPhone={() => goToPhone(authState.apiId ?? 0, authState.apiHash ?? "")}
      />
    );
  }

  // Syncing drive
  if (syncing || !driveConfig) {
    return (
      <LoadingScreen
        message="Setting up your drive"
        subtext={syncStatus || "Connecting to Telegram network..."}
      />
    );
  }

  // Main dashboard
  return (
    <>
      <MemoDashboard
        client={client}
        driveConfig={driveConfig}
        topics={topics}
        files={files}
        loadingFiles={loadingFiles}
        uploads={uploads}
        downloadProgress={downloadProgress}
        onFolderClick={handleFolderClick}
        onBackToRoot={handleBackToRoot}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onFileDrop={handleFileDrop}
        onDownload={handleDownload}
        onDownloadFilesBatch={(filesToDownload) => downloadFilesBatch(client!, driveConfig!, filesToDownload)}
        onCancelUpload={cancelUpload}
        onCancelDownload={cancelDownload}
        onRenameFile={handleRenameFile}
        onDeleteFile={handleDeleteFile}
        onMoveFile={handleMoveFile}
        onCopyFile={handleCopyFile}
        onLogout={handleLogout}
        userProfile={userProfile}
        accounts={accounts}
        activeAccountId={activeAccountId}
        onAddAccount={handleAddAccount}
        onSwitchAccount={handleSwitchAccount}
        onRemoveAccount={removeAccount}
        activeFolderId={activeFolderId}
        filterTopics={filterTopics}
        filterFiles={filterFiles}
        onPreview={handlePreview}
        allFiles={allFilesMemo}
        recentFiles={recentFilesMemo}
        indexing={indexing}
        indexingProgress={indexingProgress}
        onDeleteFilesBatch={(filesToDel) => deleteFilesBatch(client!, driveConfig!, filesToDel)}
        theme={theme}
        setTheme={setTheme}
        onJoinUpdateChannel={handleJoinUpdateChannel}
        joiningChannel={joiningChannel}
        onClearCache={handleClearCache}
        triggerConfirm={triggerConfirm}
        triggerToast={triggerToast}
        onRefreshFiles={handleRefreshFiles}
        refreshingFiles={refreshingFiles}
        favouriteChunks={favouriteChunks}
        onToggleLike={handleToggleLike}
        onShare={handleOpenShare}
        fileSharingEnabled={fileSharingEnabled}
        onToggleFileSharing={handleToggleFileSharing}
        onOpenReceiveShare={handleOpenReceiveShare}
      />
    
    {previewFile && (
      <PreviewModal
        file={previewFile}
        client={client}
        driveConfig={driveConfig}
        url={previewUrl}
        progress={previewProgress}
        error={previewError}
        isLiked={favouriteChunks.has(previewFile.manifest.chunks.join(","))}
        onToggleLike={() => handleToggleLike(previewFile)}
        onOpenMoveCopy={() => setPreviewMoveCopyFile(previewFile)}
        onDownload={() => handleDownload(previewFile)}
        onNavigate={handlePreviewNavigate}
        navDir={previewNavDir}
        files={previewList}
        fromSwipe={previewFromSwipe}
        onClose={() => {
          if (previewAbortControllerRef.current) {
            previewAbortControllerRef.current.abort();
            previewAbortControllerRef.current = null;
          }
          previewRequestId.current += 1;
          previewFileRef.current = null;
          revokePreviewBlobUrl();
          setPreviewNavDir(null);
          setPreviewFromSwipe(false);
          setPreviewList([]);
          setPreviewFile(null);
          setPreviewUrl(null);
          setPreviewProgress(null);
          setPreviewError(null);
        }}
      />
    )}

    {previewMoveCopyFile && (
      <MoveCopyModal
        open={Boolean(previewMoveCopyFile)}
        onClose={() => setPreviewMoveCopyFile(null)}
        files={[previewMoveCopyFile]}
        folders={topics}
        onMove={async (targetFolderId) => {
          if (previewMoveCopyFile) {
            await handleMoveFile([previewMoveCopyFile], targetFolderId);
          }
        }}
        onCopy={async (targetFolderId) => {
          if (previewMoveCopyFile) {
            await handleCopyFile([previewMoveCopyFile], targetFolderId);
          }
        }}
      />
    )}

    {/* File Sharing Modals */}
    {sharingFile && (
      <ShareModal
        file={sharingFile}
        driveConfig={driveConfig}
        onClose={() => setSharingFile(null)}
      />
    )}

    {receiveShareOpen && (
      <ReceiveShareModal
        initialHash={receiveShareHash}
        workerUrl={workerUrl}
        driveConfig={driveConfig}
        topics={topics}
        activeFolderId={activeFolderId}
        onClose={() => {
          setReceiveShareOpen(false);
          setReceiveShareHash("");
        }}
        onSuccess={(targetTopicId) => {
          if (client && driveConfig) {
            const topicToLoad = targetTopicId ?? activeFolderId ?? (topics.length > 0 ? topics[0].id : 0);
            loadFiles(client, driveConfig, topicToLoad, true);
          }
        }}
      />
    )}

    {renameTarget && (
      <RenameModal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        initialName={
          renameTarget.type === "folder"
            ? renameTarget.folder?.title || ""
            : renameTarget.file?.name || ""
        }
        itemType={renameTarget.type}
        onSubmit={handleConfirmRename}
      />
    )}

    <Modal open={showJoinPrompt} onClose={handleSkipJoinChannel} sheet noPadding>
      <div className="flex flex-col max-h-[calc(92dvh_-_28px)] bottom-nav-safe">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-3 pb-2 shrink-0">
          <div className="flex items-center gap-3 min-w-0 pt-1.5">
            <img src="/icons/icon-192.png" alt="" draggable={false} className="w-11 h-11 rounded-xl shrink-0 object-cover" />
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-md-on-surface leading-tight">
                Join our Update Channel
              </h2>
              <p className="text-[10px] text-md-on-surface-variant font-medium mt-0.5">
                Never miss a new feature
              </p>
            </div>
          </div>
          <button
            onClick={handleSkipJoinChannel}
            className="w-11 h-11 rounded-full text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-highest transition-all flex items-center justify-center cursor-pointer active:scale-90 shrink-0 focus-visible:ring-2 focus-visible:ring-md-primary outline-none"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 pb-6 space-y-4 overflow-y-auto scrollbar-thin">
          <p className="text-sm text-md-on-surface-variant leading-relaxed font-medium select-none">
            Stay informed with the latest features, releases, and service announcements. Subscribing to our update channel is also a wonderful way to support the development of Clash Drive!
          </p>

          <div className="flex items-center gap-3 bg-md-surface-container rounded-2xl px-4 py-3 border border-md-outline-variant/30 select-none">
            <div className="w-10 h-10 rounded-xl bg-md-primary/10 text-md-primary flex items-center justify-center shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-md-on-surface">Official Channel</p>
              <p className="text-[11px] font-mono text-md-primary font-medium mt-0.5">@clashgramclient</p>
            </div>
          </div>

          <div className="flex gap-2.5 pt-1">
            <button
              onClick={handleSkipJoinChannel}
              disabled={joiningChannel}
              className="flex-1 h-12 rounded-xl bg-md-surface-container-high text-md-on-surface-variant text-sm font-semibold active:scale-95 transition-all hover:bg-md-surface-container-highest cursor-pointer disabled:opacity-50"
            >
              No thanks
            </button>
            <button
              onClick={handleJoinUpdateChannel}
              disabled={joiningChannel}
              className="flex-[1.4] h-12 rounded-xl bg-md-primary hover:brightness-110 text-md-on-primary text-sm font-semibold active:scale-95 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {joiningChannel ? (
                <>
                  <div className="w-4 h-4 border-2 border-md-on-primary border-t-transparent rounded-full animate-spin" />
                  <span>Joining...</span>
                </>
              ) : (
                <span>Fine</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>

    {/* Toast notifications */}
    {toast.show && (
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-slide-down pointer-events-none select-none max-w-[90vw] md:max-w-md w-full px-4">
        <div className="anymex-glass rounded-xl p-4 flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
            toast.type === "success" 
              ? "bg-success/10 text-success" 
              : toast.type === "error" 
                ? "bg-danger/10 text-danger" 
                : "bg-md-primary/10 text-md-primary"
          }`}>
            {toast.type === "success" && (
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            {toast.type === "error" && (
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            {toast.type === "info" && (
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <p className="text-xs font-semibold text-md-on-surface leading-tight flex-1">
            {toast.message}
          </p>
        </div>
      </div>
    )}

    {/* Custom Confirmation Modal */}
    <Modal
      open={confirmState.show}
      onClose={() => setConfirmState((prev) => ({ ...prev, show: false }))}
      sheet
      noPadding
    >
      <div className="flex flex-col max-h-[calc(92dvh_-_28px)] bottom-nav-safe">
        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-3 min-w-0 pt-1">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                confirmState.danger ? "bg-md-error-container/30 text-md-error" : "bg-md-primary/10 text-md-primary"
              }`}
            >
              {confirmState.danger ? (
                <svg className="w-5.5 h-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6" />
                </svg>
              ) : (
                <svg className="w-5.5 h-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold tracking-tight text-md-on-surface leading-tight">{confirmState.title}</h2>
              <p className="text-[10px] text-md-on-surface-variant font-medium mt-0.5">
                {confirmState.danger ? "This action cannot be undone" : "Confirm action"}
              </p>
            </div>
          </div>
          <button
            onClick={() => setConfirmState((prev) => ({ ...prev, show: false }))}
            className="w-11 h-11 rounded-full text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-highest transition-all flex items-center justify-center cursor-pointer active:scale-90 shrink-0 focus-visible:ring-2 focus-visible:ring-md-primary outline-none"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 pb-6 space-y-4 overflow-y-auto scrollbar-thin">
          <p className="text-sm text-md-on-surface-variant leading-relaxed font-medium select-none">
            {confirmState.message}
          </p>
          <div className="flex gap-2.5 pt-1">
            <button
              onClick={() => setConfirmState((prev) => ({ ...prev, show: false }))}
              className="flex-1 h-12 rounded-xl bg-md-surface-container-high text-md-on-surface-variant text-sm font-semibold active:scale-95 transition-all hover:bg-md-surface-container-highest cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={confirmState.onConfirm}
              className={`flex-[1.4] h-12 rounded-xl text-sm font-semibold active:scale-95 transition-all cursor-pointer ${
                confirmState.danger
                  ? "bg-md-error hover:brightness-110 text-md-on-error"
                  : "bg-md-primary hover:brightness-110 text-md-on-primary"
              }`}
            >
              {confirmState.danger ? "Delete" : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
    </>
  );
}
