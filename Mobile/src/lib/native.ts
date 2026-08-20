let nativeCapabilities: {
  filesystem: typeof import("@capacitor/filesystem") | null;
  share: typeof import("@capacitor/share") | null;
  browser: typeof import("@capacitor/browser") | null;
} | null = null;

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
    };
  }
}

export function isNativePlatform(): boolean {
  return typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
}

async function loadPlugins() {
  if (nativeCapabilities) return nativeCapabilities;
  if (!isNativePlatform()) {
    nativeCapabilities = { filesystem: null, share: null, browser: null };
    return nativeCapabilities;
  }
  const [filesystem, share, browser] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
    import("@capacitor/browser"),
  ]);
  nativeCapabilities = { filesystem, share, browser };
  return nativeCapabilities;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] ?? result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Saves a downloaded file to the device via the native file system and
 * opens the system share sheet so the user can save/open it anywhere.
 * Returns true when the native path was used.
 */
export async function saveBlobToDevice(blob: Blob, fileName: string): Promise<boolean> {
  const { filesystem, share } = await loadPlugins();
  if (!filesystem || !share) return false;

  try {
    const base64 = await blobToBase64(blob);
    const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 200) || "download.bin";
    const path = `clashdrive/${safeName}`;

    await filesystem.Filesystem.writeFile({
      path,
      data: base64,
      directory: filesystem.Directory.Cache,
      recursive: true,
    });

    const uri = (
      await filesystem.Filesystem.getUri({
        path,
        directory: filesystem.Directory.Cache,
      })
    ).uri;

    await share.Share.share({
      title: safeName,
      url: uri,
      dialogTitle: `Save or open "${safeName}"`,
    });
    return true;
  } catch (err) {
    console.error("[native] Failed to save file:", err);
    return false;
  }
}

/** Opens a URL in the system browser on native, or a new tab on the web. */
export async function openExternalUrl(url: string): Promise<void> {
  const { browser } = await loadPlugins();
  if (browser) {
    await browser.Browser.open({ url });
    return;
  }
  window.open(url, "_blank");
}

/** Shares arbitrary text/url via the native share sheet when available. */
export async function nativeShareText(text: string, title?: string): Promise<boolean> {
  const { share } = await loadPlugins();
  if (!share) return false;
  try {
    await share.Share.share({ text, title: title ?? "Clash Drive" });
    return true;
  } catch {
    return false;
  }
}

/** Clipboard write that works in native WebViews and older mobile browsers. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }
}