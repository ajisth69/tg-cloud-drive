import { useCallback, useRef, useState } from "react";
import { TelegramClient } from "@mtcute/web";
import { getApiCredentials, LS_PHONE, LS_SESSION } from "../config/telegram";
import {
  createClientFromSession,
  destroyClient,
  destroyHelperClients,
  ensureConnected,
  getCurrentSessionString,
  hasPersistedSession,
  persistSession,
  setClient,
  startConnectionMonitor,
} from "../lib/client";

import type { AuthState, SavedAccount, UserProfile } from "../types";

const LS_ACCOUNTS = "tgcd_accounts";
const LS_ACTIVE_ACCOUNT = "tgcd_active_account";

function readAccounts(): SavedAccount[] {
  try {
    return JSON.parse(localStorage.getItem(LS_ACCOUNTS) || "[]").slice(0, 3);
  } catch {
    return [];
  }
}

function writeAccounts(accounts: SavedAccount[]) {
  localStorage.setItem(LS_ACCOUNTS, JSON.stringify(accounts.slice(0, 3)));
}

function profileName(profile: UserProfile) {
  return (
    [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
    profile.username ||
    profile.id
  );
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Something went wrong";
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    step: "credentials",
    phone: localStorage.getItem(LS_PHONE) || "",
    loading: false,
    error: null,
  });
  const [connected, setConnected] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [accounts, setAccounts] = useState<SavedAccount[]>(() => readAccounts());
  const [activeAccountId, setActiveAccountId] = useState<string | null>(
    () => localStorage.getItem(LS_ACTIVE_ACCOUNT)
  );
  const clientRef = useRef<TelegramClient | null>(null);
  const phoneCodeResolve = useRef<((code: string) => void) | null>(null);
  const passwordResolve = useRef<((pwd: string) => void) | null>(null);

  const extractProfile = useCallback(async (client: TelegramClient) => {
    const me = await client.getMe();
    let avatarUrl: string | null = null;
    try {
      if (me.photo) {
        const buffer = await client.downloadAsBuffer(me.photo.big);
        if (buffer && buffer.length > 0) {
          avatarUrl = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }));
        }
      }
    } catch (e) {
      console.warn("Could not download profile photo", e);
    }

    return {
      id: me.id.toString(),
      firstName: me.firstName || "",
      lastName: me.lastName || "",
      username: me.username || "",
      avatarUrl,
    } satisfies UserProfile;
  }, []);

  const rememberAccount = useCallback(
    async (profile: UserProfile, session: string) => {
      const { apiId, apiHash } = getApiCredentials();
      const current = readAccounts();
      const existing = current.find((account) => account.userId === profile.id);

      const validSession =
        session && session.length > 10
          ? session
          : existing?.session || localStorage.getItem(LS_SESSION) || "";

      if (!validSession || validSession.length < 10) return;

      const saved: SavedAccount = {
        userId: profile.id,
        session: validSession,
        username: profile.username,
        idName: profileName(profile),
        apiHash: existing?.apiHash || apiHash,
        apiId: existing?.apiId || apiId,
        avatarUrl: profile.avatarUrl || existing?.avatarUrl || null,
        updatedAt: Date.now(),
      };
      const next = [
        saved,
        ...current.filter((account) => account.userId !== saved.userId),
      ].slice(0, 3);

      writeAccounts(next);
      localStorage.setItem(LS_ACTIVE_ACCOUNT, saved.userId);
      localStorage.setItem(LS_SESSION, validSession);
      setAccounts(next);
      setActiveAccountId(saved.userId);
    },
    []
  );

  const tryAutoConnect = useCallback(async (): Promise<boolean> => {
    const localAccounts = readAccounts();
    const storedSession = localStorage.getItem(LS_SESSION) ?? "";

    const preferred =
      localAccounts.find((account) => account.userId === activeAccountId) ??
      localAccounts[0];

    const sessionToUse =
      preferred?.session && preferred.session.length > 10
        ? preferred.session
        : storedSession;

    if (!sessionToUse || sessionToUse.length < 10) return false;

    try {
      if (preferred) {
        localStorage.setItem("tgcd_api_id", preferred.apiId.toString());
        localStorage.setItem("tgcd_api_hash", preferred.apiHash);
      }
      const { apiId, apiHash } = getApiCredentials();
      const client = await createClientFromSession(
        sessionToUse,
        preferred?.apiId ?? apiId,
        preferred?.apiHash ?? apiHash
      );
      clientRef.current = client;
      setClient(client);

      let connectedOk = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await client.connect();
          connectedOk = true;
          break;
        } catch (connErr) {
          console.warn(`[AutoConnect] Connection attempt ${attempt}/3 failed:`, connErr);
          if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      if (!connectedOk) return false;

      const profile = await extractProfile(client);
      if (!profile.id) return false;

      const exportedSession = await persistSession();
      const finalSession = exportedSession || sessionToUse;

      await rememberAccount(profile, finalSession);
      startConnectionMonitor();
      setUserProfile(profile);
      setConnected(true);
      setState((s) => ({ ...s, step: "done" }));
      return true;
    } catch (err) {
      console.warn("Auto-connect attempt failed gracefully:", err);
      const errStr = String(err).toLowerCase();
      if (
        errStr.includes("auth_key_unregistered") ||
        errStr.includes("session_revoked") ||
        errStr.includes("user_deactivated")
      ) {
        console.warn("Session revoked by Telegram, clearing stored credentials.");
        await destroyClient();
      }
      return false;
    }
  }, [activeAccountId, extractProfile, rememberAccount]);

  const startAuth = useCallback(
    async (phone: string, apiId: number, apiHash: string) => {
      if (readAccounts().length >= 3) {
        setState((s) => ({
          ...s,
          loading: false,
          error: "You can keep up to 3 Telegram IDs. Remove one before adding another.",
        }));
        return;
      }

      setState((s) => ({ ...s, loading: true, error: null, phone }));
      localStorage.setItem(LS_PHONE, phone);
      localStorage.setItem("tgcd_api_id", apiId.toString());
      localStorage.setItem("tgcd_api_hash", apiHash);

      const client = await createClientFromSession("", apiId, apiHash);
      clientRef.current = client;
      setClient(client);

      try {
        await client.connect();
      } catch (err: unknown) {
        setState((s) => ({
          ...s,
          loading: false,
          error: `Connection failed: ${getErrorMessage(err)}`,
        }));
        return;
      }

      client
        .start({
          phone: () => Promise.resolve(phone),
          code: () => {
            setState((s) => ({ ...s, step: "otp", loading: false }));
            return new Promise<string>((resolve) => {
              phoneCodeResolve.current = resolve;
            });
          },
          password: () => {
            setState((s) => ({ ...s, step: "password", loading: false }));
            return new Promise<string>((resolve) => {
              passwordResolve.current = resolve;
            });
          },
        })
        .then(async () => {
          const sessionToken = await persistSession();
          const profile = await extractProfile(client);
          await rememberAccount(profile, sessionToken || getCurrentSessionString());
          startConnectionMonitor();
          await new Promise((r) => setTimeout(r, 500));
          await ensureConnected();
          setUserProfile(profile);
          setConnected(true);
          setState((s) => ({ ...s, step: "done", loading: false }));
        })
        .catch((err) => {
          setState((s) => ({ ...s, loading: false, error: getErrorMessage(err) }));
        });
    },
    [extractProfile, rememberAccount]
  );

  const goToPhone = useCallback((apiId: number, apiHash: string) => {
    setState((s) => ({ ...s, step: "phone", apiId, apiHash, error: null }));
  }, []);

  const goToCredentials = useCallback(() => {
    setState((s) => ({ ...s, step: "credentials", error: null }));
  }, []);

  const beginAddAccount = useCallback(async () => {
    if (readAccounts().length >= 3) {
      setState((s) => ({
        ...s,
        loading: false,
        error: "You can keep up to 3 Telegram IDs. Remove one before adding another.",
      }));
      return;
    }
    if (clientRef.current) {
      try {
        await clientRef.current.destroy();
      } catch { /* ignore */ }
      clientRef.current = null;
    }
    setConnected(false);
    setUserProfile(null);
    setState({ step: "credentials", phone: "", apiId: undefined, apiHash: undefined, loading: false, error: null });
  }, []);

  const switchAccount = useCallback(
    async (userId: string) => {
      const account = readAccounts().find((item) => item.userId === userId);
      if (!account || account.userId === activeAccountId) return;
      setState((s) => ({ ...s, loading: true, error: null }));
      if (clientRef.current) {
        try {
          await clientRef.current.destroy();
        } catch { /* ignore */ }
      }
      await destroyHelperClients();

      try {
        if (!account.session) {
          throw new Error("No local session found on this device. Please log in.");
        }
        localStorage.setItem("tgcd_api_id", account.apiId.toString());
        localStorage.setItem("tgcd_api_hash", account.apiHash);

        const client = await createClientFromSession(account.session, account.apiId, account.apiHash);
        setClient(client);
        clientRef.current = client;
        await client.connect();
        const profile = await extractProfile(client);
        const sessionToken = await persistSession();
        await rememberAccount(profile, sessionToken || getCurrentSessionString());
        startConnectionMonitor();
        await new Promise((r) => setTimeout(r, 500));
        await ensureConnected();
        setUserProfile(profile);
        setConnected(true);
        setState((s) => ({ ...s, step: "done", loading: false }));
      } catch (err: unknown) {
        console.warn("Failed to switch account:", err);
        setConnected(false);
        setUserProfile(null);
        setState({ step: "credentials", phone: "", loading: false, error: getErrorMessage(err) });
      }
    },
    [activeAccountId, extractProfile, rememberAccount]
  );

  const logout = useCallback(async () => {
    const activeId = localStorage.getItem(LS_ACTIVE_ACCOUNT);
    await destroyClient();
    localStorage.removeItem(LS_PHONE);
    localStorage.removeItem("tgcd_drive");
    localStorage.removeItem(LS_ACTIVE_ACCOUNT);
    localStorage.removeItem(LS_SESSION);

    const remaining = readAccounts().filter((account) => account.userId !== activeId);
    writeAccounts(remaining);
    setAccounts(remaining);

    if (remaining.length > 0) {
      const nextAccount = remaining[0];
      await switchAccount(nextAccount.userId);
    } else {
      localStorage.removeItem(LS_ACCOUNTS);
      setAccounts([]);
      setConnected(false);
      setUserProfile(null);
      setActiveAccountId(null);
      setState({ step: "credentials", phone: "", loading: false, error: null });
    }
  }, [switchAccount]);

  const clearCache = useCallback(async () => {
    await destroyClient();
    localStorage.clear();
    sessionStorage.clear();
    setAccounts([]);
    setConnected(false);
    setUserProfile(null);
    setActiveAccountId(null);
    setState({ step: "credentials", phone: "", loading: false, error: null });
  }, []);

  const removeAccount = useCallback(
    async (userId: string) => {
      const next = readAccounts().filter((account) => account.userId !== userId);
      writeAccounts(next);
      setAccounts(next);

      if (activeAccountId === userId) {
        await logout();
      }
    },
    [activeAccountId, logout]
  );

  const submitOtp = useCallback((code: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    phoneCodeResolve.current?.(code);
  }, []);

  const submitPassword = useCallback((pwd: string) => {
    const cleanPassword = typeof pwd === "string" ? pwd.trim() : String(pwd ?? "").trim();
    setState((s) => ({ ...s, loading: true, error: null }));
    passwordResolve.current?.(cleanPassword);
  }, []);

  return {
    authState: state,
    connected,
    client: clientRef.current,
    userProfile,
    accounts,
    activeAccountId,
    tryAutoConnect,
    goToPhone,
    goToCredentials,
    startAuth,
    submitOtp,
    submitPassword,
    beginAddAccount,
    switchAccount,
    removeAccount,
    logout,
    clearCache,
  };
}
