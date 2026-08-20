import { useState, useRef, useEffect, useCallback } from "react";
import type { TelegramClient } from "@mtcute/web";
import type { DriveConfig, TopicFolder, DriveFile, UploadProgress, DownloadProgress, SavedAccount, UserProfile } from "../../types";
import type { Theme } from "../../hooks/useTheme";
import { registerBackHandler } from "../../lib/back";
import { subscribeOverlayOpen } from "../../lib/sheetStack";
import { Header } from "../layout/Header";
import { Sidebar } from "./Sidebar";
import { Breadcrumb } from "./Breadcrumb";
import { FileGrid } from "./FileGrid";
import { CreateFolderModal } from "./CreateFolderModal";
import { formatBytes } from "../../lib/manifest";
import { FileIcon } from "./FileIcon";
import { MoveCopyModal } from "./MoveCopyModal";
import { FileInfoModal } from "./FileInfoModal";
import { SettingsModal } from "./SettingsModal";
import { FloatingTransferWidget } from "./FloatingTransferWidget";
import { ActionSheet } from "../ui/ActionSheet";

interface DashboardProps {
  client?: TelegramClient | null;
  driveConfig: DriveConfig;
  topics: TopicFolder[];
  files: DriveFile[];
  loadingFiles: boolean;
  onFileDrop: (files: File[]) => void;
  uploads: UploadProgress[];
  downloadProgress: DownloadProgress | null;
  onFolderClick: (id: number) => void;
  onBackToRoot: () => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folder: TopicFolder) => void;
  onDeleteFolder: (id: number) => void;
  onDownload: (file: DriveFile) => void | Promise<void>;
  onDownloadFilesBatch?: (files: DriveFile[]) => Promise<void>;
  onCancelUpload?: (fileId: string) => void;
  onCancelDownload?: () => void;
  onRenameFile: (file: DriveFile) => void;
  onDeleteFile: (file: DriveFile) => void;
  onMoveFile?: (files: DriveFile[], targetFolderId: number) => Promise<boolean>;
  onCopyFile?: (files: DriveFile[], targetFolderId: number) => Promise<boolean>;
  onLogout: () => void;
  userProfile: UserProfile | null;
  accounts: SavedAccount[];
  activeAccountId: string | null;
  onAddAccount: () => void;
  onSwitchAccount: (userId: string) => void;
  onRemoveAccount: (userId: string) => void;
  activeFolderId: number | null;
  filterTopics: (q: string) => TopicFolder[];
  filterFiles: (q: string) => DriveFile[];
  onPreview: (file: DriveFile, list?: DriveFile[]) => void;
  allFiles: DriveFile[];
  recentFiles: DriveFile[];
  indexing: boolean;
  indexingProgress: { current: number; total: number };
  onDeleteFilesBatch: (files: DriveFile[]) => Promise<boolean>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onJoinUpdateChannel?: () => void | Promise<void>;
  joiningChannel?: boolean;
  onClearCache?: () => void | Promise<void>;
  triggerConfirm?: (title: string, message: string, onConfirm: () => void | Promise<void>, danger?: boolean) => void;
  triggerToast?: (message: string, type?: "success" | "error" | "info") => void;
  favouriteChunks?: Set<string>;
  onToggleLike?: (file: DriveFile) => void;
  onShare?: (file: DriveFile) => void;
  fileSharingEnabled?: boolean;
  onToggleFileSharing?: () => void;
  onOpenReceiveShare?: (hash?: string) => void;
  onRefreshFiles?: () => void | Promise<void>;
  refreshingFiles?: boolean;
}

const ICON = "w-5 h-5";

function getFolderIcon(title: string, color: string, baseClass = "w-5 h-5 shrink-0") {
  const t = title.toLowerCase();
  if (t.includes("favour") || t.includes("favor")) {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    );
  }
  if (t.includes("video") || t.includes("movie") || t.includes("film")) {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }
  if (t.includes("audio") || t.includes("music") || t.includes("sound") || t.includes("song")) {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    );
  }
  if (t.includes("photo") || t.includes("image") || t.includes("pic") || t.includes("gallery")) {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (t.includes("doc") || t.includes("text") || t.includes("pdf") || t.includes("file") || t.includes("sheet")) {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  return (
    <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

const FOLDER_COLORS = ["#3949ab", "#4355b9", "#5c6bc0", "#7c5800", "#ba1a1a", "#006874"];

const SORT_OPTIONS: { id: string; label: string; sortBy: "name" | "size" | "date"; sortOrder: "asc" | "desc" }[] = [
  { id: "newest", label: "Newest first", sortBy: "date", sortOrder: "desc" },
  { id: "oldest", label: "Oldest first", sortBy: "date", sortOrder: "asc" },
  { id: "nameAsc", label: "Name A-Z", sortBy: "name", sortOrder: "asc" },
  { id: "nameDesc", label: "Name Z-A", sortBy: "name", sortOrder: "desc" },
  { id: "sizeDesc", label: "Largest first", sortBy: "size", sortOrder: "desc" },
  { id: "sizeAsc", label: "Smallest first", sortBy: "size", sortOrder: "asc" },
];

function folderColorFor(title: string, idx: number) {
  const t = title.toLowerCase();
  if (t.includes("favour") || t.includes("favor")) return "#7c5800";
  if (t.includes("video") || t.includes("movie") || t.includes("film")) return "#5c6bc0";
  if (t.includes("audio") || t.includes("music") || t.includes("sound")) return "#006874";
  if (t.includes("photo") || t.includes("image") || t.includes("pic") || t.includes("gallery")) return "#1b6d2f";
  if (t.includes("doc") || t.includes("text") || t.includes("pdf") || t.includes("file")) return "#4355b9";
  return FOLDER_COLORS[idx % FOLDER_COLORS.length];
}

export function Dashboard({
  client,
  driveConfig,
  topics,
  files,
  loadingFiles,
  onFileDrop,
  uploads,
  downloadProgress,
  onFolderClick,
  onBackToRoot,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDownload,
  onDownloadFilesBatch,
  onCancelUpload,
  onCancelDownload,
  onRenameFile,
  onDeleteFile,
  onMoveFile,
  onCopyFile,
  onLogout,
  userProfile,
  accounts,
  activeAccountId,
  onAddAccount,
  onSwitchAccount,
  onRemoveAccount,
  activeFolderId,
  filterTopics,
  filterFiles,
  onPreview,
  allFiles,
  recentFiles,
  indexing,
  indexingProgress,
  onDeleteFilesBatch,
  theme,
  setTheme,
  onJoinUpdateChannel,
  joiningChannel = false,
  onClearCache,
  triggerConfirm,
  triggerToast,
  favouriteChunks = new Set(),
  onToggleLike,
  onShare,
  fileSharingEnabled,
  onToggleFileSharing,
  onOpenReceiveShare,
  onRefreshFiles,
  refreshingFiles = false,
}: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [moveCopyTarget, setMoveCopyTarget] = useState<{ open: boolean; files: DriveFile[] } | null>(null);
  const [infoModalFile, setInfoModalFile] = useState<DriveFile | null>(null);
  const [folderAction, setFolderAction] = useState<TopicFolder | null>(null);
  const [view, setView] = useState<"home" | "starred">("home");
  const [recentAction, setRecentAction] = useState<DriveFile | null>(null);

  const [sortBy, setSortBy] = useState<"name" | "size" | "date">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const activeSortLabel =
    SORT_OPTIONS.find((o) => o.sortBy === sortBy && o.sortOrder === sortOrder)?.label ?? "Newest first";
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement | null>(null);

  // When opening a folder, the sort resets to Name A-Z by default.
  const prevFolderRef = useRef(activeFolderId);
  useEffect(() => {
    if (activeFolderId !== prevFolderRef.current && activeFolderId !== null) {
      setSortBy("name");
      setSortOrder("asc");
    }
    prevFolderRef.current = activeFolderId;
  }, [activeFolderId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) {
        setShowSortDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [selectionState, setSelectionState] = useState<{
    folderId: number | null;
    ids: Set<number>;
  }>({ folderId: activeFolderId, ids: new Set() });
  const selectedFileIds =
    selectionState.folderId === activeFolderId ? selectionState.ids : new Set<number>();

  const mainRef = useRef<HTMLElement | null>(null);
  const mobileFileInputRef = useRef<HTMLInputElement | null>(null);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  // An open sheet/modal hides the dock and FAB (they must not cover options)
  const [overlayOpen, setOverlayOpen] = useState(false);
  useEffect(() => subscribeOverlayOpen(setOverlayOpen), []);

  // ─── Pull-to-refresh (like refreshing a web page) ───
  const [pull, setPull] = useState(0);
  const pullStartY = useRef<number | null>(null);
  const pullActive = useRef(false);
  const pullRefreshing = useRef(false);
  useEffect(() => {
    pullRefreshing.current = refreshingFiles;
    if (!refreshingFiles && pull > 0) {
      const t = setTimeout(() => setPull(0), 350);
      return () => clearTimeout(t);
    }
  }, [refreshingFiles, pull]);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || selectedFileIds.size > 0) return;
      if (el.scrollTop > 0) return;
      pullStartY.current = e.touches[0].clientY;
      pullActive.current = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!pullActive.current || pullStartY.current === null) return;
      if (el.scrollTop > 0) {
        pullActive.current = false;
        setPull(0);
        return;
      }
      const dy = e.touches[0].clientY - pullStartY.current;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      e.preventDefault();
      setPull(Math.min(90, dy * 0.45));
    };
    const onEnd = () => {
      pullActive.current = false;
      pullStartY.current = null;
      setPull((p) => {
        if (p >= 55 && !pullRefreshing.current) {
          void onRefreshFiles?.();
          // Keep the indicator in place; once refreshingFiles=true
          // it is replaced by the "spinner" state without jumps.
          return p;
        }
        return 0;
      });
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [mainRef, onRefreshFiles, selectedFileIds.size]);

  const sidebarCloseRef = useRef<HTMLButtonElement | null>(null);

  // Close the drawer with Escape and move focus into it (accessibility)
  useEffect(() => {
    if (!showMobileSidebar) return;
    setTimeout(() => sidebarCloseRef.current?.focus(), 60);
  }, [showMobileSidebar]);

  const handleToggleSelect = (id: number) => {
    setSelectionState((prevState) => {
      const prev = prevState.folderId === activeFolderId ? prevState.ids : new Set<number>();
      const copy = new Set(prev);
      if (copy.has(id)) {
        copy.delete(id);
      } else {
        copy.add(id);
      }
      return { folderId: activeFolderId, ids: copy };
    });
  };

  const activeFolder = topics.find((t) => t.id === activeFolderId) ?? null;
  const displayedTopics = searchQuery ? filterTopics(searchQuery) : topics;

  const matchingFiles = searchQuery
    ? allFiles.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  let filtered = searchQuery ? filterFiles(searchQuery) : files;

  const displayedFiles = [...filtered].sort((a, b) => {
    let comp = 0;
    if (sortBy === "name") comp = a.name.localeCompare(b.name);
    else if (sortBy === "size") comp = a.size - b.size;
    else if (sortBy === "date") comp = a.date - b.date;
    return sortOrder === "asc" ? comp : -comp;
  });

  const handleToggleSelectAll = () => {
    const filesToSelect = activeFolderId === null ? matchingFiles : displayedFiles;
    setSelectionState((prevState) => {
      const prev = prevState.folderId === activeFolderId ? prevState.ids : new Set<number>();
      const allSelected = filesToSelect.length > 0 && filesToSelect.every((f) => prev.has(f.id));
      const copy = new Set(prev);
      if (allSelected) {
        filesToSelect.forEach((f) => copy.delete(f.id));
      } else {
        filesToSelect.forEach((f) => copy.add(f.id));
      }
      return { folderId: activeFolderId, ids: copy };
    });
  };

  const selectedFiles = (activeFolderId === null ? allFiles : files).filter((f) => selectedFileIds.has(f.id));

  const handleBatchDelete = () => {
    if (selectedFiles.length === 0) return;
    if (triggerConfirm) {
      triggerConfirm(
        "Delete Selected Files",
        `Are you sure you want to delete all ${selectedFiles.length} selected files from Telegram cloud storage?`,
        async () => {
          const ok = await onDeleteFilesBatch(selectedFiles);
          if (ok) {
            setSelectionState({ folderId: activeFolderId, ids: new Set() });
            triggerToast?.("Successfully deleted selected files.", "success");
          } else {
            triggerToast?.("Failed to delete some selected files.", "error");
          }
        },
        true
      );
    }
  };

  const handleBatchDownload = async () => {
    if (selectedFiles.length === 0) return;
    if (onDownloadFilesBatch) {
      await onDownloadFilesBatch(selectedFiles);
      setSelectionState({ folderId: activeFolderId, ids: new Set() });
      return;
    }
    for (const file of selectedFiles) {
      try {
        await onDownload(file);
      } catch (err) {
        console.error("Batch download error:", err);
      }
    }
    setSelectionState({ folderId: activeFolderId, ids: new Set() });
  };

  // ─── Scroll memory per context (root / each folder / starred) ───
  // The position is saved BEFORE navigating (the browser clamps scrollTop
  // once the content swaps, so reading it later would lose the real value).
  const scrollMemoryRef = useRef(new Map<string, number>());
  const lastContextRef = useRef(`${activeFolderId ?? "root"}:${view}`);

  const saveCurrentScroll = useCallback(() => {
    const el = mainRef.current;
    if (el) scrollMemoryRef.current.set(lastContextRef.current, el.scrollTop);
  }, []);

  // Restore after a context change; re-apply once files finish loading in
  // case the saved position was clamped while the list was still loading.
  useEffect(() => {
    const nextKey = `${activeFolderId ?? "root"}:${view}`;
    const el = mainRef.current;
    if (lastContextRef.current !== nextKey) {
      lastContextRef.current = nextKey;
      const saved = scrollMemoryRef.current.get(nextKey);
      if (el) el.scrollTo({ top: saved ?? 0, behavior: saved === undefined ? "smooth" : "auto" });
      return;
    }
    if (!loadingFiles) {
      const saved = scrollMemoryRef.current.get(nextKey);
      if (el && saved !== undefined && el.scrollTop < saved) {
        el.scrollTo({ top: saved, behavior: "auto" });
      }
    }
  }, [activeFolderId, view, loadingFiles]);


  const starredFiles = allFiles.filter((f) => favouriteChunks.has(f.manifest.chunks.join(",")));

  const handleOpenFolder = (id: number) => {
    saveCurrentScroll();
    setView("home");
    onFolderClick(id);
  };

  const handleBackHome = () => {
    saveCurrentScroll();
    setView("home");
    setSearchQuery("");
    onBackToRoot();
  };

  // ─── Back navigation (hardware button / system gesture / browser back) ───
  // Latest values via refs so the persistent handler stays registered once.
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  const searchQueryRef = useRef(searchQuery);
  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);
  const selectedIdsRef = useRef(selectedFileIds);
  useEffect(() => {
    selectedIdsRef.current = selectedFileIds;
  }, [selectedFileIds]);
  const activeFolderIdRef = useRef(activeFolderId);
  useEffect(() => {
    activeFolderIdRef.current = activeFolderId;
  }, [activeFolderId]);

  useEffect(() => {
    const handleBackHomeRef = { current: handleBackHome };
    handleBackHomeRef.current = handleBackHome;
    return registerBackHandler(() => {
      if (selectedIdsRef.current.size > 0) {
        setSelectionState({ folderId: activeFolderIdRef.current, ids: new Set() });
        return true;
      }
      if (searchQueryRef.current) {
        setSearchQuery("");
        return true;
      }
      if (viewRef.current === "starred") {
        saveCurrentScroll();
        setView("home");
        return true;
      }
      if (activeFolderIdRef.current !== null) {
        handleBackHomeRef.current();
        return true;
      }
      return false;
    }, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drawer closes on back while open
  useEffect(() => {
    if (!showMobileSidebar) return;
    return registerBackHandler(() => {
      setShowMobileSidebar(false);
      return true;
    }, 100);
  }, [showMobileSidebar]);

  const scrollMainToTop = () => {
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleNavClick = (id: string) => {
    if (id === "home") {
      if (view === "home" && activeFolderId === null) {
        scrollMainToTop();
      } else {
        handleBackHome();
      }
    } else if (id === "starred") {
      saveCurrentScroll();
      setSearchQuery("");
      setView("starred");
    } else if (id === "shared") {
      onOpenReceiveShare?.();
    }
  };

  const fileActionsFor = (file: DriveFile) => {
    const isLiked = favouriteChunks.has(file.manifest.chunks.join(","));
    return [
      {
        id: "preview",
        label: "Open / View",
        icon: (
          <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        ),
        onClick: () => onPreview(file, recentFiles),
      },
      {
        id: "share",
        label: "Share",
        icon: (
          <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
          <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
          <svg className={ICON} fill={isLiked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isLiked ? 0 : 2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        ),
        onClick: () => onToggleLike?.(file),
      },
      {
        id: "move",
        label: "Move / Copy",
        icon: (
          <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        ),
        onClick: () => onMoveFile && setMoveCopyTarget({ open: true, files: [file] }),
      },
      {
        id: "details",
        label: "Details",
        icon: (
          <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ),
        onClick: () => setInfoModalFile(file),
      },
      ...(onRenameFile
        ? [
            {
              id: "rename",
              label: "Rename",
              icon: (
                <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
              ),
              onClick: () => onRenameFile(file),
            },
          ]
        : []),
      ...(onDeleteFile
        ? [
            {
              id: "delete",
              label: "Delete",
              danger: true,
              icon: (
                <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              ),
              onClick: () => onDeleteFile(file),
            },
          ]
        : []),
    ];
  };

  const folderActionsFor = (folder: TopicFolder) => [
    {
      id: "open",
      label: "Open",
      icon: (
        <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      ),
      onClick: () => handleOpenFolder(folder.id),
    },
    {
      id: "rename",
      label: "Rename",
      icon: (
        <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
        </svg>
      ),
      onClick: () => onRenameFolder(folder),
    },
    {
      id: "delete",
      label: "Delete",
      danger: true,
      icon: (
        <svg className={ICON} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      onClick: () => onDeleteFolder(folder.id),
    },
  ];

  return (
    <div className="h-dvh max-h-dvh overflow-hidden anymex-ambient anymex-grain flex flex-col relative transition-colors duration-300">
      <FloatingTransferWidget
        uploads={uploads}
        downloadProgress={downloadProgress}
        onCancelUpload={onCancelUpload}
        onCancelDownload={onCancelDownload}
      />
      {selectedFileIds.size > 0 ? (
        /* In selection mode the header is replaced by the options bar
           (like in Google Drive/Photos): it stays in the header position. */
        <div
          className="sticky top-0 z-40 bg-md-surface-container border-b border-md-outline-variant/20 animate-fade-in"
          style={{ paddingTop: "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))", paddingLeft: "var(--safe-area-inset-left, env(safe-area-inset-left, 0px))", paddingRight: "var(--safe-area-inset-right, env(safe-area-inset-right, 0px))" }}
        >
          <div className="flex items-center justify-between px-2 min-h-14 gap-1">
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleToggleSelectAll}
                className="w-11 h-11 rounded-full hover:bg-md-surface-container-high active:scale-95 transition-all flex items-center justify-center cursor-pointer shrink-0"
                aria-label="Select all"
              >
                <span
                  className={`w-5.5 h-5.5 rounded-lg border-[1.5px] flex items-center justify-center transition-all ${
                    (activeFolderId === null ? matchingFiles : displayedFiles).length > 0 &&
                    (activeFolderId === null ? matchingFiles : displayedFiles).every((f) => selectedFileIds.has(f.id))
                      ? "bg-md-primary border-md-primary"
                      : "border-md-on-surface-variant"
                  }`}
                >
                  {(activeFolderId === null ? matchingFiles : displayedFiles).length > 0 &&
                    (activeFolderId === null ? matchingFiles : displayedFiles).every((f) => selectedFileIds.has(f.id)) && (
                      <svg className="w-3.5 h-3.5 text-md-on-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                </span>
              </button>
              <span className="text-sm font-semibold text-md-on-surface tabular-nums pr-1 shrink-0">
                {selectedFileIds.size} selected
              </span>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-0.5 shrink-0">
              {onMoveFile && (
                <button
                  onClick={() => setMoveCopyTarget({ open: true, files: selectedFiles })}
                  className="w-11 h-11 rounded-full text-md-primary hover:bg-md-primary-container/40 active:scale-95 transition-all flex items-center justify-center cursor-pointer shrink-0"
                  aria-label="Move to folder"
                >
                  <svg className="w-5.5 h-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 11v4m0 0l-2.5-2.5M12 15l2.5-2.5" />
                  </svg>
                </button>
              )}
              <button
                onClick={handleBatchDownload}
                className="w-11 h-11 rounded-full text-md-primary hover:bg-md-primary-container/40 active:scale-95 transition-all flex items-center justify-center cursor-pointer shrink-0"
                aria-label="Download selected"
              >
                <svg className="w-5.5 h-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-5-5m5 5l5-5M5 21h14" />
                </svg>
              </button>
              <button
                onClick={handleBatchDelete}
                className="w-11 h-11 rounded-full text-md-error hover:bg-md-error-container/20 active:scale-95 transition-all flex items-center justify-center cursor-pointer shrink-0"
                aria-label="Delete selected"
              >
                <svg className="w-5.5 h-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v6M14 11v6" />
                </svg>
              </button>
              <button
                onClick={() => setSelectionState({ folderId: activeFolderId, ids: new Set() })}
                className="w-11 h-11 rounded-full text-md-on-surface-variant hover:bg-md-surface-container-highest active:scale-95 transition-all flex items-center justify-center cursor-pointer shrink-0"
                aria-label="Close selection"
              >
                <svg className="w-5.5 h-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : (
      <Header
        driveTitle={driveConfig.chatTitle}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        userProfile={userProfile}
        accounts={accounts}
        activeAccountId={activeAccountId}
        onSwitchAccount={onSwitchAccount}
        onRemoveAccount={onRemoveAccount}
        theme={theme}
        setTheme={setTheme}
        onMenuClick={() => setShowMobileSidebar(true)}
        onOpenReceiveShare={onOpenReceiveShare}
        fileSharingEnabled={fileSharingEnabled}
        onToggleFileSharing={onToggleFileSharing}
        onJoinUpdateChannel={onJoinUpdateChannel}
        joiningChannel={joiningChannel}
        onClearCache={onClearCache}
        onOpenSettingsModal={() => setShowSettingsModal(true)}
      />
      )}

      <div className="flex flex-1 overflow-hidden">
        <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto scrollbar-thin">
          {/* Pull-to-refresh indicator */}
          <div className="relative h-0 overflow-visible pointer-events-none z-10">
            <div
              className="absolute left-1/2 top-0 w-10 h-10 -ml-5 flex items-center justify-center rounded-full bg-md-surface-container-high border border-md-outline-variant/30 shadow-lg shadow-black/20 transition-opacity duration-200"
              style={{
                transform: refreshingFiles ? "translateY(72px)" : `translateY(${pull - 34}px)`,
                opacity: refreshingFiles ? 1 : Math.min(1, pull / 60),
                transition: pull === 0 ? "transform 0.3s ease, opacity 0.2s ease" : undefined,
              }}
            >
              <svg
                className={`w-5 h-5 text-md-primary ${refreshingFiles ? "animate-spin" : ""}`}
                style={refreshingFiles ? undefined : { transform: `rotate(${pull * 3}deg)` }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4.1 9a8 8 0 0113.6-3.7L20 7M4 17l2.3 1.7A8 8 0 0019.9 15" />
              </svg>
            </div>
          </div>
          <div key={`${activeFolderId ?? "root"}:${view}`} className="animate-fade-in">
          <div className="px-4 sm:px-6 lg:px-8 py-5 sm:py-6 max-w-5xl mx-auto pb-[calc(var(--safe-area-inset-bottom,_env(safe-area-inset-bottom,_0px))_+_150px)]">
            {view === "starred" ? (
              <div className="space-y-5">
                <div className="flex items-center gap-2.5 px-1">
                  <div className="w-9 h-9 rounded-xl bg-md-primary-container/60 text-md-primary flex items-center justify-center">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-md-on-surface tracking-tight">Starred</h2>
                    <p className="text-[11px] text-md-on-surface-variant">
                      {starredFiles.length} {starredFiles.length === 1 ? "file" : "files"}
                    </p>
                  </div>
                </div>
                {starredFiles.length > 0 ? (
                  <FileGrid
                    key="starred"
                    client={client}
                    driveConfig={driveConfig}
                    files={starredFiles}
                    loading={false}
                    onDownload={onDownload}
                    onPreview={(f) => onPreview(f, starredFiles)}
                    onRename={onRenameFile}
                    onDelete={onDeleteFile}
                    selectedFileIds={selectedFileIds}
                    onToggleSelect={handleToggleSelect}
                    onToggleSelectAll={handleToggleSelectAll}
                    favouriteChunks={favouriteChunks}
                    onToggleLike={onToggleLike}
                    onShare={onShare}
                    onOpenMoveCopy={(f) => setMoveCopyTarget({ open: true, files: f })}
                    onOpenDetails={(f) => setInfoModalFile(f)}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 text-center select-none">
                    <div className="w-20 h-20 mb-4 rounded-full bg-md-primary/10 flex items-center justify-center">
                      <svg className="w-9 h-9 text-md-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
                      </svg>
                    </div>
                    <p className="text-md-on-surface font-bold mb-1 text-[15px]">No starred files</p>
                    <p className="text-md-on-surface-variant text-xs max-w-[260px] leading-relaxed">
                      Star important files to access them quickly here.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <>
                {activeFolderId !== null && activeFolder ? (
                  <div className="flex items-center gap-2.5 select-none">
                    <button
                      onClick={handleBackHome}
                      className="w-11 h-11 -ml-1.5 rounded-full text-md-on-surface hover:bg-md-surface-container-high flex items-center justify-center transition-all cursor-pointer active:scale-90 shrink-0 focus-visible:ring-2 focus-visible:ring-md-primary outline-none"
                      aria-label="Back to My Drive"
                    >
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${folderColorFor(activeFolder.title, activeFolder.id)}22` }}
                    >
                      {getFolderIcon(activeFolder.title, folderColorFor(activeFolder.title, activeFolder.id), "w-6 h-6")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h1 className="text-base font-bold text-md-on-surface tracking-tight truncate leading-tight">
                        {activeFolder.title}
                      </h1>
                      <p className="text-[11px] font-medium text-md-on-surface-variant mt-0.5">
                        {(() => {
                          const c = allFiles.filter((f) => f.topicId === activeFolderId).length;
                          return `${c} ${c === 1 ? "file" : "files"}`;
                        })()}
                      </p>
                    </div>
                    <div className="relative shrink-0" ref={sortDropdownRef}>
                      <button
                        onClick={() => setShowSortDropdown(!showSortDropdown)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-high rounded-full px-2.5 py-2 transition-all cursor-pointer"
                        aria-label="Sort files"
                      >
                        <svg className="w-3.5 h-3.5 text-md-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M6 12h12M10 18h4" />
                        </svg>
                        <span className="capitalize">{activeSortLabel}</span>
                        <svg className={`w-3 h-3 shrink-0 transition-transform duration-200 ${showSortDropdown ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {showSortDropdown && (
                        <div className="absolute right-0 top-full mt-2 z-50 w-[212px] rounded-2xl bg-md-surface-container-high border border-md-outline-variant/40 shadow-2xl shadow-black/50 overflow-hidden animate-slide-down">
                          <div className="px-4 pt-3 pb-1.5 flex items-center gap-2 select-none">
                            <svg className="w-3.5 h-3.5 text-md-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M6 12h12M10 18h4" />
                            </svg>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-md-on-surface-variant">
                              Sort by
                            </p>
                          </div>
                          <div className="pb-1.5">
                            {SORT_OPTIONS.map((opt) => {
                              const active = sortBy === opt.sortBy && sortOrder === opt.sortOrder;
                              return (
                                <button
                                  key={opt.id}
                                  onClick={() => {
                                    setSortBy(opt.sortBy);
                                    setSortOrder(opt.sortOrder);
                                    setShowSortDropdown(false);
                                  }}
                                  className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                                    active
                                      ? "bg-md-primary text-md-on-primary"
                                      : "text-md-on-surface hover:bg-md-surface-container-highest"
                                  }`}
                                >
                                  <span className="capitalize">{opt.label}</span>
                                  {active && (
                                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderAction(activeFolder);
                      }}
                      className="w-11 h-11 rounded-full hover:bg-md-surface-container-high text-md-on-surface-variant flex items-center justify-center transition-all cursor-pointer active:scale-90 shrink-0"
                      aria-label="Folder options"
                    >
                      <svg className="w-5.5 h-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                      </svg>
                    </button>
                  </div>
                ) : null}

                {activeFolderId === null ? (
                  <div className="space-y-7">
                    {!searchQuery && recentFiles.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between px-1">
                          <h2 className="text-sm font-bold text-md-on-surface tracking-tight">
                            Recent uploads
                            <span className="ml-2 text-[10px] font-semibold text-md-on-surface-variant">{recentFiles.length}</span>
                          </h2>
                        </div>
                        <div className="anymex-glass overflow-hidden">
                          {recentFiles.map((file) => (
                            <div
                              key={file.id}
                              onClick={() => onPreview(file, recentFiles)}
                              className="drive-row flex items-center gap-3 px-3.5 py-3.5 cursor-pointer select-none border-b border-md-outline-variant/10 last:border-b-0"
                            >
                              <FileIcon fileName={file.name} className="w-9 h-9 sm:w-10 sm:h-10 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-medium text-md-on-surface truncate leading-tight">{file.name}</p>
                                <p className="text-[11px] text-md-on-surface-variant mt-0.5">
                                  {formatBytes(file.size)} · {new Date(file.date * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                                </p>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRecentAction(file);
                                }}
                                className="w-10 h-10 rounded-lg hover:bg-md-surface-container-high text-md-on-surface-variant flex items-center justify-center cursor-pointer shrink-0"
                              >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      <div className="flex items-center justify-between px-1">
                        <h2 className="text-sm font-bold text-md-on-surface tracking-tight">
                          {searchQuery ? "Matching folders" : "Folders"}
                          <span className="text-[10px] font-semibold text-md-on-surface-variant ml-2 bg-md-surface-container-high px-2 py-0.5 rounded-md">
                            {displayedTopics.length}
                          </span>
                        </h2>
                      </div>

                      {displayedTopics.length > 0 ? (
                        <div className="anymex-glass overflow-hidden">
                          {displayedTopics.map((folder, idx) => {
                            const color = folderColorFor(folder.title, idx);
                            const fileCount = allFiles.filter((f) => f.topicId === folder.id).length;

                            return (
                              <div
                                key={folder.id}
                                onClick={() => handleOpenFolder(folder.id)}
                                className="drive-row flex items-center gap-3 px-3.5 py-3.5 cursor-pointer select-none border-b border-md-outline-variant/10 last:border-b-0"
                              >
                                <div
                                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                                  style={{ backgroundColor: `${color}22` }}
                                >
                                  {getFolderIcon(folder.title, color, "w-5 h-5")}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[13px] font-medium text-md-on-surface truncate leading-tight">
                                    {folder.title}
                                  </p>
                                  <p className="text-[11px] text-md-on-surface-variant mt-0.5">
                                    {fileCount} {fileCount === 1 ? "file" : "files"}
                                  </p>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setFolderAction(folder);
                                  }}
                                  className="w-10 h-10 rounded-lg hover:bg-md-surface-container-high text-md-on-surface-variant flex items-center justify-center cursor-pointer shrink-0"
                                >
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                                  </svg>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        searchQuery && (
                          <p className="text-xs text-md-on-surface-variant italic select-none">
                            No folders matching "{searchQuery}"
                          </p>
                        )
                      )}
                    </div>

                    {searchQuery && (
                      <div className="space-y-4 pt-5 border-t border-md-outline-variant/20">
                        <div className="flex items-center justify-between">
                          <h2 className="text-[13px] font-semibold text-md-on-surface tracking-tight">
                            Search results: Files
                            <span className="text-[10px] font-medium text-md-on-surface-variant ml-2 bg-md-surface-container-high px-2 py-0.5 rounded-full">
                              {matchingFiles.length}
                            </span>
                          </h2>
                        </div>
                        <FileGrid
                          key="search"
                          files={matchingFiles}
                          loading={loadingFiles}
                          onDownload={onDownload}
                          onPreview={(f) => onPreview(f, matchingFiles)}
                          onRename={onRenameFile}
                          onDelete={onDeleteFile}
                          selectedFileIds={selectedFileIds}
                          onToggleSelect={handleToggleSelect}
                          onToggleSelectAll={handleToggleSelectAll}
                          favouriteChunks={favouriteChunks}
                          onToggleLike={onToggleLike}
                          onShare={onShare}
                          onOpenMoveCopy={(f) => setMoveCopyTarget({ open: true, files: f })}
                          onOpenDetails={(f) => setInfoModalFile(f)}
                        />
                      </div>
                    )}

                    {searchQuery && displayedTopics.length === 0 && matchingFiles.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-20 animate-fade-in text-center select-none">
                        <div className="w-20 h-20 mb-4 rounded-full bg-md-primary/10 flex items-center justify-center text-md-primary">
                          <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                        <p className="text-md-on-surface font-bold mb-1 text-[15px]">No results found</p>
                        <p className="text-md-on-surface-variant text-xs max-w-[260px] leading-relaxed">
                          We couldn't find any folders or files matching "{searchQuery}"
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="space-y-5">
                      <div className="pt-3 border-t border-md-outline-variant/10">
                        <FileGrid
                          key={activeFolderId ?? "root"}
                          client={client}
                          driveConfig={driveConfig}
                          files={displayedFiles}
                          loading={loadingFiles}
                          onDownload={onDownload}
                          onPreview={(f) => onPreview(f, displayedFiles)}
                          onRename={onRenameFile}
                          onDelete={onDeleteFile}
                          selectedFileIds={selectedFileIds}
                          onToggleSelect={handleToggleSelect}
                          onToggleSelectAll={handleToggleSelectAll}
                          favouriteChunks={favouriteChunks}
                          onToggleLike={onToggleLike}
                          onShare={onShare}
                          onOpenMoveCopy={(f) => setMoveCopyTarget({ open: true, files: f })}
                          onOpenDetails={(f) => setInfoModalFile(f)}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          </div>
        </main>
      </div>


      <input
        ref={mobileFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFileDrop(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />

      {/* Bottom navigation — island dock: floats centered over the gesture
          zone (not crossed by the gesture bar) */}
      <nav
        className={`dock-bar fixed bottom-[calc(var(--safe-area-inset-bottom,_env(safe-area-inset-bottom,_0px))_+_14px)] left-1/2 -translate-x-1/2 z-40 flex items-center px-2 py-1.5 select-none transition-opacity duration-200 ${overlayOpen ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      >
        {[
          {
            id: "home",
            label: "Home",
            icon: (
              <svg className="w-6 h-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            ),
            active: view === "home",
          },
          {
            id: "starred",
            label: "Starred",
            icon: (
              <svg className="w-6 h-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            ),
            active: view === "starred",
          },
          {
            id: "shared",
            label: "Shared",
            icon: (
              <svg className="w-6 h-6 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            ),
            active: false,
          },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => handleNavClick(item.id)}
            aria-label={item.label}
            className={`dock-item ${item.active ? "text-md-on-primary-container" : ""}`}
          >
            <span className={`dock-item-pill ${item.active ? "dock-item-pill-active" : ""}`}>
              <span className="dock-item-icon">
                {item.icon}
              </span>
              {item.active && (
                <span className="dock-item-label">
                  {item.label}
                </span>
              )}
            </span>
          </button>
        ))}
      </nav>

      {/* Mobile Floating Action Button */}
      {view === "home" && (
        <button
          onClick={() => {
            if (activeFolderId === null) {
              setShowCreateFolder(true);
            } else {
              mobileFileInputRef.current?.click();
            }
          }}
          className={`fixed bottom-[calc(var(--safe-area-inset-bottom,_env(safe-area-inset-bottom,_0px))_+_76px)] right-5 z-40 w-14 h-14 rounded-2xl bg-md-primary hover:brightness-110 text-md-on-primary flex items-center justify-center active:scale-95 transition-all duration-150 cursor-pointer ${overlayOpen ? "opacity-0 pointer-events-none" : "opacity-100"}`}
          title={activeFolderId === null ? "Create Folder" : "Upload Files"}
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            {activeFolderId === null ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            )}
          </svg>
        </button>
      )}

      {/* Action sheets */}
      {recentAction && (
        <ActionSheet
          open={Boolean(recentAction)}
          onClose={() => setRecentAction(null)}
          title={recentAction.name}
          actions={fileActionsFor(recentAction)}
        />
      )}
      {folderAction && (
        <ActionSheet
          open={Boolean(folderAction)}
          onClose={() => setFolderAction(null)}
          title={folderAction.title}
          actions={folderActionsFor(folderAction)}
        />
      )}

      {/* Modals */}
      <MoveCopyModal
        open={Boolean(moveCopyTarget?.open)}
        onClose={() => setMoveCopyTarget(null)}
        files={moveCopyTarget?.files || []}
        folders={topics}
        onMove={async (targetFolderId) => {
          if (moveCopyTarget?.files && onMoveFile) {
            const ok = await onMoveFile(moveCopyTarget.files, targetFolderId);
            if (ok) setSelectionState({ folderId: activeFolderId, ids: new Set() });
          }
        }}
        onCopy={async (targetFolderId) => {
          if (moveCopyTarget?.files && onCopyFile) {
            const ok = await onCopyFile(moveCopyTarget.files, targetFolderId);
            if (ok) setSelectionState({ folderId: activeFolderId, ids: new Set() });
          }
        }}
      />

      <FileInfoModal
        open={Boolean(infoModalFile)}
        onClose={() => setInfoModalFile(null)}
        file={infoModalFile}
        onDownload={onDownload}
        onRename={onRenameFile}
      />

      <SettingsModal
        open={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        userProfile={userProfile}
        accounts={accounts}
        activeAccountId={activeAccountId}
        allFiles={allFiles}
        onAddAccount={onAddAccount}
        onSwitchAccount={onSwitchAccount}
        onRemoveAccount={onRemoveAccount}
        onLogout={onLogout}
        onClearCache={onClearCache}
        theme={theme}
        setTheme={setTheme}
        fileSharingEnabled={fileSharingEnabled}
        onToggleFileSharing={onToggleFileSharing}
        onJoinUpdateChannel={onJoinUpdateChannel}
        joiningChannel={joiningChannel}
      />

      <CreateFolderModal
        open={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onSubmit={onCreateFolder}
      />

      {/* Mobile Sidebar Navigation Drawer */}
      {showMobileSidebar && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50 animate-fade-in"
            onClick={() => setShowMobileSidebar(false)}
            aria-hidden="true"
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="relative flex flex-col w-[300px] max-w-[84vw] bg-md-surface-container h-full border-r border-md-outline-variant/30 animate-slide-right select-none z-50"
            style={{
              paddingTop: "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))",
              boxShadow: "8px 0 32px rgba(0, 0, 0, 0.25)",
            }}
          >
            {/* Drawer header — brand + close */}
            <div className="flex items-center justify-between pl-3.5 pr-2 py-2.5 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src="/icons/icon-192.png"
                  alt=""
                  draggable={false}
                  className="w-9 h-9 rounded-[10px] shrink-0 object-cover"
                />
                <span className="text-[15px] font-semibold tracking-tight text-md-on-surface truncate">
                  Clash Drive
                </span>
              </div>
              <button
                ref={sidebarCloseRef}
                onClick={() => setShowMobileSidebar(false)}
                className="w-11 h-11 rounded-full hover:bg-md-surface-container-high text-md-on-surface-variant flex items-center justify-center cursor-pointer active:scale-90 shrink-0 focus-visible:ring-2 focus-visible:ring-md-primary outline-none"
                aria-label="Close menu"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="h-[1px] bg-md-outline-variant/20 mx-4 shrink-0" />

            <div className="flex-1 overflow-hidden">
              <Sidebar
                className="w-full flex flex-col h-full bg-transparent"
                folders={topics}
                activeFolderId={activeFolderId}
                onFolderClick={(id) => {
                  handleOpenFolder(id);
                  setShowMobileSidebar(false);
                }}
                onCreateFolder={() => {
                  setShowMobileSidebar(false);
                  setShowCreateFolder(true);
                }}
                onBackToRoot={() => {
                  handleBackHome();
                  setShowMobileSidebar(false);
                }}
                allFiles={allFiles}
                indexing={indexing}
                indexingProgress={indexingProgress}
                onJoinUpdateChannel={onJoinUpdateChannel}
                joiningChannel={joiningChannel}
              />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}