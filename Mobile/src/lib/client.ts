import { TelegramClient, MemoryStorage } from "@mtcute/web";
import { convertFromGramjsSession } from "@mtcute/convert";
import { getApiCredentials, LS_SESSION, DEVICE_MODEL, SYSTEM_VERSION, APP_VERSION } from "../config/telegram";

let _client: TelegramClient | null = null;
let _cachedSessionString: string = "";
let _monitorInterval: ReturnType<typeof setInterval> | null = null;
let _reconnecting = false;
const _connectionListeners = new Set<(connected: boolean) => void>();

let _clientInitPromise: Promise<TelegramClient> | null = null;

let _isConnected = false;

/**
 * Register an active client singleton instance.
 */
export function setClient(client: TelegramClient): void {
  stopConnectionMonitor();
  void destroyHelperClients();
  _client = client;
  _clientInitPromise = null;
  _isConnected = true;
  void warmupHelperClients();
}

/**
 * Create a new TelegramClient from a session string (GramJS or @mtcute format).
 */
export async function createClientFromSession(
  sessionString = "",
  apiId?: number,
  apiHash?: string
): Promise<TelegramClient> {
  const creds = getApiCredentials();
  const id = apiId ?? creds.apiId;
  const hash = apiHash ?? creds.apiHash;

  const client = new TelegramClient({
    apiId: id,
    apiHash: hash,
    storage: new MemoryStorage(),
  });

  if (sessionString) {
    try {
      if (sessionString.startsWith("11") || sessionString.length > 50) {
        try {
          const converted = convertFromGramjsSession(sessionString);
          await client.importSession(converted);
        } catch {
          await client.importSession(sessionString);
        }
      } else {
        await client.importSession(sessionString);
      }
    } catch (e) {
      console.warn("[tgcd] Session import warning:", e);
    }
  }

  return client;
}

/**
 * Build (or return existing) TelegramClient with the saved session string.
 */
export function getClient(): TelegramClient {
  if (_client) return _client;

  if (_clientInitPromise) return _clientInitPromise as any;

  _clientInitPromise = (async () => {
    const saved = localStorage.getItem(LS_SESSION) ?? "";
    const { apiId, apiHash } = getApiCredentials();

    _client = await createClientFromSession(saved, apiId, apiHash);
    return _client;
  })();

  return _clientInitPromise as any;
}

/**
 * Persist the current session token so next page-load skips login.
 */
export async function persistSession(): Promise<string> {
  if (!_client) return "";
  try {
    const token = await _client.exportSession();
    _cachedSessionString = token;
    localStorage.setItem(LS_SESSION, token);
    return token;
  } catch (err) {
    console.warn("Failed to export session:", err);
    return _cachedSessionString || localStorage.getItem(LS_SESSION) || "";
  }
}

export function getCurrentSessionString(): string {
  return _cachedSessionString || localStorage.getItem(LS_SESSION) || "";
}

/**
 * Destroy session, disconnect, and wipe the singleton.
 */
export async function destroyClient(): Promise<void> {
  stopConnectionMonitor();
  await destroyHelperClients();
  if (_client) {
    try {
      await _client.destroy();
    } catch { /* ignore */ }
    _client = null;
  }
  _isConnected = false;
  _cachedSessionString = "";
  localStorage.removeItem(LS_SESSION);
}

/**
 * True when a session string already exists in storage.
 */
export function hasPersistedSession(): boolean {
  const s = localStorage.getItem(LS_SESSION);
  return !!s && s.length > 0;
}

/**
 * Subscribe to connection health changes.
 */
export function onConnectionChange(listener: (connected: boolean) => void): () => void {
  _connectionListeners.add(listener);
  return () => { _connectionListeners.delete(listener); };
}

function notifyConnectionListeners(connected: boolean) {
  _connectionListeners.forEach((fn) => {
    try { fn(connected); } catch { /* ignore */ }
  });
}

/**
 * Check if the client's underlying connection is alive.
 */
export function isClientConnected(): boolean {
  if (!_client) return false;
  if (_isConnected) return true;
  try {
    const isConn = Boolean(
      (_client as any).isConnected ||
      (_client as any)._net?.isConnected ||
      (_client as any)._client?._connected
    );
    if (isConn) _isConnected = true;
    return isConn;
  } catch {
    return false;
  }
}

/**
 * Ensure the client is connected. If disconnected, attempt reconnection.
 */
export async function ensureConnected(): Promise<boolean> {
  if (!_client) return false;
  if (isClientConnected()) return true;
  if (_reconnecting) {
    await new Promise((r) => setTimeout(r, 2000));
    return isClientConnected();
  }

  _reconnecting = true;
  try {
    console.warn("[tgcd] Client disconnected, attempting reconnect...");
    await _client.connect();
    _isConnected = true;
    console.debug("[tgcd] Reconnected successfully.");
    notifyConnectionListeners(true);
    return true;
  } catch (err) {
    _isConnected = false;
    console.error("[tgcd] Reconnection failed:", err);
    notifyConnectionListeners(false);
    return false;
  } finally {
    _reconnecting = false;
  }
}

/**
 * Start a background monitor that periodically checks the connection.
 */
export function startConnectionMonitor(): void {
  stopConnectionMonitor();
  _monitorInterval = setInterval(async () => {
    if (!_client || _reconnecting) return;
    if (!isClientConnected()) {
      console.warn("[tgcd] Connection monitor detected disconnect.");
      await ensureConnected();
    }
  }, 15_000);
}

/**
 * Stop the connection health monitor.
 */
export function stopConnectionMonitor(): void {
  if (_monitorInterval) {
    clearInterval(_monitorInterval);
    _monitorInterval = null;
  }
}

const MAX_HELPER_CLIENTS = 6;
const _helperClients: (TelegramClient | Promise<TelegramClient> | null)[] = new Array(MAX_HELPER_CLIENTS).fill(null);

/**
 * Returns a connected TelegramClient instance from the connection pool.
 * Slot 0 is the primary _client. Slots 1..5 are auxiliary helper clients.
 */
export async function getHelperClient(index?: number): Promise<TelegramClient> {
  const primaryClient = getClient();
  await ensureConnected();

  if (index === undefined || index === 0) {
    return primaryClient;
  }

  const slot = Math.abs(index) % MAX_HELPER_CLIENTS;
  if (slot === 0) {
    return primaryClient;
  }

  const helperSlot = slot - 1;
  const existing = _helperClients[helperSlot];

  if (existing instanceof Promise) {
    try {
      return await existing;
    } catch {
      _helperClients[helperSlot] = null;
      return primaryClient;
    }
  }

  if (existing) {
    return existing;
  }

  const sessionStr = getCurrentSessionString();
  if (!sessionStr) {
    return primaryClient;
  }

  const initPromise = (async () => {
    try {
      const helper = await createClientFromSession(sessionStr);
      await helper.connect();
      _helperClients[helperSlot] = helper;
      return helper;
    } catch (err) {
      console.warn(`[tgcd] Failed to initialize helper client slot ${slot}:`, err);
      _helperClients[helperSlot] = null;
      return primaryClient;
    }
  })();

  _helperClients[helperSlot] = initPromise;
  return await initPromise;
}

/**
 * Destroy all clients in the helper pool.
 */
export async function destroyHelperClients(): Promise<void> {
  for (let i = 0; i < _helperClients.length; i++) {
    const item = _helperClients[i];
    if (item) {
      try {
        const client = item instanceof Promise ? await item : item;
        if (client && client !== _client) {
          await client.destroy();
        }
      } catch { /* ignore */ }
    }
    _helperClients[i] = null;
  }
}

/**
 * Pre-warm and establish connections for auxiliary pool sockets in background.
 */
export async function warmupHelperClients(): Promise<void> {
  const sessionStr = getCurrentSessionString();
  if (!sessionStr) return;
  const promises = [];
  for (let i = 1; i < MAX_HELPER_CLIENTS; i++) {
    promises.push(getHelperClient(i).catch(() => null));
  }
  await Promise.all(promises);
}


