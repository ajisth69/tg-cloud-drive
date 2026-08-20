import { TelegramClient } from "@mtcute/web";
import { Long } from "@mtcute/core";
import type { TopicFolder, DriveConfig } from "../types";

function getBareChannelId(idInput: string | number): number {
  const idStr = String(idInput);
  return Number(idStr.replace(/^-100/, "").replace(/^-/, ""));
}

/**
 * List all forum topics in the drive supergroup.
 * Returns them mapped to our TopicFolder shape.
 */
export async function getTopics(
  client: TelegramClient,
  config: DriveConfig
): Promise<TopicFolder[]> {
  let resolvedPeer: any = null;
  try {
    resolvedPeer = await client.resolvePeer(Number(config.chatId));
  } catch (peerErr) {
    console.warn("[getTopics] Could not resolve peer:", peerErr);
  }

  try {
    const topics: TopicFolder[] = [];
    const targetPeer = resolvedPeer || Number(config.chatId);
    for await (const topic of client.iterForumTopics(targetPeer)) {
      topics.push({
        id: topic.id,
        title: topic.title,
        iconColor: topic.iconColor ?? 0x6c63ff,
        date: topic.date ? Math.floor(topic.date.getTime() / 1000) : Math.floor(Date.now() / 1000),
        messageCount: 0,
      });
    }
    return topics;
  } catch (err) {
    console.warn("High-level getForumTopics failed, using raw RPC fallback:", err);
  }

  try {
    const bareId = getBareChannelId(config.chatId);
    const channelInput =
      resolvedPeer && resolvedPeer._ === "inputPeerChannel"
        ? resolvedPeer
        : {
            _: "inputPeerChannel" as const,
            channelId: bareId,
            accessHash: Long.fromString(config.accessHash || "0"),
          };

    const allTopics: TopicFolder[] = [];
    let offsetTopic = 0;
    let offsetDate = 0;
    let offsetId = 0;

    while (true) {
      let raw: any = null;
      let attempts = 0;
      while (attempts < 3) {
        try {
          raw = await client.call({
            _: "messages.getForumTopics",
            peer: channelInput,
            offsetDate,
            offsetId,
            offsetTopic,
            limit: 100,
          });
          break;
        } catch (e: any) {
          if (typeof e === "object" && e && "errorMessage" in e && typeof e.errorMessage === "string" && e.errorMessage.startsWith("FLOOD_WAIT_")) {
            const wait = parseInt(e.errorMessage.split("_").pop() || "30", 10) || 30;
            console.warn(`[getTopics] FloodWait: sleeping ${wait}s...`);
            await new Promise((r) => setTimeout(r, wait * 1000));
            attempts++;
            continue;
          }
          console.warn("[getTopics] Raw RPC failed:", e);
          break;
        }
      }

      const fetched = raw?.topics ?? [];
      if (fetched.length === 0) break;

      let added = 0;
      for (const t of fetched) {
        if (!allTopics.some((existing) => existing.id === t.id)) {
          allTopics.push({
            id: t.id,
            title: t.title,
            iconColor: t.icon_color ?? 0x6c63ff,
            date: t.date || Math.floor(Date.now() / 1000),
            messageCount: 0,
          });
          added++;
        }
      }

      if (fetched.length < 100 || added === 0) break;

      const last = fetched[fetched.length - 1];
      const nextOffsetTopic = last.id;
      if (nextOffsetTopic <= offsetTopic) {
        offsetTopic = offsetTopic + 1;
      } else {
        offsetTopic = nextOffsetTopic;
      }
      offsetDate = last.date || 0;
      offsetId = last.top_message || last.id || 0;
    }

    if (allTopics.length > 0) {
      return allTopics;
    }
  } catch (rawErr) {
    console.error("Failed to load topics via raw RPC:", rawErr);
  }

  return [];
}

/**
 * Create a new topic (folder) inside the drive group.
 */
export async function createTopic(
  client: TelegramClient,
  config: DriveConfig,
  title: string
): Promise<TopicFolder | null> {
  try {
    const peer = (await client.resolvePeer(Number(config.chatId)).catch(() => null)) || Number(config.chatId);
    const msg = await client.createForumTopic({
      chatId: peer as any,
      title,
    });
    return {
      id: msg.id,
      title,
      iconColor: 0x6c63ff,
      date: Math.floor(Date.now() / 1000),
      messageCount: 0,
    };
  } catch (err) {
    console.error("Failed to create topic:", err);
    return null;
  }
}

export async function renameTopic(
  client: TelegramClient,
  config: DriveConfig,
  topicId: number,
  title: string
): Promise<boolean> {
  try {
    const peer = (await client.resolvePeer(Number(config.chatId)).catch(() => null)) || Number(config.chatId);
    await client.editForumTopic({
      chatId: peer as any,
      topicId,
      title,
    });
    return true;
  } catch (err) {
    console.error("Failed to rename topic:", err);
    return false;
  }
}

/**
 * Delete a forum topic entirely.
 */
export async function deleteTopic(
  client: TelegramClient,
  config: DriveConfig,
  topicId: number
): Promise<boolean> {
  try {
    const peer = (await client.resolvePeer(Number(config.chatId)).catch(() => null)) || Number(config.chatId);
    await client.deleteForumTopicHistory(peer as any, topicId);
    return true;
  } catch (err) {
    console.error("Failed to delete topic:", err);
    return false;
  }
}
