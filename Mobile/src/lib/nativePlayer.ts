import { isNativePlatform } from "./native";

/**
 * nativePlayer — downloads a file from /stream/{id} to disk
 * (Cache/clashdrive/native/) and opens it with the native ExoPlayer
 * (NativeVideoPlayer plug-in of the APK).
 *
 * The WebView cannot hardware-decode MKV/AVI/unusual codecs:
 * the native <video> element fails and today it falls back to OGV.js
 * (slow CPU-based JS decoding). The native player decodes with
 * MediaCodec (hardware) → smooth playback of any container.
 */

let cachedPlugin:
  | {
      Filesystem: any;
      NativeVideoPlayer: { open: (o: { path: string; title: string }) => Promise<void> };
    }
  | null = null;

export function hasNativePlayer(): boolean {
  if (!isNativePlatform()) return false;
  const cap = (window as any).Capacitor;
  return Boolean(cap?.Plugins?.NativeVideoPlayer && cap?.Plugins?.Filesystem);
}

async function plugins() {
  if (cachedPlugin) return cachedPlugin;
  const cap = (window as any).Capacitor;
  if (!cap?.Plugins?.NativeVideoPlayer || !cap?.Plugins?.Filesystem) return null;
  const { Filesystem } = await import("@capacitor/filesystem");
  cachedPlugin = {
    Filesystem,
    NativeVideoPlayer: cap.Plugins.NativeVideoPlayer,
  };
  return cachedPlugin;
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
 * Downloads /stream/{fileId} entirely to disk with a progress callback.
 * Returns the absolute file URI (file:///data/user/...).
 */
export async function downloadToFile(
  fileId: string,
  fileName: string,
  totalSize: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<string | null> {
  const plug = await plugins();
  if (!plug) return null;

  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 150) || "video.bin";
  const relPath = `clashdrive/native/${safeName}`;
  const { Filesystem } = plug;

  try {
    await Filesystem.Filesystem.deleteFile({ path: relPath, directory: Filesystem.Directory.Cache }).catch(() => {});

    const res = await fetch(`/stream/${fileId}`, { signal });
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

    const reader = res.body.getReader();
    let received = 0;
    const CHUNK = 512 * 1024;
    let buffer = new Uint8Array(0);

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      let chunk = value;
      if (buffer.length > 0) {
        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer, 0);
        merged.set(value, buffer.length);
        chunk = merged;
        buffer = new Uint8Array(0);
      }

      const fullChunks = Math.floor(chunk.length / CHUNK);
      const remainder = chunk.length % CHUNK;
      let offset = 0;

      for (let i = 0; i < fullChunks; i++) {
        const slice = chunk.subarray(offset, offset + CHUNK);
        offset += CHUNK;
        const base64 = await blobToBase64(new Blob([slice]));
        if (received === 0) {
          await Filesystem.Filesystem.writeFile({
            path: relPath,
            data: base64,
            directory: Filesystem.Directory.Cache,
            recursive: true,
          });
        } else {
          await Filesystem.Filesystem.appendFile({
            path: relPath,
            data: base64,
            directory: Filesystem.Directory.Cache,
          });
        }
        received += CHUNK;
        onProgress?.(totalSize > 0 ? Math.min(1, received / totalSize) : 0);
      }

      if (remainder > 0) {
        buffer = chunk.subarray(offset);
      }
    }

    if (buffer.length > 0) {
      const base64 = await blobToBase64(new Blob([buffer]));
      if (received === 0) {
        await Filesystem.Filesystem.writeFile({
          path: relPath,
          data: base64,
          directory: Filesystem.Directory.Cache,
          recursive: true,
        });
      } else {
        await Filesystem.Filesystem.appendFile({
          path: relPath,
          data: base64,
          directory: Filesystem.Directory.Cache,
        });
      }
      received += buffer.length;
    }

    if (received === 0) {
      await Filesystem.Filesystem.deleteFile({ path: relPath, directory: Filesystem.Directory.Cache }).catch(() => {});
      return null;
    }

    onProgress?.(1);

    const { uri } = await Filesystem.Filesystem.getUri({
      path: relPath,
      directory: Filesystem.Directory.Cache,
    });
    return uri;
  } catch (err) {
    await Filesystem.Filesystem.deleteFile({ path: relPath, directory: Filesystem.Directory.Cache }).catch(() => {});
    console.error("[nativePlayer] download failed:", err);
    return null;
  }
}

/** Opens the file (absolute URI) in the native ExoPlayer. */
export async function openInNativePlayer(uri: string, title: string): Promise<boolean> {
  const plug = await plugins();
  if (!plug) return false;
  try {
    const filePath = uri.replace(/^file:\/\//, "");
    await plug.NativeVideoPlayer.open({ path: filePath, title });
    return true;
  } catch (err) {
    console.error("[nativePlayer] open failed:", err);
    return false;
  }
}

/**
 * Full flow: download with progress → open native player.
 * Returns false if there is no native plug-in.
 */
export async function playFileWithNativePlayer(
  fileId: string,
  fileName: string,
  totalSize: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<boolean> {
  if (!hasNativePlayer()) return false;
  const uri = await downloadToFile(fileId, fileName, totalSize, onProgress, signal);
  if (!uri) return false;
  return openInNativePlayer(uri, fileName);
}