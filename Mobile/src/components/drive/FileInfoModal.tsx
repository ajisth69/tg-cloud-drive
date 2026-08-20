import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { formatBytes } from "../../lib/manifest";
import { mimeTypeFromName } from "../../lib/downloader";
import { FileIcon } from "./FileIcon";
import type { DriveFile } from "../../types";

interface FileInfoModalProps {
  open: boolean;
  onClose: () => void;
  file: DriveFile | null;
  onDownload?: (file: DriveFile) => void;
  onRename?: (file: DriveFile) => void;
}

export function FileInfoModal({
  open,
  onClose,
  file,
  onDownload,
  onRename,
}: FileInfoModalProps) {
  if (!open || !file) return null;

  const ext = file.name.split(".").pop()?.toUpperCase() || "FILE";
  const mime = file.mimeType || mimeTypeFromName(file.name) || "application/octet-stream";
  const formattedDate = new Date(file.date * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const getCategoryLabel = (name: string, mimeType: string) => {
    const extension = name.split(".").pop()?.toLowerCase() || "";
    if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) return "IMAGE";
    if (mimeType.startsWith("video/") || ["mp4", "webm", "mkv", "mov"].includes(extension)) return "VIDEO";
    if (mimeType.startsWith("audio/") || ["mp3", "wav", "m4a", "flac"].includes(extension)) return "AUDIO";
    if (["pdf", "doc", "docx", "txt", "xlsx"].includes(extension)) return "DOCUMENT";
    return "FILE";
  };

  const category = getCategoryLabel(file.name, mime);

  return (
    <Modal open={open} onClose={onClose} sheet title="File Details">
      <div className="space-y-6 select-none">
        {/* Header File Info */}
        <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-md-surface-container border border-md-outline-variant/20">
          <div className="w-11 h-11 rounded-xl bg-md-primary-container text-md-on-primary-container flex items-center justify-center shrink-0">
            <FileIcon fileName={file.name} className="w-6 h-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-bold text-md-on-surface truncate" title={file.name}>
              {file.name}
            </h4>
            <span className="inline-block text-[10px] font-semibold uppercase font-mono bg-md-primary-container text-md-on-primary-container px-2 py-0.5 rounded-md mt-0.5">
              {category}
            </span>
          </div>
        </div>

        {/* Key-Value Details Grid */}
        <div className="space-y-3 px-1 text-xs">
          <div className="flex items-center justify-between py-1 border-b border-md-outline-variant/20">
            <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">
              SIZE
            </span>
            <span className="font-mono font-semibold text-md-on-surface">
              {formatBytes(file.size)}
            </span>
          </div>

          <div className="flex items-center justify-between py-1 border-b border-md-outline-variant/20">
            <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">
              DATE
            </span>
            <span className="font-medium text-md-on-surface">
              {formattedDate}
            </span>
          </div>

          <div className="flex items-center justify-between py-1 border-b border-md-outline-variant/20">
            <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">
              TYPE
            </span>
            <span className="font-mono font-semibold text-md-primary bg-md-primary-container px-2 py-0.5 rounded-md text-[10px]">
              {ext}
            </span>
          </div>

          <div className="flex items-center justify-between py-1 border-b border-md-outline-variant/20">
            <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">
              MIME
            </span>
            <span className="font-mono text-[11px] text-md-on-surface-variant truncate max-w-[200px]" title={mime}>
              {mime}
            </span>
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="font-medium uppercase tracking-wide text-[10px] text-md-on-surface-variant">
              CHUNKS
            </span>
            <span className="font-mono text-xs font-semibold text-md-on-surface">
              {file.manifest?.chunks?.length || 1} {file.manifest?.chunks?.length === 1 ? "chunk" : "chunks"}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-md-outline-variant/20">
          {onRename && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                onClose();
                onRename(file);
              }}
              className="flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              Rename
            </Button>
          )}
          {onDownload && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onClose();
                onDownload(file);
              }}
              className="flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
