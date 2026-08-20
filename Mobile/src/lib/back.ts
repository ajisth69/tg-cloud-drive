import { isNativePlatform } from "./native";

/**
 * Central back-navigation system.
 *
 * Layers (modals, previews, views) register a handler while they are open;
 * a back request (Android hardware button / system back gesture, browser
 * back, Escape-driven) is routed to the topmost layer that can close. When
 * nothing is open the request is ignored so the OS/browser handles it
 * (exit app / leave page).
 *
 * Ordering: handlers are tried by priority (higher first), then by
 * registration time (LIFO). Priorities:
 *   100 — overlays (Modal, ActionSheet, PreviewModal, drawer, auth steps)
 *    50 — Dashboard in-view states (selection → starred → folder)
 */

type BackHandler = () => boolean;

interface BackEntry {
  priority: number;
  seq: number;
  handler: BackHandler;
}

const entries: BackEntry[] = [];
let seq = 0;

// Web fallback: mirror the open layers into the browser history so the
// back button / edge-swipe closes our layers instead of leaving the page.
let webDepth = 0;
let suppressWebPop = 0;

/**
 * Register a back handler while a layer is open. Returns an unregister
 * function to call when the layer closes.
 */
export function registerBackHandler(handler: BackHandler, priority = 0): () => void {
  const entry: BackEntry = { priority, seq: seq++, handler };
  entries.push(entry);
  if (!isNativePlatform()) {
    webDepth++;
    history.pushState({ clashdriveBack: true }, "");
  }
  return () => {
    const idx = entries.indexOf(entry);
    if (idx >= 0) entries.splice(idx, 1);
    if (!isNativePlatform()) {
      if (webDepth > 0) {
        webDepth--;
        suppressWebPop++;
        history.back();
      }
    }
  };
}

/** Try to close the topmost open layer. Returns true when handled. */
export function performBack(): boolean {
  const sorted = [...entries].sort((a, b) => b.priority - a.priority || b.seq - a.seq);
  for (const entry of sorted) {
    try {
      if (entry.handler()) return true;
    } catch (err) {
      console.error("[back] handler failed", err);
    }
  }
  return false;
}

/** Routes a browser back/popstate to our layers (web only). */
export function handleWebPopState(): void {
  if (suppressWebPop > 0) {
    suppressWebPop--;
    return;
  }
  if (webDepth > 0) {
    webDepth--;
    performBack();
  }
}