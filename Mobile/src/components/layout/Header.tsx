import { useState, useRef, useEffect } from "react";
import type { UserProfile, SavedAccount } from "../../types";
import type { Theme } from "../../hooks/useTheme";

interface HeaderProps {
  driveTitle: string;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  userProfile: UserProfile | null;
  accounts: SavedAccount[];
  activeAccountId: string | null;
  onSwitchAccount: (userId: string) => void;
  onRemoveAccount: (userId: string) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onMenuClick?: () => void;
  onOpenReceiveShare?: () => void;
  fileSharingEnabled?: boolean;
  onToggleFileSharing?: () => void;
  onJoinUpdateChannel?: () => void | Promise<void>;
  joiningChannel?: boolean;
  onClearCache?: () => void | Promise<void>;
  onOpenSettingsModal?: () => void;
}

export function Header({
  driveTitle,
  searchQuery,
  onSearchChange,
  userProfile,
  accounts,
  activeAccountId,
  onSwitchAccount,
  onRemoveAccount,
  onMenuClick,
  onOpenSettingsModal,
}: HeaderProps) {
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Keyboard shortcut
  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const initials = userProfile?.firstName ? userProfile.firstName.charAt(0).toUpperCase() : "U";
  const displayName = userProfile
    ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(" ")
    : "Telegram User";

  return (
    <header className="sticky top-0 z-40 bg-md-surface-container border-b border-md-outline-variant/20" style={{ paddingTop: "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))", paddingLeft: "var(--safe-area-inset-left, env(safe-area-inset-left, 0px))", paddingRight: "var(--safe-area-inset-right, env(safe-area-inset-right, 0px))" }}>
      <div className="flex items-center justify-between px-3 sm:px-4 lg:px-6 min-h-14 gap-1.5">
        {/* Hamburger (mobile) */}
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="anymex-icon-btn cursor-pointer shrink-0"
            title="Open Menu"
          >
            <svg className="w-5.5 h-5.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}

        {/* Search bar — always visible, the header centerpiece (AnymeX style) */}
        <div className="flex-1 min-w-0 flex items-center gap-2 anymex-input px-3.5 h-10">
          <svg className="w-4 h-4 text-md-on-surface-variant shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchRef}
            placeholder="Search in drive"
            aria-label={`Search ${driveTitle}`}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="flex-1 min-w-0 bg-transparent outline-none text-sm text-md-on-surface placeholder:text-md-outline"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange("")}
              className="w-6 h-6 rounded-full bg-md-surface-container-highest text-md-on-surface-variant flex items-center justify-center cursor-pointer shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          {/* Account avatar */}
          <div className="relative" ref={accountMenuRef}>
            <button
              onClick={() => setShowAccountMenu((v) => !v)}
              className="w-11 h-11 rounded-full hover:bg-md-surface-container-high transition-all cursor-pointer flex items-center justify-center shrink-0"
              title="Account"
            >
              {userProfile?.avatarUrl ? (
                <img
                  src={userProfile.avatarUrl}
                  alt={displayName}
                  className="w-9 h-9 rounded-full object-cover ring-1 ring-md-outline-variant"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-md-primary-container text-md-on-primary-container font-semibold text-xs flex items-center justify-center">
                  {initials}
                </div>
              )}
            </button>

            {showAccountMenu && (
              <div
                className="absolute right-0 top-11 z-50 bg-md-surface-container rounded-2xl p-2 w-72 max-w-[calc(100vw_-_1.5rem)] animate-scale-in border border-md-outline-variant/20 select-none"
                style={{ boxShadow: "var(--md-elevation-2)" }}
              >
                <div className="px-3 py-2.5 border-b border-md-outline-variant/20 mb-1.5">
                  <p className="text-xs font-semibold text-md-on-surface truncate">{displayName}</p>
                  <p className="text-[10px] text-md-on-surface-variant font-medium truncate mt-0.5">
                    @{userProfile?.username || "telegram_user"}
                  </p>
                </div>

                <p className="text-[10px] uppercase font-bold tracking-wide text-md-on-surface-variant px-3 pt-1.5 pb-1">
                  Accounts
                </p>
                <div className="space-y-0.5">
                  {accounts.map((acc) => (
                    <div
                      key={acc.userId}
                      className={`flex items-center rounded-xl transition-all ${
                        acc.userId === activeAccountId ? "bg-md-secondary-container" : "hover:bg-md-surface-container-high"
                      }`}
                    >
                      <button
                        onClick={() => {
                          onSwitchAccount(acc.userId);
                          setShowAccountMenu(false);
                        }}
                        className="flex items-center gap-2.5 px-3 py-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="w-7 h-7 rounded-full bg-md-primary-container text-md-on-primary-container font-semibold text-[11px] flex items-center justify-center shrink-0">
                          {acc.idName ? acc.idName.charAt(0).toUpperCase() : "U"}
                        </div>
                        <span className="text-xs font-medium truncate text-md-on-surface">
                          {acc.idName || acc.username}
                        </span>
                      </button>
                      <div className="w-9 h-9 flex items-center justify-center shrink-0">
                        {acc.userId === activeAccountId ? (
                          <svg className="w-4 h-4 text-md-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : accounts.length > 1 ? (
                          <button
                            onClick={() => onRemoveAccount(acc.userId)}
                            className="p-1.5 text-md-on-surface-variant hover:text-md-error hover:bg-md-error-container/20 rounded-lg transition-colors cursor-pointer"
                            title="Remove Account"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-1.5 mt-1.5 border-t border-md-outline-variant/20">
                  <button
                    onClick={() => {
                      setShowAccountMenu(false);
                      onOpenSettingsModal?.();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-md-surface-container-high transition-colors cursor-pointer"
                  >
                    <div className="w-7 h-7 rounded-full bg-md-surface-container-high text-md-on-surface-variant flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <span className="text-xs font-medium text-md-on-surface">Settings</span>
                    <svg className="w-4 h-4 text-md-on-surface-variant shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}