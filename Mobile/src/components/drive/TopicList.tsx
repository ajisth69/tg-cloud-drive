import type { TopicFolder } from "../../types";

interface TopicListProps {
  folders: TopicFolder[];
  activeFolderId?: number;
  onFolderClick: (id: number) => void;
  onRenameFolder: (folder: TopicFolder) => void;
  onDeleteFolder: (id: number) => void;
}

export function TopicList({
  folders,
  activeFolderId,
  onFolderClick,
  onRenameFolder,
  onDeleteFolder,
}: TopicListProps) {
  const folderColors = [
    "#6750a4", // Primary purple
    "#005cbb", // Primary blue
    "#1b6d2f", // Success green
    "#7c5800", // Warning amber
    "#ba1a1a", // Error red
    "#6750a4", // Purple
    "#006874", // Teal
    "#555f71", // Secondary
  ];

  if (folders.length === 0) return null;

  return (
    <div className="w-full overflow-x-auto scrollbar-none flex items-center gap-2 py-1 px-0.5 select-none scroll-smooth">
      {folders.map((folder, idx) => {
        const themeColor = folderColors[idx % folderColors.length];
        const isActive = activeFolderId === folder.id;
        return (
          <div
            key={folder.id}
            onClick={() => onFolderClick(folder.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer transition-all duration-200 shrink-0 border select-none min-h-[32px] ${
              isActive
                ? "bg-md-primary/10 border-md-primary/30 text-md-primary"
                : "bg-md-surface-container-low border-md-outline-variant hover:bg-md-surface-container-high"
            }`}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: isActive ? "var(--md-primary)" : themeColor }}
            />
            
            <span className={`text-xs font-medium tracking-tight ${
              isActive ? "text-md-primary" : "text-md-on-surface-variant"
            }`}>
              {folder.title}
            </span>

            <div className="flex items-center gap-0.5 ml-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRenameFolder(folder);
                }}
                className={`p-1 rounded-full transition-all cursor-pointer ${
                  isActive 
                    ? "hover:bg-md-primary/10 text-md-primary/70 hover:text-md-primary" 
                    : "hover:bg-md-surface-container-highest text-md-outline hover:text-md-primary"
                }`}
                title="Rename folder"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteFolder(folder.id);
                }}
                className={`p-1 rounded-full transition-all cursor-pointer ${
                  isActive 
                    ? "hover:bg-md-primary/10 text-md-primary/70 hover:text-md-primary" 
                    : "hover:bg-md-error-container text-md-outline hover:text-md-error"
                }`}
                title="Delete folder"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
