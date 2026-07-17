import "server-only";
import { readdirSync, statSync, existsSync, rmSync } from "fs";
import { statfsSync } from "fs";
import { join, resolve, sep } from "path";
import { getAllItems } from "@/lib/library-store";
import { extractInfoHashFromMagnet } from "@/lib/torrent-cache-actions";
import { getDataDir } from "@/lib/data-dir";
import type {
  StorageEntry,
  StorageEntryKind,
  DiskSpace,
  StorageReport,
} from "@/types";

// Media-Agent storage floor: never let the disk fall below 8 GB free.
const FLOOR_BYTES = 8 * 1024 * 1024 * 1024;

export function getCachePath(): string {
  return join(getDataDir(), "cache");
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

// Recursive byte size of a file or directory.
function entrySize(p: string): number {
  let stat;
  try {
    stat = statSync(p);
  } catch {
    return 0;
  }
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;

  let total = 0;
  let children: string[] = [];
  try {
    children = readdirSync(p);
  } catch {
    return 0;
  }
  for (const child of children) {
    total += entrySize(join(p, child));
  }
  return total;
}

// Decode a magnet's dn= display name — this is what the worker names the cache folder.
function decodeDisplayName(magnet: string): string | null {
  const m = magnet.match(/[?&]dn=([^&]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {
    return m[1].replace(/\+/g, " ");
  }
}

interface ScannedEntry {
  name: string;
  sizeBytes: number;
}

// List immediate children of the cache dir (folders + stray files), with sizes.
export function scanCache(): ScannedEntry[] {
  const cachePath = getCachePath();
  if (!existsSync(cachePath)) return [];

  let names: string[] = [];
  try {
    names = readdirSync(cachePath);
  } catch {
    return [];
  }

  const entries: ScannedEntry[] = [];
  for (const name of names) {
    if (name.startsWith(".")) continue; // skip .DS_Store etc.
    entries.push({ name, sizeBytes: entrySize(join(cachePath, name)) });
  }
  return entries;
}

// Reconcile on-disk cache folders against the persisted library.
export function reconcile(): StorageEntry[] {
  const items = getAllItems();

  // Build lookup tables from library items: decoded display name + infoHash.
  const byName = new Map<string, string>(); // lowercased name -> libraryItemId
  const hashes: { hash: string; id: string }[] = [];
  for (const item of items) {
    const dn = decodeDisplayName(item.magnet);
    if (dn) byName.set(dn.toLowerCase(), item.id);
    const hash = extractInfoHashFromMagnet(item.magnet);
    if (hash) hashes.push({ hash, id: item.id });
  }

  return scanCache().map(({ name, sizeBytes }) => {
    let kind: StorageEntryKind;
    let libraryItemId: string | undefined;

    if (name === "subtitles") {
      kind = "subtitles";
    } else if (/_h264\.mp4$/i.test(name)) {
      kind = "transcode";
    } else {
      const lower = name.toLowerCase();
      const matchedId =
        byName.get(lower) ??
        hashes.find((h) => lower.includes(h.hash))?.id;
      if (matchedId) {
        kind = "matched";
        libraryItemId = matchedId;
      } else {
        kind = "orphan";
      }
    }

    return {
      name,
      sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      kind,
      libraryItemId,
    };
  });
}

// Delete a single cache entry from disk, with a hard guard against path escape.
// Returns the bytes reclaimed.
export function deleteCacheFolderFs(folderName: string): number {
  const cachePath = getCachePath();
  const target = resolve(cachePath, folderName);

  // Must stay strictly inside the cache directory.
  if (target === cachePath || !target.startsWith(cachePath + sep)) {
    throw new Error(`Refusing to delete outside cache dir: ${folderName}`);
  }
  if (!existsSync(target)) return 0;

  const reclaimed = entrySize(target);
  rmSync(target, { recursive: true, force: true });
  return reclaimed;
}

// Worker-independent cleanup: remove any cache folder matched to a library item.
// Call this while the item is still in the library (reconcile matches by its dn/infoHash).
// Returns bytes reclaimed.
export function deleteCacheForLibraryItem(id: string): number {
  let reclaimed = 0;
  for (const entry of reconcile()) {
    if (entry.libraryItemId === id) {
      reclaimed += deleteCacheFolderFs(entry.name);
    }
  }
  return reclaimed;
}

export function getDiskSpace(): DiskSpace {
  let freeBytes = 0;
  let totalBytes = 0;
  // Report space for whichever volume the active data dir currently lives on —
  // it may have moved (e.g. to an external drive) since the app started.
  for (const target of [getDataDir(), "/System/Volumes/Data", "/"]) {
    try {
      const stats = statfsSync(target);
      freeBytes = stats.bavail * stats.bsize;
      totalBytes = stats.blocks * stats.bsize;
      break;
    } catch {
      // try next fallback
    }
  }
  return {
    freeBytes,
    totalBytes,
    floorBytes: FLOOR_BYTES,
    belowFloor: freeBytes > 0 && freeBytes < FLOOR_BYTES,
  };
}

export function getStorageReport(): StorageReport {
  const entries = reconcile();
  const cacheTotalBytes = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
  return {
    disk: getDiskSpace(),
    cacheTotalBytes,
    cacheTotalFormatted: formatBytes(cacheTotalBytes),
    entries,
  };
}
