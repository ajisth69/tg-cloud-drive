import { useState } from "react";
import { formatBytes } from "../../lib/manifest";
import type { DriveFile } from "../../types";

interface StatsWidgetProps {
  files: DriveFile[];
  indexing: boolean;
  indexingProgress: { current: number; total: number };
}

export function StatsWidget({ files, indexing, indexingProgress }: StatsWidgetProps) {
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem("tgcd_stats_collapsed") === "true";
  });

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("tgcd_stats_collapsed", String(next));
  };

  const totalFiles = files.length;
  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  let imagesSize = 0;
  let videosSize = 0;
  let audioSize = 0;
  let docsSize = 0;
  let otherSize = 0;

  files.forEach((f) => {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
      imagesSize += f.size;
    } else if (["mp4", "webm", "ogg", "mov"].includes(ext)) {
      videosSize += f.size;
    } else if (["mp3", "wav", "m4a", "flac", "ogg"].includes(ext)) {
      audioSize += f.size;
    } else if (["pdf", "docx", "xlsx", "xls", "csv", "txt", "md", "json", "zip", "rar"].includes(ext)) {
      docsSize += f.size;
    } else {
      otherSize += f.size;
    }
  });

  const getPercent = (size: number) => {
    if (totalSize === 0) return 0;
    return (size / totalSize) * 100;
  };

  if (collapsed) {
    return (
      <div
        onClick={toggleCollapsed}
        className="px-4 py-3.5 rounded-2xl bg-md-surface-container-high select-none cursor-pointer hover:bg-md-surface-container-highest transition-all duration-200 flex items-center justify-between"
      >
        <div className="flex flex-col min-w-0">
          <span className="text-[10px] font-semibold text-md-on-surface-variant uppercase tracking-[0.12em]">
            Storage
          </span>
          <span className="text-sm font-bold text-md-on-surface tracking-tight mt-0.5">
            {formatBytes(totalSize)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {indexing ? (
            <span className="text-[10px] text-md-tertiary animate-pulse font-medium">Indexing...</span>
          ) : (
            <span className="text-[10px] font-semibold text-md-on-surface-variant bg-md-surface-container-highest px-2 py-1 rounded-full">
              {totalFiles} files
            </span>
          )}
          <svg className="w-3.5 h-3.5 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-md-surface-container-high px-4 py-3.5 select-none">
      <div onClick={toggleCollapsed} className="flex items-center justify-between cursor-pointer group">
        <span className="text-xs font-semibold text-md-on-surface tracking-tight group-hover:text-md-primary transition-colors">
          Storage Usage
        </span>
        <div className="flex items-center gap-2">
          {indexing ? (
            <span className="text-[10px] text-md-tertiary animate-pulse flex items-center gap-1 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-md-tertiary animate-ping shrink-0" />
              Indexing ({indexingProgress.current}/{indexingProgress.total})
            </span>
          ) : (
            <span className="text-[10px] font-semibold text-md-on-surface-variant bg-md-surface-container-highest px-2 py-1 rounded-full">
              {totalFiles} files
            </span>
          )}
          <svg className="w-3.5 h-3.5 text-md-on-surface-variant transform rotate-180 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      <div className="mt-3 text-xl font-bold text-md-on-surface tracking-tight leading-none">
        {formatBytes(totalSize)}
      </div>

      {/* Storage Segment Bar — M3 tonal colors */}
      <div className="mt-3 h-1.5 w-full rounded-full bg-md-surface-container-highest flex overflow-hidden">
        <div
          style={{ width: `${getPercent(imagesSize)}%` }}
          className="bg-md-primary transition-all duration-500"
          title={`Images: ${formatBytes(imagesSize)}`}
        />
        <div
          style={{ width: `${getPercent(videosSize)}%` }}
          className="bg-md-tertiary transition-all duration-500"
          title={`Videos: ${formatBytes(videosSize)}`}
        />
        <div
          style={{ width: `${getPercent(audioSize)}%` }}
          className="bg-success transition-all duration-500"
          title={`Audio: ${formatBytes(audioSize)}`}
        />
        <div
          style={{ width: `${getPercent(docsSize)}%` }}
          className="bg-warning transition-all duration-500"
          title={`Documents: ${formatBytes(docsSize)}`}
        />
        <div
          style={{ width: `${getPercent(otherSize)}%` }}
          className="bg-md-outline transition-all duration-500"
          title={`Other: ${formatBytes(otherSize)}`}
        />
      </div>

      {/* Legend */}
      <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1.5 text-[10px] text-md-on-surface-variant font-medium pt-2.5 border-t border-md-outline-variant/15">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-md-primary block shrink-0" />
          <span className="truncate">Images {formatBytes(imagesSize)}</span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-md-tertiary block shrink-0" />
          <span className="truncate">Videos {formatBytes(videosSize)}</span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-success block shrink-0" />
          <span className="truncate">Audio {formatBytes(audioSize)}</span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-warning block shrink-0" />
          <span className="truncate">Docs {formatBytes(docsSize)}</span>
        </div>
      </div>
    </div>
  );
}
