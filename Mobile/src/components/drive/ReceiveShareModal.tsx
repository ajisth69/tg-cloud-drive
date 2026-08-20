import { useState, useEffect, useRef } from "react";
import type { DriveFile, DriveConfig, TopicFolder } from "../../types";
import { formatBytes } from "../../lib/manifest";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { FileIcon } from "./FileIcon";
import { BOT_USERNAME } from "../../lib/bot";

interface ReceiveShareModalProps {
  initialHash?: string;
  workerUrl: string;
  driveConfig?: DriveConfig | null;
  topics?: TopicFolder[];
  activeFolderId?: number | null;
  onClose: () => void;
  onSuccess?: (topicId?: number | null) => void;
}

function formatTtl(seconds: number): string {
  if (seconds <= 0) return "Never";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? "s" : ""}`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} min`;
}

export function ReceiveShareModal({
  initialHash = "",
  workerUrl,
  driveConfig,
  topics = [],
  activeFolderId,
  onClose,
  onSuccess,
}: ReceiveShareModalProps) {
  const [hash, setHash] = useState(initialHash);
  const [loading, setLoading] = useState(false);
  const [sendingBotMsg, setSendingBotMsg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [sharedFile, setSharedFile] = useState<DriveFile | null>(null);
  const [senderInfo, setSenderInfo] = useState<string | null>(null);
  const [ttlRemaining, setTtlRemaining] = useState<number | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(
    activeFolderId ?? (topics.length > 0 ? topics[0].id : null)
  );

  const [isFolderDropdownOpen, setIsFolderDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialHash) {
      handleFetchFile(initialHash);
    }
  }, [initialHash]);

  useEffect(() => {
    if (activeFolderId) {
      setSelectedTopicId(activeFolderId);
    } else if (topics.length > 0 && selectedTopicId === null) {
      setSelectedTopicId(topics[0].id);
    }
  }, [activeFolderId, topics]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsFolderDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleFetchFile = async (targetHash: string) => {
    const cleanHash = targetHash.trim();
    if (!cleanHash) {
      setError("Please enter a valid share token hash or link.");
      return;
    }

    const effectiveWorkerUrl = workerUrl?.trim() || "https://clashdrive.clashgram.workers.dev";
    setLoading(true);
    setError(null);
    setSharedFile(null);
    setSuccessMsg(null);

    try {
      const cleanUrl = effectiveWorkerUrl.replace(/\/$/, "");
      const res = await fetch(`${cleanUrl}/api/share?hash=${cleanHash}`);
      const result = await res.json();

      if (result.ok && result.data && result.data.file) {
        setSharedFile(result.data.file);
        setSenderInfo(result.data.sender || "ClashDrive User");
        setTtlRemaining(result.ttlRemaining ?? -1);
      } else {
        setError(result.error || "Share token not found or expired.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to fetch shared file data.");
    } finally {
      setLoading(false);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const match = text.match(/share=([a-f0-9]{12}(?:\.[A-Za-z0-9_-]+)?)/i) || text.match(/([a-f0-9]{12}(?:\.[A-Za-z0-9_-]+)?)/i);
      const extractedHash = match ? match[1] : text.trim();
      if (extractedHash) {
        setHash(extractedHash);
        handleFetchFile(extractedHash);
      }
    } catch {
      setError("Clipboard read permission denied.");
    }
  };

  const handleSendViaBot = async () => {
    const effectiveWorkerUrl = workerUrl?.trim() || "https://clashdrive.clashgram.workers.dev";
    if (!hash || !effectiveWorkerUrl || !driveConfig?.chatId) {
      setError("Active Drive chat configuration is required to send via bot.");
      return;
    }

    setSendingBotMsg(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const cleanUrl = effectiveWorkerUrl.replace(/\/$/, "");
      const res = await fetch(`${cleanUrl}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hash: hash.trim(),
          targetChatId: driveConfig.chatId,
          topicId: selectedTopicId,
        }),
      });

      const result = await res.json();
      if (result.ok) {
        const folderName = topics.find((t) => t.id === selectedTopicId)?.title || "your folder";
        setSuccessMsg(`File saved & forwarded to "${folderName}" via @${BOT_USERNAME}!`);
        if (onSuccess) {
          onSuccess(selectedTopicId);
        }
        setTimeout(() => {
          onClose();
        }, 1500);
      } else {
        setError(result.error || "Failed to send file via Telegram Bot.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to send request to file sharing service.");
    } finally {
      setSendingBotMsg(false);
    }
  };

  const selectedTopicFolder = topics.find((t) => t.id === selectedTopicId) || topics[0];

  return (
    <Modal open={true} onClose={onClose} sheet noPadding>
      <div className="flex flex-col max-h-[calc(92dvh_-_28px)] bottom-nav-safe select-none">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-2 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-md-on-surface">Redeem Shared File</h2>
            <p className="text-[10px] text-md-on-surface-variant font-medium mt-0.5">
              Claim a file shared by another user
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-highest transition-all flex items-center justify-center cursor-pointer active:scale-90 shrink-0 focus-visible:ring-2 focus-visible:ring-md-primary outline-none"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5 scrollbar-thin">
          {/* Input Hash Section */}
          <div>
            <div className="flex items-center justify-between mb-2.5 px-1">
              <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-md-on-surface-variant">
                Share Token Hash or Link
              </label>
              <button
                onClick={handlePasteFromClipboard}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-md-primary-container/60 text-[11px] font-bold text-md-on-primary-container hover:bg-md-primary-container transition-all cursor-pointer active:scale-95"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Paste
              </button>
            </div>

            <div className="rounded-3xl bg-md-surface-container border border-md-outline-variant/20 p-3.5 space-y-2.5">
              <input
                type="text"
                value={hash}
                onChange={(e) => setHash(e.target.value)}
                placeholder="Paste 12-character token hash or link..."
                className="w-full px-4 py-3 rounded-2xl bg-md-surface-container-lowest border border-md-outline-variant text-xs font-mono text-md-on-surface placeholder:text-md-outline focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/15 transition-all"
              />
              <Button
                variant="primary"
                onClick={() => handleFetchFile(hash)}
                disabled={loading || !hash.trim()}
                loading={loading}
                className="w-full justify-center"
              >
                Fetch Shared File
              </Button>
            </div>
          </div>

          {/* Error / Success Messages */}
          {error && (
            <div className="p-3.5 rounded-2xl bg-md-error-container text-xs text-md-on-error-container font-medium flex items-center gap-2.5 animate-slide-down">
              <span className="w-6 h-6 rounded-full bg-md-error text-md-on-error flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </span>
              {error}
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-2xl bg-success-container text-xs text-on-success-container font-medium flex items-center gap-2.5 animate-slide-down">
              <span className="w-6 h-6 rounded-full bg-success text-on-success flex items-center justify-center shrink-0">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              {successMsg}
            </div>
          )}

          {/* Shared File Details Card */}
          {sharedFile && (
            <div className="space-y-4 animate-scale-in">
              <div className="rounded-3xl bg-md-surface-container border border-md-outline-variant/20 p-4 space-y-3.5">
                <div className="flex items-center gap-3.5">
                  <FileIcon fileName={sharedFile.name} className="w-12 h-12 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-md-on-surface truncate" title={sharedFile.name}>
                      {sharedFile.name}
                    </h3>
                    <p className="text-xs text-md-on-surface-variant mt-1 font-medium flex items-center gap-1.5 flex-wrap">
                      <span>
                        Size: <strong className="text-md-on-surface">{formatBytes(sharedFile.size)}</strong>
                      </span>
                      <span className="text-md-outline">•</span>
                      <span>
                        Shared by: <strong className="text-md-primary">{senderInfo}</strong>
                      </span>
                    </p>
                  </div>
                </div>

                {ttlRemaining !== null && ttlRemaining !== -1 && (
                  <div className="pt-3 border-t border-md-outline-variant/20 flex items-center justify-between text-xs text-md-on-surface-variant">
                    <span className="flex items-center gap-1.5 font-medium">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Expiration Status
                    </span>
                    <span className="font-semibold font-mono text-warning bg-warning-container px-2.5 py-1 rounded-lg">
                      {ttlRemaining > 0 ? `Expires in ${formatTtl(ttlRemaining)}` : "Expires Soon"}
                    </span>
                  </div>
                )}
              </div>

              {/* Folder Dropdown Selector */}
              {topics.length > 0 && (
                <div className="relative" ref={dropdownRef}>
                  <div className="flex items-center justify-between mb-2.5 px-1">
                    <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-md-on-surface-variant">
                      Save to Destination Folder
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsFolderDropdownOpen(!isFolderDropdownOpen)}
                    className={`w-full px-4 py-3.5 rounded-3xl bg-md-surface-container border text-xs font-semibold text-md-on-surface flex items-center justify-between transition-all cursor-pointer ${
                      isFolderDropdownOpen
                        ? "border-md-primary ring-2 ring-md-primary/15"
                        : "border-md-outline-variant/20 hover:border-md-primary"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-xl bg-md-secondary-container text-md-on-secondary-container flex items-center justify-center shrink-0">
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                      </span>
                      <span className="truncate text-md-on-surface font-semibold">
                        {selectedTopicFolder ? selectedTopicFolder.title : "Select Folder"}
                      </span>
                    </div>
                    <svg
                      className={`w-4 h-4 text-md-on-surface-variant transition-transform duration-200 shrink-0 ${
                        isFolderDropdownOpen ? "rotate-180 text-md-primary" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {isFolderDropdownOpen && (
                    <div
                      className="absolute left-0 right-0 bottom-full mb-2 z-50 bg-md-surface-container border border-md-outline-variant/30 rounded-2xl p-1.5 space-y-1 max-h-48 overflow-y-auto scrollbar-thin animate-scale-in"
                      style={{ boxShadow: "var(--md-elevation-2)" }}
                    >
                      {topics.map((t) => {
                        const isSelected = t.id === selectedTopicId;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setSelectedTopicId(t.id);
                              setIsFolderDropdownOpen(false);
                            }}
                            className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between cursor-pointer ${
                              isSelected
                                ? "bg-md-secondary-container text-md-on-secondary-container"
                                : "text-md-on-surface hover:bg-md-surface-container-high"
                            }`}
                          >
                            <div className="flex items-center gap-3 truncate">
                              <span className="w-7 h-7 rounded-lg bg-md-surface-container-lowest text-md-on-surface-variant flex items-center justify-center shrink-0">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                                </svg>
                              </span>
                              <span className="truncate">{t.title}</span>
                            </div>
                            {isSelected && (
                              <svg className="w-4 h-4 text-md-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <Button
                variant="primary"
                onClick={handleSendViaBot}
                disabled={sendingBotMsg}
                loading={sendingBotMsg}
                className="w-full justify-center"
                size="lg"
              >
                Save to Folder via Bot
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}