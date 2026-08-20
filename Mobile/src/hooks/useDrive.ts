import { useState, useCallback, useRef } from "react";
import type { TelegramClient } from "@mtcute/web";
import { scanForDriveGroup, createDriveGroup, ensureDriveForumEnabled } from "../lib/radar";
import { getTopics, createTopic, deleteTopic, renameTopic } from "../lib/topics";
import { ensureConnected } from "../lib/client";
import { LS_DRIVE } from "../config/telegram";
import type { DriveConfig, TopicFolder } from "../types";

export function useDrive() {
  const [driveConfig, setDriveConfig] = useState<DriveConfig | null>(null);
  const [topics, setTopics] = useState<TopicFolder[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>("");
  const topicsCache = useRef<Map<string, TopicFolder[]>>(new Map());

  /**
   * Run the full radar scan → drive setup → topic load pipeline.
   */
  const initDrive = useCallback(async (client: TelegramClient) => {
    setSyncing(true);
    setSyncStatus("Scanning your chats for an existing drive...");
    try {
      await ensureConnected();

      let config = await scanForDriveGroup(client);
      if (!config) {
        setSyncStatus("No drive found. Creating a new supergroup...");
        config = await createDriveGroup(client);
      }

      setDriveConfig(config);
      setSyncStatus("Loading folders...");

      await ensureDriveForumEnabled(client, config);
      let folders = await getTopics(client, config);

      // Always ensure General folder (ID 1) exists for main supergroup chat files
      if (!folders.some((f) => f.id === 1 || f.title.toLowerCase() === "general")) {
        folders.unshift({
          id: 1,
          title: "General",
          iconColor: 0x6c63ff,
          date: Math.floor(Date.now() / 1000),
          messageCount: 0,
        });
      }

      const defaultTitles = ["Videos", "Audio", "Photos", "Documents", "Favourite"];
      for (const title of defaultTitles) {
        if (!folders.some((f) => f.title.toLowerCase() === title.toLowerCase())) {
          setSyncStatus(`Initializing ${title} folder...`);
          const topic = await createTopic(client, config, title);
          if (topic) {
            folders.push(topic);
          } else {
            const virtualId = defaultTitles.indexOf(title) + 2;
            if (!folders.some((f) => f.id === virtualId)) {
              folders.push({
                id: virtualId,
                title,
                iconColor: 0x6c63ff,
                date: Math.floor(Date.now() / 1000),
                messageCount: 0,
              });
            }
          }
        }
      }

      setTopics(folders);
      topicsCache.current.set(config.chatId, folders);
      setSyncStatus("");
    } catch (err) {
      console.error("Failed to initialize drive:", err);
      setSyncStatus("Failed to set up drive. Please refresh.");
    } finally {
      setSyncing(false);
    }
  }, []);

  /**
   * Refresh topics list from the network.
   */
  const refreshTopics = useCallback(
    async (client: TelegramClient) => {
      if (!driveConfig) return;
      await ensureConnected();
      const folders = await getTopics(client, driveConfig);
      setTopics(folders);
      topicsCache.current.set(driveConfig.chatId, folders);
    },
    [driveConfig]
  );

  /**
   * Create a new folder (topic).
   */
  const addFolder = useCallback(
    async (client: TelegramClient, name: string) => {
      if (!driveConfig) return;
      await ensureConnected();
      const topic = await createTopic(client, driveConfig, name);
      if (topic) {
        setTopics((prev) => [...prev, topic]);
      }
    },
    [driveConfig]
  );

  /**
   * Delete a folder (topic).
   */
  const removeFolder = useCallback(
    async (client: TelegramClient, topicId: number) => {
      if (!driveConfig) return;
      await ensureConnected();
      const ok = await deleteTopic(client, driveConfig, topicId);
      if (ok) {
        setTopics((prev) => prev.filter((t) => t.id !== topicId));
      }
    },
    [driveConfig]
  );

  const renameFolder = useCallback(
    async (client: TelegramClient, topicId: number, title: string) => {
      if (!driveConfig) return false;
      const nextTitle = title.trim();
      if (!nextTitle) return false;
      await ensureConnected();
      const ok = await renameTopic(client, driveConfig, topicId, nextTitle);
      if (ok) {
        setTopics((prev) =>
          prev.map((topic) =>
            topic.id === topicId ? { ...topic, title: nextTitle } : topic
          )
        );
        topicsCache.current.delete(driveConfig.chatId);
      }
      return ok;
    },
    [driveConfig]
  );

  /**
   * Client-side keyword filter over cached topics.
   */
  const filterTopics = useCallback(
    (query: string) => {
      if (!query.trim()) return topics;
      const q = query.toLowerCase();
      return topics.filter((t) => t.title.toLowerCase().includes(q));
    },
    [topics]
  );

  const resetDrive = useCallback(() => {
    setDriveConfig(null);
    setTopics([]);
    setSyncing(false);
    setSyncStatus("");
    topicsCache.current.clear();
    try {
      localStorage.removeItem(LS_DRIVE);
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith(`${LS_DRIVE}_`)) {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // ignore storage errors
    }
  }, []);

  return {
    driveConfig,
    topics,
    syncing,
    syncStatus,
    initDrive,
    refreshTopics,
    addFolder,
    removeFolder,
    renameFolder,
    filterTopics,
    resetDrive,
  };
}
