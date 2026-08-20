import { useCallback, useRef, useState } from "react";

interface UploadZoneProps {
  onDrop: (files: File[]) => void;
  disabled?: boolean;
  onImportShareHash?: (hash?: string) => void;
}

export function UploadZone({ onDrop, disabled, onImportShareHash }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [shareHashInput, setShareHashInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!disabled) setIsDragging(true);
    },
    [disabled]
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (disabled) return;

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length > 0) {
        onDrop(droppedFiles);
      }
    },
    [onDrop, disabled]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFiles = Array.from(e.target.files || []);
      if (selectedFiles.length > 0) {
        onDrop(selectedFiles);
      }
      e.target.value = "";
    },
    [onDrop]
  );

  const handleZoneClick = useCallback(() => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  }, [disabled]);

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (onImportShareHash && shareHashInput.trim()) {
      onImportShareHash(shareHashInput.trim());
      setShareHashInput("");
    }
  };

  return (
    <div className="space-y-3.5">
      {/* Drag & Drop Container — AnymeX glass style */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleZoneClick}
        className={`relative anymex-glass transition-all duration-200 text-center cursor-pointer group select-none ${
          isDragging
            ? "border-md-primary bg-md-primary-container/20 scale-[1.005]"
            : "border border-dashed hover:border-md-primary/50"
        } ${disabled ? "opacity-40 pointer-events-none" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple={true}
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled}
        />

        <div
          className={`flex flex-col items-center gap-3.5 pointer-events-none transition-transform duration-200 ${
            isDragging ? "scale-[1.02]" : ""
          }`}
        >
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-200 ${
              isDragging
                ? "bg-md-primary text-md-on-primary"
                : "bg-md-surface-container-high group-hover:bg-md-surface-container-highest border border-md-outline-variant text-md-on-surface-variant"
            }`}
          >
            <svg
              className="w-7 h-7"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
              />
            </svg>
          </div>

          <div>
            <p className="text-sm font-semibold text-md-on-surface tracking-tight">
              {isDragging ? "Drop files here" : "Drag & drop files"}
            </p>
            <p className="text-xs text-md-on-surface-variant mt-1 font-medium">
              or click to browse • Unlimited Telegram Vault storage
            </p>
          </div>
        </div>
      </div>

      {/* Import Token Row */}
      {onImportShareHash && (
        <form
          onSubmit={handleImportSubmit}
          onClick={(e) => e.stopPropagation()}
          className="p-2 sm:p-3 anymex-glass flex items-center gap-2 select-none overflow-hidden"
        >
          <div className="flex items-center gap-1.5 pl-1 shrink-0">
            <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="text-xs font-semibold text-md-on-surface hidden xs:inline">Import Share Token:</span>
          </div>
          <input
            type="text"
            value={shareHashInput}
            onChange={(e) => setShareHashInput(e.target.value)}
            placeholder="Paste share token..."
            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-md-surface-container-lowest border border-md-outline-variant text-xs font-mono text-md-on-surface placeholder:text-md-outline focus:outline-none focus:border-md-primary"
          />
          <button
            type="submit"
            disabled={!shareHashInput.trim()}
            className="px-3.5 sm:px-4 py-2 rounded-lg bg-md-primary hover:brightness-95 text-md-on-primary text-xs font-semibold whitespace-nowrap transition-all active:scale-95 disabled:opacity-40 cursor-pointer shrink-0"
          >
            Import File
          </button>
        </form>
      )}
    </div>
  );
}
