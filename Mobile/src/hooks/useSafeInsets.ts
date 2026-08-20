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
export function useSafeInsets() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let cancelled = false;

    async function sync() {
      const plugin = (Capacitor as any)?.Plugins?.ImmersiveMode;
      if (!plugin?.getInsets) {
        console.log("[safeInsets] plugin no disponible");
        return;
      }
      try {
        const insets: SafeInsets = await plugin.getInsets();
        console.log("[safeInsets] insets", JSON.stringify(insets));
        if (!cancelled) applyInsets(insets);
      } catch (e) {
        console.log("[safeInsets] error", e);
      }
    }

    sync();
    window.addEventListener("resize", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", sync);
    };
  }, []);
}