import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import type { DriveFile, TopicFolder } from "../../types";

interface MoveCopyModalProps {
  open: boolean;
  onClose: () => void;
  files: DriveFile[];
  folders: TopicFolder[];
  onMove: (targetFolderId: number) => Promise<void>;
  onCopy: (targetFolderId: number) => Promise<void>;
}

export function MoveCopyModal({
  open,
  onClose,
  files,
  folders,
  onMove,
  onCopy,
}: MoveCopyModalProps) {
  const [mode, setMode] = useState<"move" | "copy">("move");
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [processing, setProcessing] = useState(false);

  if (!open || files.length === 0) return null;

  const isBatch = files.length > 1;
  const singleFile = files[0];
  const currentFolderId = singleFile ? singleFile.topicId : null;

  const handleExecute = async () => {
    if (selectedFolderId === null) return;
    setProcessing(true);
    try {
      if (mode === "move") {
        await onMove(selectedFolderId);
      } else {
        await onCopy(selectedFolderId);
      }
      onClose();
    } catch (e) {
      console.error(`Failed to ${mode} file:`, e);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      sheet
      title={isBatch ? `${mode === "move" ? "Move" : "Copy"} ${files.length} Files` : `${mode === "move" ? "Move" : "Copy"} "${singleFile.name}"`}
    >
      <div className="space-y-4 select-none">
        {/* M3 Segmented Tabs */}
        <div className="flex bg-md-surface-container-high p-1 rounded-xl border border-md-outline-variant/20">
          <button
            onClick={() => setMode("move")}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              mode === "move"
                ? "bg-md-surface-container-lowest text-md-primary font-bold shadow-sm"
                : "text-md-on-surface-variant hover:text-md-on-surface"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Move
          </button>
          <button
            onClick={() => setMode("copy")}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              mode === "copy"
                ? "bg-md-surface-container-lowest text-md-primary font-bold shadow-sm"
                : "text-md-on-surface-variant hover:text-md-on-surface"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy
          </button>
        </div>

        {/* Destination Folder Selection List */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-md-on-surface-variant mb-2 px-1">
            Select Destination Folder
          </p>

          <div className="max-h-60 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {folders.map((folder) => {
              const isCurrent = !isBatch && currentFolderId === folder.id;
              const isSelected = selectedFolderId === folder.id;

              return (
                <button
                  key={folder.id}
                  onClick={() => setSelectedFolderId(folder.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-xl text-left transition-all cursor-pointer border ${
                    isSelected
                      ? "bg-md-secondary-container border-transparent text-md-on-secondary-container"
                      : isCurrent
                      ? "bg-md-surface-container/50 border-md-outline-variant/30 opacity-70"
                      : "bg-md-surface-container border-md-outline-variant/20 hover:bg-md-surface-container-high"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-xs ${
                      isSelected ? "bg-md-primary text-md-on-primary" : "bg-md-primary-container text-md-on-primary-container"
                    }`}>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate text-md-on-surface">
                        {folder.title}
                      </p>
                      {isCurrent && (
                        <span className="text-[10px] text-md-on-surface-variant font-medium">Current location</span>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-md-primary text-md-on-primary flex items-center justify-center shrink-0">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </button>
              );
            })}

            {folders.length === 0 && (
              <div className="p-6 text-center text-xs text-md-on-surface-variant font-medium">
                No folders available. Create a folder first.
              </div>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-3 border-t border-md-outline-variant/20">
          <Button
            variant="ghost"
            size="md"
            onClick={onClose}
            disabled={processing}
            className="w-full sm:w-auto justify-center"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleExecute}
            disabled={selectedFolderId === null || processing || (mode === "move" && !isBatch && selectedFolderId === currentFolderId)}
            loading={processing}
            className="w-full sm:w-auto justify-center"
          >
            {processing
              ? `${mode === "move" ? "Moving..." : "Copying..."}`
              : `${mode === "move" ? "Move Here" : "Copy Here"}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
