import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

export interface SafeInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

function applyInsets(insets: SafeInsets) {
  const dpr = window.devicePixelRatio || 1;
  const root = document.documentElement;
  root.style.setProperty("--safe-area-inset-top", `${insets.top / dpr}px`);
  root.style.setProperty("--safe-area-inset-bottom", `${insets.bottom / dpr}px`);
  root.style.setProperty("--safe-area-inset-left", `${insets.left / dpr}px`);
  root.style.setProperty("--safe-area-inset-right", `${insets.right / dpr}px`);
}

/**
 * Sets --safe-area-inset-* with the REAL system insets (native px →
 * CSS px). This ROM's WebView reports env(safe-area-inset-*) = 0 and
 * @capacitor/system-bars does not inject them here, so the layout (header,
 * island dock, FAB, preview) relies on these variables.
 */
let _syncInsets: (() => void) | null = null;

/** Force an immediate re-sync of safe area insets (e.g. after immersive toggle). */
export function syncInsets() {
  if (_syncInsets) _syncInsets();
}

export function useSafeInsets() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;
    let seq = 0;
    let timer1: ReturnType<typeof setTimeout> | null = null;
    let timer2: ReturnType<typeof setTimeout> | null = null;

    async function sync() {
      const plugin = (Capacitor as any)?.Plugins?.ImmersiveMode;
      if (!plugin?.getInsets) return;
      try {
        const mySeq = ++seq;
        const insets: SafeInsets = await plugin.getInsets();
        if (!cancelled && mySeq === seq) applyInsets(insets);
      } catch {}
    }

    function clearTimers() {
      if (timer1) { clearTimeout(timer1); timer1 = null; }
      if (timer2) { clearTimeout(timer2); timer2 = null; }
    }

    function onResize() {
      clearTimers();
      timer1 = setTimeout(() => { timer1 = null; sync(); }, 200);
      timer2 = setTimeout(() => { timer2 = null; sync(); }, 600);
    }

    _syncInsets = sync;
    sync();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      seq++;
      clearTimers();
      _syncInsets = null;
      window.removeEventListener("resize", onResize);
    };
  }, []);
}