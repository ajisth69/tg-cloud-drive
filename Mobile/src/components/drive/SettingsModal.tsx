import { useState } from "react";
import { Modal } from "../ui/Modal";
import { APP_VERSION } from "../../config/telegram";
import { formatBytes } from "../../lib/manifest";
import type { UserProfile, SavedAccount, DriveFile } from "../../types";
import type { Theme } from "../../hooks/useTheme";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  userProfile: UserProfile | null;
  accounts: SavedAccount[];
  activeAccountId: string | null;
  allFiles: DriveFile[];
  onAddAccount: () => void;
  onSwitchAccount: (userId: string) => void;
  onRemoveAccount: (userId: string) => void;
  onLogout: () => void;
  onClearCache?: () => void | Promise<void>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  fileSharingEnabled?: boolean;
  onToggleFileSharing?: () => void;
  onJoinUpdateChannel?: () => void | Promise<void>;
  joiningChannel?: boolean;
}

export function SettingsModal({
  open,
  onClose,
  userProfile,
  accounts,
  allFiles,
  onAddAccount,
  onLogout,
  onClearCache,
  theme,
  setTheme,
  fileSharingEnabled = false,
  onToggleFileSharing,
  onJoinUpdateChannel,
  joiningChannel = false,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"profile" | "display">("profile");

  if (!open) return null;

  const totalFiles = allFiles.length;
  const imageCount = allFiles.filter((f) => {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    return f.mimeType?.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext);
  }).length;

  const videoCount = allFiles.filter((f) => {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    return f.mimeType?.startsWith("video/") || ["mp4", "webm", "mkv", "mov", "avi"].includes(ext);
  }).length;

  const totalStorage = allFiles.reduce((acc, f) => acc + (f.size || 0), 0);

  const displayName = userProfile
    ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(" ")
    : "Telegram User";

  const usernameText = userProfile?.username ? `@${userProfile.username}` : "—";

  const initials = userProfile?.firstName
    ? userProfile.firstName.charAt(0).toUpperCase()
    : "U";

  const tabItems = [
    { id: "profile" as const, label: "Profile", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
    { id: "display" as const, label: "Display", icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" },
  ];

  const statCards = [
    {
      label: "FILES",
      value: String(totalFiles),
      icon: "M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z",
      color: "text-md-on-surface-variant",
    },
    {
      label: "IMAGES",
      value: String(imageCount),
      icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z",
      color: "text-success",
    },
    {
      label: "VIDEOS",
      value: String(videoCount),
      icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z",
      color: "text-md-tertiary",
    },
    {
      label: "STORAGE",
      value: formatBytes(totalStorage),
      icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4",
      color: "text-md-primary",
    },
  ];

  const themeOptions = [
    { id: "light" as const, label: "Light", icon: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" },
    { id: "dark" as const, label: "Dark", icon: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" },
    { id: "system" as const, label: "System", icon: "M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7" },
  ];

  return (
    <Modal open={open} onClose={onClose} sheet noPadding>
      <div className="flex flex-col max-h-[calc(92dvh_-_28px)] bottom-nav-safe">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-2 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-md-on-surface">Settings</h2>
            <p className="text-[10px] text-md-on-surface-variant font-medium mt-0.5">
              ClashDrive v{APP_VERSION}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-highest transition-all flex items-center justify-center cursor-pointer active:scale-90 shrink-0 focus-visible:ring-2 focus-visible:ring-md-primary outline-none"
            aria-label="Close settings"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Segmented tabs */}
        <div className="px-5 pb-3 shrink-0">
          <div className="flex bg-md-surface-container rounded-full p-1 gap-1 select-none">
            {tabItems.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-pressed={activeTab === tab.id}
                className={`flex-1 flex items-center justify-center gap-1.5 h-9 rounded-full text-xs font-semibold transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-md-primary outline-none ${
                  activeTab === tab.id
                    ? "bg-md-primary text-md-on-primary shadow-sm"
                    : "text-md-on-surface-variant hover:text-md-on-surface"
                }`}
              >
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={tab.icon} />
                </svg>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="h-[320px] overflow-y-auto px-5 pb-4 space-y-6 scrollbar-thin">
          {activeTab === "profile" ? (
            <>
              {/* User card */}
              <div className="flex items-center gap-4 rounded-3xl bg-md-surface-container border border-md-outline-variant/20 p-4 select-none">
                {userProfile?.photoUrl || userProfile?.avatarUrl ? (
                  <img
                    src={(userProfile.photoUrl || userProfile.avatarUrl)!}
                    alt={displayName}
                    className="w-16 h-16 rounded-2xl object-cover ring-2 ring-md-primary/25 shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-md-primary-container text-md-on-primary-container font-bold text-2xl flex items-center justify-center shrink-0">
                    {initials}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-base font-bold text-md-on-surface tracking-tight truncate">
                      {displayName}
                    </h3>
                    <span className="w-2 h-2 rounded-full bg-success shrink-0" title="Active Now" />
                  </div>
                  <p className="text-xs font-semibold text-md-primary mt-0.5 truncate">{usernameText}</p>
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-success bg-success/10 px-2 py-1 rounded-full mt-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                    Active Session
                  </span>
                </div>
              </div>

              {/* Cloud library stats */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-md-on-surface-variant px-1 mb-2.5">
                  Cloud Library
                </h4>
                <div className="grid grid-cols-2 gap-2.5">
                  {statCards.map((card) => (
                    <div
                      key={card.label}
                      className="rounded-2xl bg-md-surface-container border border-md-outline-variant/20 p-3.5 flex items-center gap-3 select-none"
                    >
                      <div className="w-9 h-9 rounded-xl bg-md-surface-container-high flex items-center justify-center shrink-0">
                        <svg className={`w-4.5 h-4.5 ${card.color}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d={card.icon} />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-md-on-surface tracking-tight truncate">{card.value}</p>
                        <p className="text-[9px] font-bold uppercase tracking-wider text-md-on-surface-variant mt-0.5">
                          {card.label}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </>
          ) : (
            <>
              {/* Appearance */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-md-on-surface-variant px-1 mb-2.5">
                  Appearance
                </h4>
                <div className="grid grid-cols-3 gap-2.5">
                  {themeOptions.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setTheme(item.id)}
                      aria-pressed={theme === item.id}
                      className={`rounded-2xl py-3.5 flex flex-col items-center gap-2 border transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-md-primary outline-none ${
                        theme === item.id
                          ? "bg-md-secondary-container text-md-on-secondary-container border-transparent font-semibold"
                          : "bg-md-surface-container border-md-outline-variant/20 text-md-on-surface hover:bg-md-surface-container-high"
                      }`}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                      </svg>
                      <span className="text-xs">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Network & sharing */}
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-md-on-surface-variant px-1 mb-2.5">
                  Network & Sharing
                </h4>
                <div className="rounded-2xl bg-md-surface-container border border-md-outline-variant/20 divide-y divide-md-outline-variant/15 select-none">
                  {onJoinUpdateChannel && (
                    <button
                      onClick={onJoinUpdateChannel}
                      disabled={joiningChannel}
                      className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[56px] text-left hover:bg-md-surface-container-high transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
                    >
                      <div className="w-9 h-9 rounded-xl bg-md-primary-container text-md-on-primary-container flex items-center justify-center shrink-0">
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-md-on-surface truncate">
                          {joiningChannel ? "Joining..." : "Join Updates Channel"}
                        </p>
                        <p className="text-[10px] text-md-on-surface-variant font-medium mt-0.5 truncate">
                          Get the latest ClashDrive news
                        </p>
                      </div>
                      <span className="text-[10px] font-mono font-semibold text-md-primary bg-md-primary-container px-2 py-1 rounded-md shrink-0">
                        @clashgramclient
                      </span>
                    </button>
                  )}

                  {onToggleFileSharing && (
                    <div className="flex items-center gap-3 px-4 py-3.5 min-h-[56px]">
                      <div className="w-9 h-9 rounded-xl bg-md-primary-container text-md-on-primary-container flex items-center justify-center shrink-0">
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-md-on-surface">File Sharing Mode</p>
                        <p className="text-[10px] text-md-on-surface-variant font-medium mt-0.5">
                          Auto-invite worker bot for instant links
                        </p>
                      </div>
                      <button
                        onClick={onToggleFileSharing}
                        role="switch"
                        aria-checked={fileSharingEnabled}
                        className={`w-[52px] h-[32px] rounded-full transition-colors relative cursor-pointer shrink-0 border-2 focus-visible:ring-2 focus-visible:ring-md-primary outline-none ${
                          fileSharingEnabled
                            ? "bg-md-primary border-md-primary"
                            : "bg-md-surface-container-highest border-md-outline"
                        }`}
                      >
                        <div
                          className={`rounded-full bg-white transition-all absolute top-1/2 -translate-y-1/2 ${
                            fileSharingEnabled
                              ? "w-6 h-6 left-[24px]"
                              : "w-4 h-4 left-[6px]"
                          }`}
                          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }}
                        />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer actions — always visible */}
        <div className="shrink-0 px-5 pt-3 pb-[calc(var(--safe-area-inset-bottom,_env(safe-area-inset-bottom,_0px))_+_16px)] border-t border-md-outline-variant/15 bg-md-surface-container-high space-y-2.5">
          <button
            onClick={() => {
              onClose();
              onAddAccount();
            }}
            className="w-full flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-2xl bg-md-surface-container-highest hover:bg-md-surface-container text-md-on-surface text-xs font-semibold border border-md-outline-variant/20 transition-all cursor-pointer active:scale-[0.98]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m0 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
            </svg>
            Add Account ({accounts.length}/3)
          </button>

          <button
            onClick={() => {
              onClose();
              if (onClearCache) {
                onClearCache();
              } else {
                onLogout();
              }
            }}
            className="w-full flex items-center justify-center gap-2 min-h-[48px] px-4 rounded-2xl bg-md-error-container text-md-on-error-container hover:brightness-95 text-xs font-semibold transition-all cursor-pointer active:scale-[0.98]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
            </svg>
            Sign Out
          </button>
        </div>
      </div>
    </Modal>
  );
}