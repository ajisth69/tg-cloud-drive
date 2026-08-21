import JSZip from "jszip";
import { generateImageThumbnail, generateVideoThumbnail } from "./uploader";

/**
 * Fast ZIP archive loader using slicing and checkCRC32: false.
 */
async function loadZipFast(file: File | Blob): Promise<JSZip> {
  const checkCRC32 = false;
  const targetBlob = file.size > 24 * 1024 * 1024 ? file.slice(0, 24 * 1024 * 1024) : file;
  try {
    const zip = await JSZip.loadAsync(targetBlob, { checkCRC32 });
    if (Object.keys(zip.files).length > 0) return zip;
    throw new Error("Empty zip slice");
  } catch {
    return await JSZip.loadAsync(file, { checkCRC32 });
  }
}

/**
 * Extract cover art image from EPUB files.
 */
export async function generateEpubThumbnail(file: File | Blob): Promise<Blob | null> {
  try {
    const zip = await loadZipFast(file);
    const fileKeys = Object.keys(zip.files).filter((fn) => !zip.files[fn].dir);

    const isRasterImage = (fn: string) => /\.(png|webp|jpg|jpeg)$/i.test(fn);
    let coverEntry = fileKeys.find((fn) => isRasterImage(fn) && /(^|\/)(cover|cover-image|page-1|titlepage)\.(png|jpeg|jpg|webp)$/i.test(fn));

    if (!coverEntry) {
      coverEntry = fileKeys.find((fn) => isRasterImage(fn) && /cover/i.test(fn));
    }

    if (!coverEntry) {
      coverEntry = fileKeys.find((fn) => isRasterImage(fn) && /(images|img)\//i.test(fn));
    }

    if (!coverEntry) {
      coverEntry = fileKeys.find((fn) => isRasterImage(fn));
    }

    if (!coverEntry) return null;

    const imgBlob = await zip.files[coverEntry].async("blob");
    return await generateImageThumbnail(imgBlob);
  } catch {
    return null;
  }
}

/**
 * Helper to extract embedded thumbnail/image from DOCX files.
 */
export async function generateDocxThumbnail(file: File | Blob): Promise<Blob | null> {
  try {
    const zip = await loadZipFast(file);

    let thumbEntry = zip.files["docProps/thumbnail.jpeg"] || zip.files["docProps/thumbnail.png"];

    if (!thumbEntry) {
      const mediaFile = Object.keys(zip.files).find(
        (fn) => !zip.files[fn].dir && /^word\/media\/image1\.(png|jpeg|jpg|webp)$/i.test(fn)
      );
      if (mediaFile) {
        thumbEntry = zip.files[mediaFile];
      }
    }

    if (!thumbEntry) return null;

    const imgBlob = await thumbEntry.async("blob");
    return await generateImageThumbnail(imgBlob);
  } catch {
    return null;
  }
}

/**
 * Helper to extract embedded thumbnail/image from XLSX files.
 */
export async function generateXlsxThumbnail(file: File | Blob): Promise<Blob | null> {
  try {
    const zip = await loadZipFast(file);

    let thumbEntry = zip.files["docProps/thumbnail.jpeg"] || zip.files["docProps/thumbnail.png"];

    if (!thumbEntry) {
      const mediaFile = Object.keys(zip.files).find(
        (fn) => !zip.files[fn].dir && /^xl\/media\/image1\.(png|jpeg|jpg|webp)$/i.test(fn)
      );
      if (mediaFile) {
        thumbEntry = zip.files[mediaFile];
      }
    }

    if (!thumbEntry) return null;

    const imgBlob = await thumbEntry.async("blob");
    return await generateImageThumbnail(imgBlob);
  } catch {
    return null;
  }
}

function readLE32(arr: Uint8Array, off: number): number {
  return (arr[off] | (arr[off + 1] << 8) | (arr[off + 2] << 16) | (arr[off + 3] << 24)) >>> 0;
}

function readBE32(arr: Uint8Array, off: number): number {
  return ((arr[off] << 24) | (arr[off + 1] << 16) | (arr[off + 2] << 8) | arr[off + 3]) >>> 0;
}

async function extractOggCoverArt(bytes: Uint8Array): Promise<Blob | null> {

  // Build array of all Ogg pages: { offset, payload }
  const pages: { offset: number; payload: Uint8Array }[] = [];
  let fpos = 0;

  while (fpos < bytes.length - 27) {
    if (bytes[fpos] !== 0x4f || bytes[fpos + 1] !== 0x67 ||
        bytes[fpos + 2] !== 0x67 || bytes[fpos + 3] !== 0x53) {
      fpos++; continue;
    }

    const segCount = bytes[fpos + 26];
    const hdrLen = 27 + segCount;
    if (fpos + hdrLen > bytes.length) break;

    let payloadLen = 0;
    for (let i = 0; i < segCount; i++) payloadLen += bytes[fpos + 27 + i];

    const pStart = fpos + hdrLen;
    if (pStart + payloadLen > bytes.length) break;

    pages.push({ offset: fpos, payload: bytes.slice(pStart, pStart + payloadLen) });
    fpos += hdrLen + payloadLen;
  }

  // Reassemble logical packets across pages using segment table.
  // Segment == 255 means packet continues in next segment/page.
  // Segment < 255 means end of logical packet.
  const packets: Uint8Array[] = [];
  let packetChunks: Uint8Array[] = [];
  let packetLen = 0;

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    const pageOffset = page.offset;
    const segCount = bytes[pageOffset + 26];
    const segTable = pageOffset + 27;

    let payloadByte = 0;
    for (let si = 0; si < segCount; si++) {
      const segLen = bytes[segTable + si];
      packetChunks.push(page.payload.slice(payloadByte, payloadByte + segLen));
      packetLen += segLen;
      payloadByte += segLen;

      if (segLen < 255) {
        const merged = new Uint8Array(packetLen);
        let off = 0;
        for (const ch of packetChunks) { merged.set(ch, off); off += ch.length; }
        packets.push(merged);
        packetChunks = [];
        packetLen = 0;
      }
    }
  }

  // Find Vorbis Comments / OpusTags packet
  for (let pi = 0; pi < packets.length; pi++) {
    const pkt = packets[pi];
    if (pkt.length < 15) continue;

    let commentData: Uint8Array | null = null;

    // Vorbis: type 0x03 + "vorbis"
    if (pkt[0] === 0x03 && pkt.slice(1, 7).every((b, i) => b === [0x76, 0x6f, 0x72, 0x62, 0x69, 0x73][i])) {
      commentData = pkt.slice(7);
    }
    // OpusTags
    else if (pkt.slice(0, 8).every((b, i) => b === [0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73][i])) {
      commentData = pkt.slice(8);
    }

    if (!commentData) continue;

    try {
      let p = 0;
      const vendorLen = readLE32(commentData, p); p += 4 + vendorLen;
      if (p + 4 > commentData.length) continue;
      const commentCount = readLE32(commentData, p); p += 4;

      for (let c = 0; c < commentCount && p + 4 <= commentData.length; c++) {
        const cLen = readLE32(commentData, p); p += 4;
        if (p + cLen > commentData.length) break;

        const cb = commentData.slice(p, p + cLen);
        let eqIdx = -1;
        for (let e = 0; e < Math.min(cb.length, 256); e++) {
          if (cb[e] === 0x3d) { eqIdx = e; break; }
        }

        if (eqIdx > 0) {
          const key = String.fromCharCode(...cb.slice(0, eqIdx));
          if (key.toUpperCase() === "METADATA_BLOCK_PICTURE") {
            const decoder = new TextDecoder("utf-8", { fatal: false });
            const b64 = decoder.decode(cb.slice(eqIdx + 1)).trim();
            const bin = atob(b64);
            const bb = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bb[i] = bin.charCodeAt(i);

            if (bb.length > 32) {
              let bp = 4;
              const mimeLen = readBE32(bb, bp); bp += 4 + mimeLen;
              const descLen = readBE32(bb, bp); bp += 4 + descLen + 16;
              const dataLen = readBE32(bb, bp); bp += 4;

              if (bp + dataLen <= bb.length && dataLen > 0) {
                const img = bb.slice(bp, bp + dataLen);
                let mime = "image/jpeg";
                if (img[0] === 0x89 && img[1] === 0x50) mime = "image/png";
                else if (img[0] === 0x52 && img[1] === 0x49) mime = "image/webp";
                const res = await generateImageThumbnail(new Blob([img], { type: mime }));
                if (res) return res;
              }
            }
          }
        }
        p += cLen;
      }

      // If we didn't parse all comments (packet truncated), try to find
      // METADATA_BLOCK_PICTURE base64 in remaining data + subsequent packets
      if (p < commentData.length) {
        const remaining = commentData.slice(p);
        const decoder = new TextDecoder("utf-8", { fatal: false });

        // Concatenate remaining with up to 200 subsequent packets
        let contText = decoder.decode(remaining);
        for (let pi2 = pi + 1; pi2 < Math.min(packets.length, pi + 200); pi2++) {
          contText += decoder.decode(packets[pi2]);
        }

        const allB64 = contText.match(/[A-Za-z0-9+/=]{100,}/g);
        if (allB64) {
          for (const candidate of allB64) {
            try {
              const bin = atob(candidate);
              const bb = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) bb[i] = bin.charCodeAt(i);
              if (bb.length > 32) {
                let bp = 4;
                const mimeLen = readBE32(bb, bp); bp += 4 + mimeLen;
                const descLen = readBE32(bb, bp); bp += 4 + descLen + 16;
                const dataLen = readBE32(bb, bp); bp += 4;
                if (bp + dataLen <= bb.length && dataLen > 0) {
                  const img = bb.slice(bp, bp + dataLen);
                  if ((img[0] === 0xff && img[1] === 0xd8) || (img[0] === 0x89 && img[1] === 0x50)) {
                    let mime = img[0] === 0x89 ? "image/png" : "image/jpeg";
                    const res = await generateImageThumbnail(new Blob([img], { type: mime }));
                    if (res) return res;
                  }
                }
              }
            } catch { /* skip bad candidate */ }
          }
        }
      }
    } catch (e) {
      // silent
    }
  }

  return null;
}

/**
 * Helper to extract embedded album artwork from audio files (MP3, M4A, FLAC, Opus, etc.).
 */
export async function generateAudioThumbnail(file: File | Blob): Promise<Blob | null> {
  try {
    const bufferSize = Math.min(file.size, 256 * 1024);
    const slice = file.slice(0, bufferSize);
    const arrayBuffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Ogg container (Opus, Vorbis, FLAC-in-Ogg) — need more data for METADATA_BLOCK_PICTURE
    if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
      const bigSlice = file.slice(0, Math.min(file.size, 16 * 1024 * 1024));
      const bigBuf = await bigSlice.arrayBuffer();
      const oggResult = await extractOggCoverArt(new Uint8Array(bigBuf));
      if (oggResult) return oggResult;
    }

    if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
      const majorVersion = bytes[3];
      const tagSize =
        ((bytes[6] & 0x7f) << 21) |
        ((bytes[7] & 0x7f) << 14) |
        ((bytes[8] & 0x7f) << 7) |
        (bytes[9] & 0x7f);

      let offset = 10;
      const maxOffset = Math.min(bytes.length, tagSize + 10);

      while (offset < maxOffset - 10) {
        const frameId = String.fromCharCode(
          bytes[offset],
          bytes[offset + 1],
          bytes[offset + 2],
          bytes[offset + 3]
        );

        let frameSize = 0;
        if (majorVersion === 4) {
          frameSize =
            ((bytes[offset + 4] & 0x7f) << 21) |
            ((bytes[offset + 5] & 0x7f) << 14) |
            ((bytes[offset + 6] & 0x7f) << 7) |
            (bytes[offset + 7] & 0x7f);
        } else {
          frameSize =
            (bytes[offset + 4] << 24) |
            (bytes[offset + 5] << 16) |
            (bytes[offset + 6] << 8) |
            bytes[offset + 7];
        }

        if (frameSize <= 0 || offset + 10 + frameSize > bytes.length) break;

        if (frameId === "APIC" || frameId === "PIC") {
          let contentOffset = offset + 10;
          const encoding = bytes[contentOffset];
          contentOffset++;

          let mimeType = "image/jpeg";
          if (frameId === "APIC") {
            let mimeEnd = contentOffset;
            while (mimeEnd < contentOffset + 32 && bytes[mimeEnd] !== 0) mimeEnd++;
            mimeType = String.fromCharCode(...bytes.subarray(contentOffset, mimeEnd)) || "image/jpeg";
            contentOffset = mimeEnd + 1;
          } else {
            contentOffset += 3;
          }

          contentOffset++;

          if (encoding === 0 || encoding === 3) {
            while (contentOffset < offset + 10 + frameSize && bytes[contentOffset] !== 0) {
              contentOffset++;
            }
            contentOffset++;
          } else {
            while (
              contentOffset < offset + 10 + frameSize - 1 &&
              !(bytes[contentOffset] === 0 && bytes[contentOffset + 1] === 0)
            ) {
              contentOffset += 2;
            }
            contentOffset += 2;
          }

          const imgData = bytes.subarray(contentOffset, offset + 10 + frameSize);
          if (imgData.length > 0) {
            try {
              const rawBlob = new Blob([imgData], { type: mimeType });
              const res = await generateImageThumbnail(rawBlob);
              if (res) return res;
            } catch {
              // Continue
            }
          }
        }

        offset += 10 + frameSize;
      }
    }

    for (let i = 0; i < bytes.length - 8; i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
        for (let j = i + 4; j < Math.min(bytes.length - 1, i + 500000); j++) {
          if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
            const imgData = bytes.subarray(i, j + 2);
            try {
              const rawBlob = new Blob([imgData], { type: "image/jpeg" });
              const res = await generateImageThumbnail(rawBlob);
              if (res) return res;
            } catch {
              break;
            }
          }
        }
      }
      if (
        bytes[i] === 0x89 &&
        bytes[i + 1] === 0x50 &&
        bytes[i + 2] === 0x4e &&
        bytes[i + 3] === 0x47
      ) {
        for (let j = i + 8; j < Math.min(bytes.length - 8, i + 500000); j++) {
          if (
            bytes[j] === 0x49 &&
            bytes[j + 1] === 0x45 &&
            bytes[j + 2] === 0x4e &&
            bytes[j + 3] === 0x44
          ) {
            const imgData = bytes.subarray(i, j + 8);
            try {
              const rawBlob = new Blob([imgData], { type: "image/png" });
              const res = await generateImageThumbnail(rawBlob);
              if (res) return res;
            } catch {
              break;
            }
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

let pdfjsPromise: Promise<any> | null = null;

function loadPdfJs(): Promise<any> {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    try {
      const dynamicImport = new Function("moduleName", "return import(moduleName)");
      const pdfjsLib = await dynamicImport("pdfjs-dist");
      if (pdfjsLib && pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
      }
      return pdfjsLib;
    } catch {
      return null;
    }
  })();
  return pdfjsPromise;
}

/**
 * Render first page of PDF onto canvas and return blob thumbnail.
 */
export async function generatePdfThumbnail(file: File | Blob): Promise<Blob | null> {
  try {
    const pdfjsLib = await loadPdfJs();
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    if (pdf.numPages === 0) return null;

    const page = await pdf.getPage(1);
    const initialViewport = page.getViewport({ scale: 1.0 });

    const targetMaxDim = 640;
    const scale = Math.min(
      targetMaxDim / initialViewport.width,
      targetMaxDim / initialViewport.height
    );
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");

    if (!ctx) return null;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    return new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) {
          generateImageThumbnail(blob).then(resolve).catch(() => resolve(null));
        } else {
          resolve(null);
        }
      }, "image/jpeg", 0.9);
    });
  } catch {
    return null;
  }
}

/**
 * Unified thumbnail generator dispatcher for video, epub, pdf, docx, xlsx, audio, images, and files <= 6MB.
 * Excludes zip, apk, and binary executables.
 */
export async function generateAnyThumbnail(file: File | Blob, fileName: string): Promise<Blob | null> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const EXCLUDED_THUMB_EXTS = ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "apk", "apks", "xapk", "exe", "msi", "dmg", "pkg", "iso", "bin"];
  if (EXCLUDED_THUMB_EXTS.includes(ext)) return null;

  const isVideo = ["mp4", "webm", "mkv", "avi", "mov", "3gp", "flv", "ts"].includes(ext);
  const isImage = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "heic", "tiff"].includes(ext);
  const isEpub = ext === "epub";
  const isAudio = ["mp3", "flac", "wav", "m4a", "ogg", "aac", "dsf", "dff", "opus", "oga", "caf", "wma", "ape", "alac", "mka"].includes(ext);
  const isPdf = ext === "pdf";
  const isDocx = ext === "docx" || ext === "doc";
  const isXlsx = ext === "xlsx" || ext === "xls";

  try {
    if (isVideo) return await generateVideoThumbnail(file);
    if (isEpub) return await generateEpubThumbnail(file);
    if (isAudio) return await generateAudioThumbnail(file);
    if (isPdf) return await generatePdfThumbnail(file);
    if (isDocx) return await generateDocxThumbnail(file);
    if (isXlsx) return await generateXlsxThumbnail(file);
    if (isImage) return await generateImageThumbnail(file);
    if (file.size <= 6 * 1024 * 1024) return await generateImageThumbnail(file);
  } catch (err) {
    console.warn("Failed to generate thumbnail for", fileName, err);
  }
  return null;
}
