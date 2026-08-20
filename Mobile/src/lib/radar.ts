import { TelegramClient } from "@mtcute/web";
import { Long } from "@mtcute/core";
import {
  DRIVE_SIGNATURE,
  DEFAULT_DRIVE_TITLE,
  LS_DRIVE,
} from "../config/telegram";
import type { DriveConfig } from "../types";
import { parseManifest } from "./manifest";

function getBareChannelId(idInput: string | number): number {
  const idStr = String(idInput);
  return Number(idStr.replace(/^-100/, "").replace(/^-/, ""));
}

function getMarkedChannelId(idInput: string | number): string {
  const bare = getBareChannelId(idInput);
  return `-100${bare}`;
}

function accessHashString(value: unknown): string {
  return value == null ? "0" : String(value);
}

async function refreshDriveAccessHash(
  client: TelegramClient,
  config: DriveConfig
): Promise<DriveConfig> {
  const chatId = getMarkedChannelId(config.chatId);
  try {
    const peer: any = await client.resolvePeer(Number(chatId));
    if (peer?._ === "inputPeerChannel" && peer.accessHash != null) {
      return { ...config, chatId, accessHash: accessHashString(peer.accessHash) };
    }
  } catch (err) {
    console.warn("[radar] Could not refresh the drive access hash:", err);
  }
  return { ...config, chatId };
}

async function stampDriveSignature(
  client: TelegramClient,
  chatId: string | number,
  accessHashStr: string,
  existingBio: string = ""
): Promise<void> {
  try {
    const bareId = getBareChannelId(chatId);
    const peerInput = {
      _: "inputPeerChannel" as const,
      channelId: bareId,
      accessHash: Long.fromString(accessHashStr || "0"),
    };
    const newAbout = existingBio && existingBio.trim()
      ? (existingBio.includes(DRIVE_SIGNATURE) ? existingBio : `${existingBio}\n${DRIVE_SIGNATURE}`)
      : `Personal cloud storage powered by Telegram.\n${DRIVE_SIGNATURE}`;

    await client.call({
      _: "messages.editChatAbout",
      peer: peerInput,
      about: newAbout,
    });
  } catch (err) {
    console.warn("[radar] Failed to stamp drive signature:", err);
  }
}

/** Explicit Blacklist numeric IDs provided in user screenshots */
const EXCLUDED_CHAT_IDS = new Set([
  "378392372",
  "-100378392372",
  "3886546063",
  "-1003886546063",
]);

async function verifyDriveGroup(
  client: TelegramClient,
  config: DriveConfig
): Promise<DriveConfig | null> {
  if (!config || !config.chatId) return null;
  const bareIdStr = String(getBareChannelId(config.chatId));
  const markedIdStr = getMarkedChannelId(config.chatId);

  if (EXCLUDED_CHAT_IDS.has(bareIdStr) || EXCLUDED_CHAT_IDS.has(markedIdStr)) {
    console.warn(`[radar] Explicitly blacklisted chat ID ${config.chatId}. Invalidating cache.`);
    return null;
  }

  const markedIdNum = Number(markedIdStr);

  try {
    const fullChat: any = await client.getFullChat(markedIdNum);
    if (fullChat) {
      const bio = fullChat.bio || "";
      const titleLower = (fullChat.title || config.chatTitle || "").toLowerCase();

      // Skip broadcast channels that lack signature and drive keywords
      if (fullChat.isBroadcast && !fullChat.isForum && !fullChat.isMegagroup) {
        if (!titleLower.includes("drive") && !bio.includes(DRIVE_SIGNATURE)) {
          console.warn("[radar] Cached chat is a 1-way broadcast channel. Invalidating cache.");
          return null;
        }
      }

      // Check title validity or signature
      const validTitleKeywords = ["clash drive", "tg cloud drive", "clashdrive", "tg cloud", "drive", "cloud", "vault"];
      const isTitleValid = validTitleKeywords.some((kw) => titleLower.includes(kw));

      if (!isTitleValid && !bio.includes(DRIVE_SIGNATURE)) {
        console.warn(`[radar] Cached chat "${titleLower}" lacks valid title and signature. Invalidating cache.`);
        return null;
      }

      if (!bio.includes(DRIVE_SIGNATURE)) {
        await stampDriveSignature(client, config.chatId, config.accessHash, bio);
      }
      return refreshDriveAccessHash(client, { ...config, chatId: markedIdStr, chatTitle: fullChat.title || config.chatTitle });
    }
  } catch (err) {
    console.warn("verifyDriveGroup getFullChat failed:", err);
  }

  try {
    const bareId = getBareChannelId(config.chatId);
    const channelInput = {
      _: "inputChannel" as const,
      channelId: bareId,
      accessHash: Long.fromString(config.accessHash || "0"),
    };
    const full: any = await client.call({
      _: "channels.getFullChannel",
      channel: channelInput,
    });
    if (full && full.fullChat) {
      const about = full.fullChat.about ?? "";
      if (!about.includes(DRIVE_SIGNATURE)) {
        await stampDriveSignature(client, config.chatId, config.accessHash, about);
      }
      return refreshDriveAccessHash(client, { ...config, chatId: markedIdStr });
    }
  } catch (err) {
    console.warn("verifyDriveGroup fallback failed:", err);
  }

  return null;
}

/**
 * Ensure forum topics are enabled on a drive group.
 */
export async function ensureDriveForumEnabled(
  client: TelegramClient,
  config: DriveConfig
): Promise<void> {
  try {
    const bareId = getBareChannelId(config.chatId);
    let accessHashStr = config.accessHash || "0";
    try {
      const peer: any = await client.resolvePeer(Number(config.chatId));
      if (peer?.accessHash) {
        accessHashStr = String(peer.accessHash);
      }
    } catch { /* ignore */ }

    const channelInput = {
      _: "inputChannel" as const,
      channelId: bareId,
      accessHash: Long.fromString(accessHashStr),
    };

    await (client.call as any)({
      _: "channels.toggleForum",
      channel: channelInput,
      enabled: true,
      tabs: false,
    });
  } catch (e) {
    console.warn("[radar] Failed to toggle forum on drive group:", e);
  }
}

/**
 * Scan the user's dialogs looking for an existing drive group.
 *
 * Strategy (designed to minimize API calls and avoid FLOOD_WAIT):
 * 1. Check localStorage cache first and verify it.
 * 2. Fetch all dialogs (no extra API calls — just the dialog list).
 * 3. Filter candidates by TITLE only (zero API calls).
 * 4. For the small set of title-matched candidates, check description and message history.
 * 5. Score and return the best candidate.
 */
export async function scanForDriveGroup(
  client: TelegramClient
): Promise<DriveConfig | null> {
  let userId = "default";
  try {
    const me = await client.getMe();
    if (me) userId = me.id.toString();
  } catch (e) {
    console.warn("Failed to fetch user in radar scan:", e);
  }
  const userDriveKey = `${LS_DRIVE}_${userId}`;

  // --- Step 1: Try cached config ---
  const cached = localStorage.getItem(userDriveKey) || localStorage.getItem(LS_DRIVE);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as DriveConfig;
      if (parsed && parsed.chatId) {
        const bareIdStr = String(getBareChannelId(parsed.chatId));
        const markedIdStr = getMarkedChannelId(parsed.chatId);
        if (EXCLUDED_CHAT_IDS.has(bareIdStr) || EXCLUDED_CHAT_IDS.has(markedIdStr)) {
          console.warn("[radar] Blacklisted cached drive found. Removing from localStorage.");
          localStorage.removeItem(userDriveKey);
          localStorage.removeItem(LS_DRIVE);
        } else {
          const verified = await verifyDriveGroup(client, parsed);
          if (verified) {
            localStorage.setItem(userDriveKey, JSON.stringify(verified));
            return verified;
          }
        }
      }
    } catch {
      localStorage.removeItem(userDriveKey);
      localStorage.removeItem(LS_DRIVE);
    }
  }

  // --- Step 2: Fetch all dialogs (single paginated request, no getFullChat calls) ---
  const dialogs: any[] = [];
  try {
    for await (const dialog of client.iterDialogs({ limit: 500 })) {
      dialogs.push(dialog);
    }
  } catch (err) {
    console.warn("Failed to fetch main dialogs during radar scan:", err);
  }
  try {
    for await (const dialog of client.iterDialogs({ limit: 200, folder: 1 })) {
      dialogs.push(dialog);
    }
  } catch {
    // archived folder might fail
  }

  // --- Step 3: Filter candidates (title keywords OR forum supergroups) ---
  const TITLE_KEYWORDS = ["clash drive", "tg cloud drive", "clashdrive", "tg cloud", "drive", "cloud", "storage", "vault"];
  const titleCandidates: any[] = [];

  for (const dialog of dialogs) {
    const chat = (dialog as any).chat || (dialog as any).peer;
    if (!chat) continue;

    const bareIdStr = String(getBareChannelId(chat.id));
    const markedIdStr = getMarkedChannelId(chat.id);
    if (EXCLUDED_CHAT_IDS.has(bareIdStr) || EXCLUDED_CHAT_IDS.has(markedIdStr)) {
      console.log(`[radar] Blacklisted chat ID ${chat.id} skipped.`);
      continue;
    }

    const titleLower = (chat.title || "").toLowerCase();

    // Skip private 1-on-1 user chats
    if (chat.chatType === "user" || chat.type === "user") continue;

    // Skip 1-way broadcast channels (only allow supergroups / megagroups / forum chats)
    const isMegagroup = Boolean(chat.isMegagroup || chat.megagroup || chat.raw?.megagroup || chat.isForum || chat.raw?.forum);
    const isChannelType = chat.chatType === "channel" || chat.type === "channel";
    if (isChannelType && !isMegagroup) {
      continue;
    }

    // Exclude update / announcement channel names unless exact match
    if (titleLower.includes("clashgram") || titleLower.includes("update channel")) {
      if (!titleLower.includes("drive")) continue;
    }

    const isTitleMatch = TITLE_KEYWORDS.some((kw) => titleLower.includes(kw));
    const isForum = Boolean(chat.isForum || (chat.raw && "forum" in chat.raw && chat.raw.forum));

    if (isTitleMatch || isForum) {
      titleCandidates.push(chat);
    }
  }

  console.log(`[radar] Found ${titleCandidates.length} candidate chats out of ${dialogs.length} dialogs`);

  // --- Step 4: For each title candidate, check description, forum topics + message history ---
  const scored: {
    config: DriveConfig;
    bareId: number;
    hasSignature: boolean;
    manifestCount: number;
    topicCount: number;
    titleOnly: boolean;
    score: number;
  }[] = [];

  for (const chat of titleCandidates) {
    try {
      const markedIdNum = Number(getMarkedChannelId(chat.id));
      await client.resolvePeer(markedIdNum).catch(() => null);
      // 4a. Check description for signature
      let about = "";
      try {
        const markedIdNum = Number(getMarkedChannelId(chat.id));
        const full = await client.getFullChat(markedIdNum);
        about = full.bio || "";
      } catch {
        try {
          const bareId = getBareChannelId(chat.id);
          const ah = chat.raw?.accessHash || chat.inputPeer?.accessHash || Long.ZERO;
          const channelInput = {
            _: "inputChannel" as const,
            channelId: bareId,
            accessHash:
              typeof ah === "string"
                ? Long.fromString(ah)
                : typeof ah === "number"
                ? Long.fromNumber(ah)
                : ah || Long.ZERO,
          };
          const full: any = await client.call({
            _: "channels.getFullChannel",
            channel: channelInput,
          });
          about = full.fullChat?.about ?? "";
        } catch {
          // continue anyway
        }
      }

      const hasSignature = about.includes(DRIVE_SIGNATURE);

      // 4b. Check forum topics count
      let topicCount = 0;
      try {
        const markedIdNum = Number(getMarkedChannelId(chat.id));
        const topics = await client.getForumTopics(markedIdNum).catch(() => []);
        topicCount = topics.length;
      } catch {}

      // 4b. Check message history for segmented_file manifests
      let manifestCount = 0;

      // Check forum topics
      try {
        const markedIdNum = Number(getMarkedChannelId(chat.id));
        const bareId = getBareChannelId(chat.id);
        const ah = chat.raw?.accessHash || chat.inputPeer?.accessHash || Long.ZERO;
        const peerInput = {
          _: "inputPeerChannel" as const,
          channelId: bareId,
          accessHash:
            typeof ah === "string"
              ? Long.fromString(ah)
              : typeof ah === "number"
              ? Long.fromNumber(ah)
              : ah || Long.ZERO,
        };

        const topics = await client.getForumTopics(markedIdNum).catch(() => []);
        for (const topic of topics) {
          if (manifestCount > 0) break;
          try {
            const repliesRes: any = await client.call({
              _: "messages.getReplies",
              peer: peerInput,
              msgId: topic.id,
              offsetId: 0,
              offsetDate: 0,
              addOffset: 0,
              limit: 10,
              maxId: 0,
              minId: 0,
              hash: Long.ZERO,
            });
            for (const m of (repliesRes.messages ?? [])) {
              const text = typeof m.message === "string" ? m.message : typeof m.text === "string" ? m.text : "";
              if (text && (text.includes('"segmented_file"') || parseManifest(text) !== null)) {
                manifestCount++;
              }
            }
          } catch {
            // topic check failed
          }
        }
      } catch {
        // forum topics check failed
      }

      // Check general history
      if (manifestCount === 0) {
        try {
          const markedIdNum = Number(getMarkedChannelId(chat.id));
          const history = await client.getHistory(markedIdNum, { limit: 30 });
          for (const msg of history) {
            const mAny = msg as any;
            const text = typeof mAny.message === "string" ? mAny.message : typeof msg.text === "string" ? msg.text : "";
            if (text && (text.includes('"segmented_file"') || parseManifest(text) !== null)) {
              manifestCount++;
            }
          }
        } catch {
          // history check failed
        }
      }

      // Calculate composite score with multi-parameter weighting
      let score = 0;
      const titleLower = (chat.title || "").toLowerCase();

      // Absolute certainty bonus for #TgCloudDrive_v1 signature (+1,000,000 pts)
      if (hasSignature) {
        score += 1000000;
      }

      if (titleLower === "clash drive" || titleLower === "tg cloud drive") {
        score += 10000;
      } else if (titleLower.includes("clash drive") || titleLower.includes("tg cloud drive")) {
        score += 6000;
      } else if (titleLower.includes("tg cloud") || titleLower.includes("clashdrive")) {
        score += 3000;
      } else if (titleLower.includes("drive") || titleLower.includes("cloud") || titleLower.includes("vault")) {
        score += 500;
      }

      if (manifestCount > 0) score += 5000 + (manifestCount * 500);
      if (topicCount > 0) score += 2000 + (topicCount * 100);

      const markedId = getMarkedChannelId(chat.id);
      const bareId = getBareChannelId(chat.id);
      const accessHashStr = accessHashString(
        chat.raw?.accessHash ?? chat.inputPeer?.accessHash ?? chat.accessHash
      );

      const config: DriveConfig = {
        chatId: markedId,
        chatTitle: chat.title || "Clash Drive",
        accessHash: accessHashStr,
      };

      scored.push({
        config,
        bareId,
        hasSignature,
        manifestCount,
        topicCount,
        titleOnly: !hasSignature && manifestCount === 0 && topicCount === 0,
        score,
      });

      console.log(`[radar] Candidate: "${chat.title}" score=${score} sig=${hasSignature} topics=${topicCount} manifests=${manifestCount}`);
    } catch (err) {
      console.warn("[radar] Error checking candidate:", chat.title, err);
      continue;
    }
  }

  if (scored.length > 0) {
    scored.sort((a, b) => b.score - a.score || a.bareId - b.bareId);

    const bestCandidate = scored[0];
    let best = bestCandidate.config;
    best = await refreshDriveAccessHash(client, best);
    await ensureDriveForumEnabled(client, best);
    console.log(`[radar] Selected drive: "${best.chatTitle}" (${best.chatId}) with score ${bestCandidate.score}`);
    if (!bestCandidate.hasSignature) {
      await stampDriveSignature(client, best.chatId, best.accessHash);
    }
    localStorage.setItem(userDriveKey, JSON.stringify(best));
    return best;
  }

  console.warn("[radar] No drive group found among", titleCandidates.length, "candidates");
  return null;
}

/**
 * Create a new drive supergroup with forum topics enabled.
 */
export async function createDriveGroup(
  client: TelegramClient
): Promise<DriveConfig> {
  const result: any = await client.call({
    _: "channels.createChannel",
    title: DEFAULT_DRIVE_TITLE,
    about: `Personal cloud storage powered by Telegram.\n${DRIVE_SIGNATURE}`,
    megagroup: true,
    forum: true,
  });

  const chats = result.chats || [];
  const channel = chats[0];
  const accessHashStr = channel.accessHash ? channel.accessHash.toString() : "0";

  const markedId = getMarkedChannelId(channel.id);
  const bareId = getBareChannelId(channel.id);

  const peerInput = {
    _: "inputPeerChannel" as const,
    channelId: bareId,
    accessHash: Long.fromString(accessHashStr),
  };

  // Explicitly set description and toggle forum to guarantee setup on Telegram servers
  try {
    await client.call({
      _: "messages.editChatAbout",
      peer: peerInput,
      about: `Personal cloud storage powered by Telegram.\n${DRIVE_SIGNATURE}`,
    });
  } catch (e) {
    console.warn("Failed to set chat description in createDriveGroup:", e);
  }

  const channelInput = {
    _: "inputChannel" as const,
    channelId: bareId,
    accessHash: Long.fromString(accessHashStr),
  };

  try {
    await (client.call as any)({
      _: "channels.toggleForum",
      channel: channelInput,
      enabled: true,
      tabs: false,
    });
  } catch (e) {
    console.warn("Failed to toggle forum in createDriveGroup:", e);
  }

  const config: DriveConfig = {
    chatId: markedId,
    chatTitle: channel.title,
    accessHash: accessHashStr,
  };

  let userId = "default";
  try {
    const me = await client.getMe();
    if (me) userId = me.id.toString();
  } catch (e) {
    console.warn("Failed to fetch user in createDriveGroup:", e);
  }
  const userDriveKey = `${LS_DRIVE}_${userId}`;
  localStorage.setItem(userDriveKey, JSON.stringify(config));

  return config;
}
