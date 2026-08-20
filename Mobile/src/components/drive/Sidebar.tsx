import type { TopicFolder, DriveFile } from "../../types";
import { StatsWidget } from "./StatsWidget";

function getFolderIcon(title: string) {
  const t = title.toLowerCase();
  if (t.includes("favour") || t.includes("favor")) {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    );
  }
  if (t.includes("video")) {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }
  if (t.includes("audio") || t.includes("music")) {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    );
  }
  if (t.includes("photo") || t.includes("image") || t.includes("pic")) {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (t.includes("doc") || t.includes("text") || t.includes("pdf") || t.includes("file")) {
    return (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function getFolderColor(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("favour") || t.includes("favor")) return "#7c5800";
  if (t.includes("video")) return "#6750a4";
  if (t.includes("audio") || t.includes("music")) return "#006874";
  if (t.includes("photo") || t.includes("image") || t.includes("pic")) return "#1b6d2f";
  if (t.includes("doc") || t.includes("text") || t.includes("pdf") || t.includes("file")) return "#005cbb";
  return "#7c5800";
}

interface SidebarProps {
  className?: string;
  folders: TopicFolder[];
  activeFolderId: number | null;
  onFolderClick: (id: number) => void;
  onCreateFolder: () => void;
  onBackToRoot: () => void;
  allFiles: DriveFile[];
  indexing: boolean;
  indexingProgress: { current: number; total: number };
  onJoinUpdateChannel?: () => void | Promise<void>;
  joiningChannel?: boolean;
  onOpenReceiveShare?: () => void;
}

export function Sidebar({
  className = "",
  folders,
  activeFolderId,
  onFolderClick,
  onCreateFolder,
  onBackToRoot,
  allFiles,
  indexing,
  indexingProgress,
}: SidebarProps) {
  return (
    <aside
      role="navigation"
      aria-label="Drive folders"
      className={className || "w-full flex flex-col h-full select-none"}
    >
      <nav className="flex-1 overflow-y-auto px-3 pb-3 pt-1 space-y-0.5 scrollbar-thin">
        {/* All files (root) */}
        <button
          onClick={onBackToRoot}
          aria-current={activeFolderId === null ? "page" : undefined}
          className={`w-full flex items-center gap-3 px-3.5 rounded-[14px] text-[13px] font-medium transition-all cursor-pointer min-h-[48px] focus-visible:ring-2 focus-visible:ring-md-primary outline-none ${
            activeFolderId === null
              ? "bg-md-secondary-container text-md-on-secondary-container font-semibold"
              : "text-md-on-surface-variant hover:bg-md-surface-container-high"
          }`}
        >
          <svg className="w-[18px] h-[18px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          <span className="truncate">All Files</span>
        </button>

        {/* Folders section */}
        <div className="pt-4 pb-1.5 flex items-center justify-between pl-4 pr-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-md-on-surface-variant">
            Folders
          </span>
          <div className="flex items-center gap-1">
<span className="text-[10px] font-semibold text-md-on-surface-variant bg-md-surface-container-high px-2 py-0.5 rounded-full">
            {folders.length}
          </span>
            <button
              onClick={onCreateFolder}
              aria-label="New folder"
              className="w-8 h-8 rounded-full text-md-primary hover:bg-md-primary/10 flex items-center justify-center cursor-pointer active:scale-90 focus-visible:ring-2 focus-visible:ring-md-primary outline-none"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
        </div>
        </div>

        {folders.map((folder) => (
          <button
            key={folder.id}
            onClick={() => onFolderClick(folder.id)}
            aria-current={activeFolderId === folder.id ? "page" : undefined}
            className={`w-full flex items-center gap-3 pl-3.5 pr-3 rounded-[14px] text-[13px] font-medium transition-all cursor-pointer min-h-[48px] focus-visible:ring-2 focus-visible:ring-md-primary outline-none ${
              activeFolderId === folder.id
                ? "bg-md-secondary-container text-md-on-secondary-container font-semibold"
                : "text-md-on-surface-variant hover:bg-md-surface-container-high"
            }`}
          >
            <div
              className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `${getFolderColor(folder.title)}1f`,
                color: activeFolderId === folder.id ? "var(--md-on-secondary-container)" : getFolderColor(folder.title),
              }}
            >
              {getFolderIcon(folder.title)}
            </div>
            <span className="truncate">{folder.title}</span>
          </button>
        ))}

        {folders.length === 0 && (
          <div className="px-4 py-6 text-center select-none">
            <p className="text-xs text-md-on-surface-variant font-medium">No folders yet</p>
            <p className="text-[10px] text-md-outline mt-1 max-w-[150px] mx-auto">
              Tap + to create your first folder.
            </p>
          </div>
        )}
      </nav>

      <div
        className="px-3 pt-2.5 shrink-0"
        style={{ paddingBottom: "calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)) + 12px)" }}
      >
        <StatsWidget
          files={allFiles}
          indexing={indexing}
          indexingProgress={indexingProgress}
        />
      </div>
    </aside>
  );
}
