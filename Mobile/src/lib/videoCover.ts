import type { TelegramClient } from "@mtcute/web";
import type { DriveConfig, DriveFile } from "../types";
import { downloadFilePrefix, downloadFileRange } from "./downloader";
import { generateVideoThumbnail } from "./uploader";

/**
 * Optimized video cover generation for on-the-fly thumbnails.
 *
 * Long videos (phone recordings) usually store the `moov` atom at the END
 * of the file, so a plain head prefix can never be decoded. Strategy:
 *
 *  1. Download the head in stages (1.5 MB → 4 MB → 8 MB) and try to decode
 *     right away for faststart files.
 *  2. For ISO-BMFF files (mp4/mov/3gp) whose head starts with `mdat` (moov
 *     at the end), fetch the file tail, extract `moov`, and stitch a
 *     decodable file: ftyp/head-boxes + moov + mdat-head, patching the
 *     stco/co64 chunk offsets so samples point into the head mdat.
 *  3. Negative cache (session): failed covers are not retried for 30 min,
 *     avoiding repeated multi-MB downloads for undecodable files.
 */

const STAGE_LIMITS = [
  1.5 * 1024 * 1024,
  4 * 1024 * 1024,
  8 * 1024 * 1024,
];
const HEAD_MDAT_BYTES = 4 * 1024 * 1024;
const TAIL_LIMITS = [2 * 1024 * 1024, 4 * 1024 * 1024, 8 * 1024 * 1024];
const NEGATIVE_TTL = 30 * 60 * 1000;

const failedCovers = new Map<string, number>();

const MP4_FAMILY = ["mp4", "m4v", "mov", "3gp", "m4a", "3g2"];

function u32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0
  );
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

function readU64(data: Uint8Array, offset: number): number {
  const hi = u32(data, offset);
  const lo = u32(data, offset + 4);
  return hi * 4294967296 + lo;
}

function writeU64(data: Uint8Array, offset: number, value: number): void {
  writeU32(data, offset, Math.floor(value / 4294967296));
  writeU32(data, offset + 4, value >>> 0);
}

function boxType(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset + 4],
    data[offset + 5],
    data[offset + 6],
    data[offset + 7]
  );
}

/**
 * Walk ISO-BMFF top-level boxes. `cb` returning true stops the walk.
 * Returns the byte offset right after the last visited box.
 */
function walkBoxes(data: Uint8Array, cb: (type: string, start: number, size: number) => boolean | void): void {
  let offset = 0;
  while (offset + 8 <= data.length) {
    let size = u32(data, offset);
    let headerLen = 8;
    if (size === 1) {
      if (offset + 16 > data.length) break;
      size = readU64(data, offset + 8);
      headerLen = 16;
    } else if (size === 0) {
      size = data.length - offset;
    }
    if (size < headerLen || offset + size > data.length) break;
    const stop = cb(boxType(data, offset), offset, size);
    if (stop === true) return;
    offset += size;
  }
}

/**
 * Locate a box by scanning for its type signature. The tail of a real MP4
 * starts with mdat payload bytes, so a structural walk from offset 0 would
 * break on garbage; a byte scan tolerates it.
 */
function findBox(data: Uint8Array, want: string): { start: number; size: number } | null {
  const w0 = want.charCodeAt(0);
  const w1 = want.charCodeAt(1);
  const w2 = want.charCodeAt(2);
  const w3 = want.charCodeAt(3);
  for (let offset = 0; offset + 8 <= data.length; offset++) {
    if (data[offset + 4] !== w0 || data[offset + 5] !== w1 || data[offset + 6] !== w2 || data[offset + 7] !== w3) {
      continue;
    }
    let size = u32(data, offset);
    let headerLen = 8;
    if (size === 1) {
      if (offset + 16 > data.length) continue;
      size = readU64(data, offset + 8);
      headerLen = 16;
    } else if (size === 0) {
      size = data.length - offset;
    }
    if (size >= headerLen && offset + size <= data.length) {
      return { start: offset, size };
    }
  }
  return null;
}

interface HeadScan {
  moovStart: number;
  mdatStart: number;
  fragmented: boolean;
}

function scanHead(data: Uint8Array): HeadScan {
  const result: HeadScan = { moovStart: -1, mdatStart: -1, fragmented: false };
  walkBoxes(data, (type, start) => {
    if (type === "moov") {
      result.moovStart = start;
      return true;
    }
    if (type === "moof" || type === "sidx") {
      result.fragmented = true;
      return true;
    }
    if (type === "mdat") {
      result.mdatStart = start;
      return true;
    }
  });
  return result;
}

/**
 * Rewrite stco/co64 chunk offsets inside a moov box so samples point at the
 * head mdat of the stitched file. `delta` = originalMdatStart - stitchedMdatStart
 * (entries inside the original mdat become `entry - delta`). `clampMax` caps
 * entries that point beyond the available head data.
 */
function patchChunkOffsets(moov: Uint8Array, delta: number, clampMax: number): void {
  const isContainer = (t: string) =>
    t === "moov" || t === "trak" || t === "mdia" || t === "minf" || t === "stbl";

  const walk = (start: number, end: number): void => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = u32(moov, offset);
      let headerLen = 8;
      if (size === 1) {
        if (offset + 16 > end) break;
        size = readU64(moov, offset + 8);
        headerLen = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerLen || offset + size > end) break;

      const type = boxType(moov, offset);
      if (type === "stco" || type === "co64") {
        const count = u32(moov, offset + headerLen + 4);
        const entryBytes = type === "co64" ? 8 : 4;
        for (let i = 0; i < count; i++) {
          const p = offset + headerLen + 8 + i * entryBytes;
          if (p + entryBytes > end) break;
          const entry = type === "co64" ? readU64(moov, p) : u32(moov, p);
          if (entry >= delta) {
            const adjusted = Math.min(entry - delta, clampMax);
            if (type === "co64") writeU64(moov, p, adjusted);
            else writeU32(moov, p, adjusted);
          }
        }
      } else if (isContainer(type)) {
        walk(offset + headerLen, offset + size);
      }
      offset += size;
    }
  };

  walk(0, moov.length);
}

async function generateFromBlob(blob: Blob): Promise<Blob | null> {
  return generateVideoThumbnail(blob);
}

/**
 * Fetch the file tail with a growing window (2→4→8 MB) until a full `moov`
 * is found. Long videos have large moov atoms, so a fixed-size tail misses
 * them (that previously failed the cover and re-downloaded it per stage).
 */
async function fetchTailWithMoov(
  file: DriveFile,
  client: TelegramClient,
  driveConfig: DriveConfig
): Promise<Uint8Array | null> {
  for (const tailBytes of TAIL_LIMITS) {
    if (tailBytes > file.size) continue;
    const range = await downloadFileRange(
      client,
      driveConfig,
      String(file.id),
      file.manifest,
      Math.max(0, file.size - tailBytes),
      tailBytes
    );
    if (!range || range.length === 0) return null;
    if (findBox(range, "moov")) return range;
  }
  return null;
}

/**
 * Build a decodable MP4: head (up to mdat) + moov (from tail) + head mdat,
 * patching stco/co64 chunk offsets so samples point into the head mdat.
 */
function buildStitched(
  file: DriveFile,
  head: Uint8Array,
  mdatStart: number,
  tail: Uint8Array
): Blob | null {
  const moov = findBox(tail, "moov");
  if (!moov || moov.size <= 8) return null;

  const moovBytes = tail.subarray(moov.start, moov.start + moov.size);
  const headUpToMdat = head.subarray(0, mdatStart);
  if (headUpToMdat.length === 0) return null;

  const mdatHeaderLen = u32(head, mdatStart) === 1 ? 16 : 8;
  const availMdat = head.length - (mdatStart + mdatHeaderLen);
  const mdatHeadLen = Math.min(HEAD_MDAT_BYTES, Math.max(0, availMdat));
  if (mdatHeadLen <= 0) return null;

  const stitchedMdatStart = headUpToMdat.length + moovBytes.length;
  const delta = mdatStart - stitchedMdatStart;
  patchChunkOffsets(moovBytes, delta, headUpToMdat.length + moovBytes.length + mdatHeaderLen + mdatHeadLen);

  const stitched = new Uint8Array(stitchedMdatStart + mdatHeaderLen + mdatHeadLen);
  stitched.set(headUpToMdat, 0);
  stitched.set(moovBytes, headUpToMdat.length);
  stitched.set(head.subarray(mdatStart, mdatStart + mdatHeaderLen + mdatHeadLen), stitchedMdatStart);

  return new Blob([stitched.slice()], { type: "video/mp4" });
}

/**
 * Best-effort cover (first frame) for a video file stored remotely on
 * Telegram. Returns null when no cover can be produced (placeholder icon).
 */
export async function generateVideoCover(
  file: DriveFile,
  client: TelegramClient,
  driveConfig: DriveConfig
): Promise<Blob | null> {
  const fileIdStr = String(file.id);

  const failedAt = failedCovers.get(fileIdStr);
  if (failedAt !== undefined) {
    if (Date.now() < failedAt) return null;
    failedCovers.delete(fileIdStr);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isIsoBmff = MP4_FAMILY.includes(ext);

  const fetchHead = async (limit: number): Promise<Uint8Array | null> => {
    try {
      return await downloadFilePrefix(client, driveConfig, fileIdStr, file.manifest, limit);
    } catch (err) {
      console.warn("Failed to fetch video head for cover", fileIdStr, err);
      return null;
    }
  };

  /* Most phone MP4s have the moov at the end: the tail is downloaded IN
     PARALLEL with the head (a single network round-trip instead of
     sequential head+tail) and is reused across all stages. */
  const tailPromise = isIsoBmff
    ? fetchTailWithMoov(file, client, driveConfig)
    : Promise.resolve<Uint8Array | null>(null);

  for (const limit of STAGE_LIMITS) {
    const head = await fetchHead(limit);
    if (!head || head.length === 0) {
      console.warn(`[COVER] ${file.name}: head stage ${limit} empty`);
      break;
    }

    if (isIsoBmff) {
      const scan = scanHead(head);
      if (scan.fragmented) break; // fMP4: no single moov → give up
      if (scan.moovStart >= 0) {
        // faststart → decode the head directly
        const blob = await generateFromBlob(new Blob([head.slice()], { type: "video/mp4" }));
        if (blob) return blob;
        console.warn(`[COVER] ${file.name}: faststart decode failed (head ${limit})`);
        continue;
      }
      if (scan.mdatStart >= 0) {
        // moov at the end → NO attempts to decode the head (it cannot
        // decode: up to 5 s timeout per attempt = the "delay" of long
        // video covers). Use the tail already downloaded in parallel.
        const tail = await tailPromise;
        if (tail) {
          const blob = buildStitched(file, head, scan.mdatStart, tail);
          if (blob) {
            const result = await generateFromBlob(blob);
            if (result) return result;
            console.warn(`[COVER] ${file.name}: stitched decode failed (head ${limit}, tail ${tail.length})`);
          } else {
            console.warn(`[COVER] ${file.name}: buildStitched null (head ${limit}, tail ${tail.length})`);
          }
        } else {
          console.warn(`[COVER] ${file.name}: no tail with moov`);
        }
        continue; // still no moov or mdat → bigger head (more mdat in the stitch)
      }
      console.warn(`[COVER] ${file.name}: head ${limit} has neither moov nor mdat`);
      continue;
    }

    // Non-ISO-BMFF (webm/mkv/...): try to decode the head directly
    const blob = await generateFromBlob(new Blob([head.slice()], { type: "video/webm" }));
    if (blob) return blob;
    console.warn(`[COVER] ${file.name}: non-BMFF decode failed (head ${limit})`);
  }

  failedCovers.set(fileIdStr, Date.now() + NEGATIVE_TTL);
  return null;
}