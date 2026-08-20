import { useEffect, useState } from "react";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";

export type Theme = "light" | "dark" | "system";

function syncNativeStatusBar(isDark: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
    SystemBars.setStyle({
      style: isDark ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
    });
  } catch {
    // System bars not available (web preview)
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) || "system";
  });

  const setTheme = (nextTheme: Theme) => {
    setThemeState(nextTheme);
    localStorage.setItem("theme", nextTheme);
  };

  useEffect(() => {
    const root = window.document.documentElement;

    const isDark = () =>
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : theme === "dark";

    const applyTheme = () => {
      if (isDark()) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }

      syncNativeStatusBar(isDark());
    };

    applyTheme();

    if (theme === "system") {
      const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      const listener = () => applyTheme();
      mediaQuery.addEventListener("change", listener);
      return () => mediaQuery.removeEventListener("change", listener);
    }
  }, [theme]);

  // The Motorola ROM re-evaluates the appearance of the bar icons when
  // opening/closing modals and when returning from the background, and
  // overrides it with the system uimode's (white icons). Re-sync on every
  // App render and on gaining focus / returning to the app, with retry after the splash.
  useEffect(() => {
    const isDark = () =>
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : theme === "dark";

    const sync = () => syncNativeStatusBar(isDark());
    const timers: number[] = [];

    sync();
    timers.push(window.setTimeout(sync, 300));
    timers.push(window.setTimeout(sync, 900));

    const onFocus = () => sync();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [theme]);

  return { theme, setTheme };
}