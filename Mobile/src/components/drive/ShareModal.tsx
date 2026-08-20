import React, { useState } from "react";
import type { DriveFile, DriveConfig } from "../../types";
import { formatBytes } from "../../lib/manifest";
import { DEFAULT_WORKER_URL } from "../../lib/bot";
import { nativeShareText, copyText } from "../../lib/native";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

interface ShareModalProps {
  file: DriveFile | null;
  driveConfig: DriveConfig | null;
  onClose: () => void;
}

const EXPIRY_OPTIONS = [
  { label: "Never (Lifetime)", value: 0 },
  { label: "1 Hour", value: 3600 },
  { label: "24 Hours", value: 86400 },
  { label: "7 Days", value: 604800 },
];

const SHARE_BASE_URL = "https://clashdrive.pages.dev";

export function ShareModal({
  file,
  driveConfig,
  onClose,
}: ShareModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareHash, setShareHash] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [ttlSeconds, setTtlSeconds] = useState<number>(0);
  const [activeTab, setActiveTab] = useState<"share" | "qr">("share");

  if (!file) return null;

  const handleGenerateShare = async () => {
    setLoading(true);
    setError(null);

    try {
      const cleanUrl = DEFAULT_WORKER_URL.replace(/\/$/, "");
      const res = await fetch(`${cleanUrl}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: driveConfig?.chatId,
          file: {
            ...file,
            chatId: driveConfig?.chatId,
          },
          ttlSeconds,
          senderInfo: "ClashDrive User",
        }),
      });

      const data = await res.json();
      if (data.ok && (data.fullToken || data.hash)) {
        setShareHash(data.fullToken || data.hash);
      } else {
        setError(data.error || "Failed to generate share hash");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to connect to file sharing service");
    } finally {
      setLoading(false);
    }
  };

  const getShareLink = () => {
    if (!shareHash) return "";
    return `${SHARE_BASE_URL}?share=${shareHash}`;
  };

  const handleCopyLink = () => {
    const link = getShareLink();
    copyText(link);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyHash = () => {
    if (shareHash) {
      copyText(shareHash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const qrCodeDataUrl = shareHash
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(getShareLink())}&color=005cbb`
    : "";

  return (
    <Modal open={Boolean(file)} onClose={onClose} sheet title="File Sharing">
      <div className="space-y-5 select-none">
        {/* Selected File Details */}
        <div className="p-3.5 rounded-2xl bg-md-surface-container border border-md-outline-variant/20 flex items-center justify-between">
          <div className="min-w-0 pr-3">
            <p className="text-xs font-bold text-md-on-surface truncate" title={file.name}>
              {file.name}
            </p>
            <p className="text-[11px] font-medium text-md-on-surface-variant mt-0.5">
              Size: {formatBytes(file.size)}
            </p>
          </div>
          <span className="px-2.5 py-1 text-[10px] font-mono font-semibold uppercase bg-md-primary-container text-md-on-primary-container rounded-xl shrink-0">
            {file.name.split(".").pop() || "file"}
          </span>
        </div>

        {/* Expiration Selector before generating */}
        {!shareHash && (
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-md-on-surface-variant">
              Link Expiration Period
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {EXPIRY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTtlSeconds(opt.value)}
                  className={`py-2.5 px-3 rounded-full text-xs font-medium transition-all cursor-pointer min-h-[36px] ${
                    ttlSeconds === opt.value
                      ? "bg-md-primary text-md-on-primary font-semibold"
                      : "bg-md-surface-container-high text-md-on-surface hover:bg-md-surface-container-highest"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-3.5 rounded-2xl bg-md-error-container text-xs text-md-on-error-container font-medium flex items-center gap-2.5 animate-slide-down">
            <span>⚠️</span> {error}
          </div>
        )}

        {/* Share Output Tabs */}
        {shareHash ? (
          <div className="space-y-4 animate-scale-in">
            {/* M3 Segmented Button Tabs */}
            <div className="flex bg-md-surface-container-high p-1 rounded-full border border-md-outline-variant/20">
              <button
                onClick={() => setActiveTab("share")}
                className={`flex-1 py-2 rounded-full text-xs font-medium transition-all cursor-pointer ${
                  activeTab === "share"
                    ? "bg-md-surface-container-lowest text-md-primary font-semibold"
                    : "text-md-on-surface-variant hover:text-md-on-surface"
                }`}
              >
                Share Link & Hash
              </button>
              <button
                onClick={() => setActiveTab("qr")}
                className={`flex-1 py-2 rounded-full text-xs font-medium transition-all cursor-pointer ${
                  activeTab === "qr"
                    ? "bg-md-surface-container-lowest text-md-primary font-semibold"
                    : "text-md-on-surface-variant hover:text-md-on-surface"
                }`}
              >
                QR Code
              </button>
            </div>

            {/* Tab: Share Link & Token */}
            {activeTab === "share" && (
              <div className="p-4 rounded-2xl bg-md-surface-container border border-md-outline-variant/30 space-y-3.5">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-md-primary">
                    12-Character Token Hash
                  </span>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-1">
                    <code className="flex-grow p-3 rounded-xl bg-md-surface-container-lowest border border-md-primary/30 text-xs font-mono text-md-primary font-semibold text-center select-all">
                      {shareHash}
                    </code>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleCopyHash}
                      className="shrink-0"
                    >
                      {copiedHash ? "Copied!" : "Copy Hash"}
                    </Button>
                  </div>
                </div>

                <div className="pt-3 border-t border-md-outline-variant/20">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-md-on-surface-variant">
                    Direct Web Link
                  </span>
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-1">
                    <input
                      type="text"
                      readOnly
                      value={getShareLink()}
                      className="flex-grow px-4 py-3 rounded-xl bg-md-surface-container-lowest border border-md-outline-variant text-xs font-mono text-md-on-surface focus:outline-none select-all"
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleCopyLink}
                      className="shrink-0"
                    >
                      {copiedLink ? "Copied!" : "Copy Link"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Tab: QR Code */}
            {activeTab === "qr" && (
              <div className="p-4 rounded-2xl bg-md-surface-container border border-md-outline-variant/20 flex flex-col items-center justify-center gap-3">
                <img
                  src={qrCodeDataUrl}
                  alt="Share Link QR Code"
                  className="w-44 h-44 rounded-xl border border-md-outline-variant/30 p-2 bg-white"
                />
                <p className="text-xs text-md-on-surface-variant font-medium text-center">
                  Scan QR code with phone camera to download file instantly.
                </p>
              </div>
            )}

            {/* Native Share Button — opens system share sheet on mobile */}
            <button
              onClick={async () => {
                const link = getShareLink();
                const text = `Check out this file on ClashDrive: ${file.name}\n${link}`;
                const shared = await nativeShareText(text, file.name);
                if (!shared && typeof navigator !== "undefined" && "share" in navigator) {
                  try {
                    await navigator.share({ title: file.name, text, url: link });
                  } catch {
                    /* user cancelled */
                  }
                }
              }}
              className="w-full py-3 rounded-lg bg-md-surface-container-high border border-md-outline-variant/30 text-md-on-surface text-xs font-semibold hover:bg-md-surface-container-highest transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share with Apps
            </button>

            {/* Telegram Share Button — M3 tertiary role */}
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(getShareLink())}&text=${encodeURIComponent(`Check out this file on ClashDrive: ${file.name}`)}`}
              target="_blank"
              rel="noreferrer"
              className="w-full py-3 rounded-lg bg-md-tertiary text-md-on-tertiary text-xs font-semibold hover:brightness-95 transition-all flex items-center justify-center gap-2"
            >
              <svg className="w-4.5 h-4.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.03-1.99 1.27-5.62 3.72-.53.36-1.01.54-1.44.53-.47-.01-1.38-.27-2.05-.49-.83-.27-1.49-.42-1.43-.89.03-.25.38-.51 1.07-.78 4.19-1.82 6.98-3.02 8.37-3.6 3.98-1.65 4.81-1.94 5.35-1.95.12 0 .38.03.55.17.14.12.18.28.2.46-.02.07-.02.16-.04.29z"/>
              </svg>
              Share via Telegram
            </a>
          </div>
        ) : (
          <Button
            variant="primary"
            onClick={handleGenerateShare}
            disabled={loading}
            loading={loading}
            className="w-full justify-center"
            size="lg"
          >
            Generate Share Link & Token
          </Button>
        )}
      </div>
    </Modal>
  );
}
