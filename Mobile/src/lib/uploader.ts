import { TelegramClient } from "@mtcute/web";
import type { UploadProgress, DriveConfig } from "../types";
import { buildManifest } from "./manifest";
import { getHelperClient } from "./client";
import { ensureConnected } from "./client";
import { generateAnyThumbnail } from "./thumbnailGenerators";

export async function generateVideoThumbnail(file: File | Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;

    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(null);
    }, 5000);

    video.onloadeddata = () => {
      video.currentTime = 0.1;
    };

    video.onseeked = () => {
      clearTimeout(timeout);
      const maxDim = 640;
      let width = video.videoWidth || 640;
      let height = video.videoHeight || 360;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      // Encode the frame to JPEG off the main thread (OffscreenCanvas):
      // each video's cover is generated while scrolling and encoding on the
      // main thread (onscreen canvas toBlob) was accumulated jank.
      const finish = (blob: Blob | null) => {
        URL.revokeObjectURL(url);
        resolve(blob);
      };
      try {
        const off = new OffscreenCanvas(width, height);
        const octx = off.getContext("2d");
        if (octx) {
          octx.imageSmoothingEnabled = true;
          octx.imageSmoothingQuality = "high";
          octx.drawImage(video, 0, 0, width, height);
          off.convertToBlob({ type: "image/jpeg", quality: 0.9 })
            .then(finish)
            .catch(() => finish(null));
          return;
        }
      } catch {
        // Classic fallback
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        finish(null);
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(video, 0, 0, width, height);
      canvas.toBlob(finish, "image/jpeg", 0.9);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      console.warn("[COVER] video element error:", video.error?.code ?? "unknown");
      resolve(null);
    };
  });
}

export async function generateImageThumbnail(file: File | Blob): Promise<Blob | null> {
  // Fast path: createImageBitmap decodes and resizes OFF the main thread
  // and OffscreenCanvas.convertToBlob encodes off the thread.
  // Scrolling a folder generates many thumbs; decoding the full photo
  // on the main thread (new Image + drawImage) was the lag.
  try {
    // Only resizeWidth is given so the aspect ratio is preserved: a photo
    // is never squashed into a square (640x640 both dimensions distorted
    // the thumbs). from-image applies EXIF rotation, matching how the full
    // image is displayed by the browser.
    const bitmap = await createImageBitmap(file, {
      resizeWidth: 640,
      resizeQuality: "medium",
      imageOrientation: "from-image",
    });
    try {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0);
        const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
        if (out) return out;
      }
    } finally {
      bitmap.close();
    }
  } catch {
    // Classic fallback (SVG, HEIC and formats createImageBitmap doesn't support)
  }
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.src = url;

    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url);
      resolve(null);
    }, 5000);

    img.onload = () => {
      clearTimeout(timeout);
      const canvas = document.createElement("canvas");
      const maxDim = 640;
      let width = img.width || 640;
      let height = img.height || 640;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          resolve(blob);
        },
        "image/jpeg",
        0.9
      );
    };

    img.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });
}

async function generateAudioThumbnail(_file: File): Promise<Blob | null> {
  return null;
}

async function generatePdfThumbnail(_file: File): Promise<Blob | null> {
  return null;
}

async function generateDocxThumbnail(_file: File): Promise<Blob | null> {
  return null;
}

async function generateXlsxThumbnail(_file: File): Promise<Blob | null> {
  return null;
}

async function generateApkThumbnail(_file: File): Promise<Blob | null> {
  return null;
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  signal?: AbortSignal
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      if (signal?.aborted) {
        throw new DOMException("Upload cancelled", "AbortError");
      }
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }).map(() => worker());
  await Promise.all(workers);
  return results;
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Upload failed";
}

function getFloodWaitSeconds(err: unknown) {
  if (typeof err !== "object" || !err || !("errorMessage" in err)) return null;
  const errorMessage = (err as { errorMessage?: unknown }).errorMessage;
  if (typeof errorMessage !== "string" || !errorMessage.startsWith("FLOOD_WAIT_")) return null;
  return parseInt(errorMessage.split("_").pop() || "", 10) || 30;
}

function getDynamicUploadConcurrency() {
  // Three independent chunks keep typical broadband uploads saturated while
  // staying below the rate at which Telegram commonly starts flood-waiting.
  return { segments: 3 };
}

/**
 * Upload a single blob chunk as a document to the topic.
 */
async function uploadChunk(
  client: TelegramClient,
  chatId: number,
  topicId: number,
  blob: Blob,
  partIndex: number,
  fileName: string,
  onChunkProgress?: (uploaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<number> {
  const chunkFileName = `${fileName}.part${String(partIndex).padStart(4, "0")}`;
  const fileToUpload = new File([blob], chunkFileName);

  if (signal?.aborted) {
    throw new DOMException("Upload cancelled", "AbortError");
  }

  const uploadedFile = await client.uploadFile({
    file: fileToUpload,
    fileName: chunkFileName,
    fileSize: fileToUpload.size,
    partSize: 512,
    requestsPerConnection: 8,
    progressCallback: (uploaded, total) => {
      onChunkProgress?.(uploaded, total);
    },
    abortSignal: signal,
  });

  const msg = await client.sendMedia(
    chatId,
    {
      type: "document",
      file: uploadedFile,
      fileName: chunkFileName,
      fileMime: "application/octet-stream",
    },
    {
      replyTo: topicId,
    }
  );

  if (signal?.aborted) {
    throw new DOMException("Upload cancelled", "AbortError");
  }

  return msg.id;
}

/**
 * Default upload chunk size: 500 MB (524,288,000 bytes) for all files.
 */
export function getUploadChunkSize(_fileSize?: number): number {
  const MB = 1024 * 1024;
  return 500 * MB;
}

/**
 * Orchestrate a full segmented file upload.
 */
export async function uploadFile(
  client: TelegramClient,
  config: DriveConfig,
  topicId: number,
  file: File,
  onProgress?: (p: UploadProgress) => void,
  fileId?: string,
  signal?: AbortSignal
): Promise<void> {
  const uploadChunkSize = getUploadChunkSize(file.size);
  const totalChunks = Math.ceil(file.size / uploadChunkSize);
  const finalFileId = fileId || `${file.name}-${Date.now()}`;
  const chatIdNumber = Number(config.chatId);

  const chunkProgress = new Float64Array(totalChunks);
  let currentStatus: UploadProgress["status"] = "preparing";
  let currentError: string | undefined;
  const startedAt = performance.now();

  const uploadedMsgIds: number[] = [];

  const emitProgress = () => {
    const totalUploadedBytes = chunkProgress.reduce((a, b) => a + b, 0);
    const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
    const speedBps = totalUploadedBytes / elapsedSeconds;

    onProgress?.({
      fileId: finalFileId,
      fileName: file.name,
      totalChunks,
      uploadedChunks: chunkProgress.filter((p, idx) => p >= Math.min(uploadChunkSize, file.size - idx * uploadChunkSize)).length,
      totalBytes: file.size,
      uploadedBytes: totalUploadedBytes,
      status: currentStatus,
      error: currentError,
      speedBps,
    });
  };

  const progressInterval = setInterval(emitProgress, 250);

  let abortPromise: Promise<never> | null = null;
  let abortHandler: (() => void) | null = null;
  if (signal) {
    abortPromise = new Promise((_, reject) => {
      abortHandler = () => reject(new DOMException("Upload cancelled", "AbortError"));
      signal.addEventListener("abort", abortHandler);
    });
  }

  try {
    if (signal?.aborted) {
      throw new DOMException("Upload cancelled", "AbortError");
    }

    emitProgress();
    const { segments } = getDynamicUploadConcurrency();

    // Start background thumbnail upload in parallel with chunk upload tasks
    const thumbPromise = (async (): Promise<number | undefined> => {
      try {
        const thumbBlob = await generateAnyThumbnail(file, file.name);
        if (!thumbBlob) return undefined;

        const thumbFile = new File([thumbBlob], `${file.name}.thumb.jpg`);
        const uploadedThumb = await client.uploadFile({
          file: thumbFile,
          fileName: thumbFile.name,
          fileSize: thumbFile.size,
        });
        const thumbMsg = await client.sendMedia(
          chatIdNumber,
          {
            type: "document",
            file: uploadedThumb,
            fileName: thumbFile.name,
            fileMime: "image/jpeg",
          },
          {
            replyTo: topicId,
          }
        );

        uploadedMsgIds.push(thumbMsg.id);
        return thumbMsg.id;
      } catch (thumbErr) {
        console.warn("Background thumbnail upload failed, proceeding without thumb:", thumbErr);
        return undefined;
      }
    })();

    const tasks = Array.from({ length: totalChunks }).map((_, i) => async () => {
      if (signal?.aborted) {
        throw new DOMException("Upload cancelled", "AbortError");
      }
      const start = i * uploadChunkSize;
      const end = Math.min(start + uploadChunkSize, file.size);
      const blob = file.slice(start, end);

      let attempts = 0;
      while (attempts < 10) {
        if (signal?.aborted) {
          throw new DOMException("Upload cancelled", "AbortError");
        }
        try {
          currentStatus = "uploading";
          await ensureConnected();
          const activeClient = await getHelperClient(i % 6);
          const msgId = await uploadChunk(
            activeClient,
            chatIdNumber,
            topicId,
            blob,
            i,
            file.name,
            (uploaded, _total) => {
              chunkProgress[i] = Math.max(chunkProgress[i], uploaded);
            },
            signal
          );
          if (signal?.aborted) {
            activeClient.deleteMessagesById(chatIdNumber, [msgId]).catch(() => {});
            throw new DOMException("Upload cancelled", "AbortError");
          }
          uploadedMsgIds.push(msgId);
          chunkProgress[i] = blob.size;
          return { index: i, msgId };
        } catch (err: unknown) {
          if (signal?.aborted) {
            throw new DOMException("Upload cancelled", "AbortError");
          }
          const floodWaitSeconds = getFloodWaitSeconds(err);
          if (floodWaitSeconds !== null) {
            const wait = floodWaitSeconds;
            console.warn(`FloodWait: sleeping ${wait}s then retrying chunk ${i}`);
            await new Promise((r) => setTimeout(r, wait * 1000));
            attempts++;
            continue;
          }
          attempts++;
          if (attempts < 10) {
            console.warn(`Upload chunk ${i} failed (attempt ${attempts}), retrying...`, err);
            await ensureConnected();
            await new Promise((r) => setTimeout(r, 1000 * Math.min(attempts, 5)));
            continue;
          }
          currentStatus = "error";
          currentError = getErrorMessage(err);
          emitProgress();
          throw err;
        }
      }
      currentStatus = "error";
      currentError = `Failed to upload chunk ${i}`;
      emitProgress();
      throw new Error(`Failed to upload chunk ${i}`);
    });

    let results: any[];
    const uploadPromise = runWithConcurrency(tasks, segments, signal);
    if (abortPromise) {
      results = await Promise.race([uploadPromise, abortPromise]);
    } else {
      results = await uploadPromise;
    }
    results.sort((a, b) => a.index - b.index);
    const chunkMsgIds = results.map((r) => r.msgId);

    if (signal?.aborted) {
      throw new DOMException("Upload cancelled", "AbortError");
    }

    currentStatus = "finalizing";
    emitProgress();

    // Await background thumbnail completion with a safety timeout fallback
    const thumbMsgId = await Promise.race([
      thumbPromise,
      new Promise<undefined>((r) => setTimeout(() => r(undefined), 10000)),
    ]);

    const manifestJson = buildManifest(file.name, file.size, chunkMsgIds, thumbMsgId, uploadChunkSize);

    await client.sendText(chatIdNumber, manifestJson, {
      replyTo: topicId,
    });

    currentStatus = "done";
    emitProgress();
  } catch (err: unknown) {
    const isAbort =
      signal?.aborted ||
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.message === "Upload cancelled");
    if (isAbort) {
      currentStatus = "error";
      currentError = "Upload cancelled";
      emitProgress();
    }

    if (uploadedMsgIds.length > 0) {
      client.deleteMessagesById(chatIdNumber, uploadedMsgIds).catch((deleteErr) => {
        console.warn("Failed to delete orphaned chunks after cancellation:", deleteErr);
      });
    }

    throw err;
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
    clearInterval(progressInterval);
  }
}
