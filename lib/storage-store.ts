import "server-only";
import { readdirSync, statSync, existsSync, rmSync, unlinkSync } from "fs";
import { statfsSync } from "fs";
import { join, resolve, sep } from "path";
import { getAllItems } from "@/lib/library-store";
import { extractInfoHashFromMagnet } from "@/lib/torrent-cache-actions";
import { getDataDir } from "@/lib/data-dir";
import type {
  LibraryItem,
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

// Bytes a single file actually occupies. WebTorrent writes sparse files, so a
// partly-downloaded 4 GB episode reports 4 GB under stat.size while holding a
// fraction of that on disk — `blocks` is the honest number.
export function allocatedSize(p: string): number {
  try {
    const stat = statSync(p);
    if (!stat.isFile()) return 0;
    return typeof stat.blocks === "number" ? stat.blocks * 512 : stat.size;
  } catch {
    return 0;
  }
}

// Recursive allocated size of a file or directory.
function entrySize(p: string): number {
  let stat;
  try {
    stat = statSync(p);
  } catch {
    return 0;
  }
  if (stat.isFile()) {
    return typeof stat.blocks === "number" ? stat.blocks * 512 : stat.size;
  }
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

// Decode a magnet's dn= display name — the closest thing to the torrent's name
// we can know without asking the worker.
function decodeDisplayName(magnet: string): string | null {
  const m = magnet.match(/[?&]dn=([^&]+)/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {
    return m[1].replace(/\+/g, " ");
  }
}

// Strip everything but alphanumerics so release naming noise (dots, spaces,
// dashes, tracker prefixes) stops defeating comparison.
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Find the library item a cache folder belongs to.
 *
 * Torrent names routinely differ from the magnet's `dn=` — e.g. the folder
 * "www.UIndex.org    -    Invincible.2021.S04E07.1080p.WEB.h264-ETHEL" against
 * dn "Invincible.2021.S04E07.1080p.WEB.h264-ETHEL". Exact equality misses those
 * and mislabels a library item's cache as an orphan, which also makes the
 * worker-independent delete path a silent no-op.
 */
function matchEntryToItem(name: string, items: LibraryItem[]): string | undefined {
  // 1. The real folder name, recorded once the torrent resolved.
  const exact = items.find((i) => i.cacheFolder === name);
  if (exact) return exact.id;

  const lower = name.toLowerCase();
  const norm = normalizeName(name);

  // 2. infoHash embedded in the folder name.
  const byHash = items.find((i) => {
    const hash = i.infoHash ?? extractInfoHashFromMagnet(i.magnet);
    return hash ? lower.includes(hash.toLowerCase()) : false;
  });
  if (byHash) return byHash.id;

  // 3. Normalized containment in either direction. The longest matching key
  //    wins so a specific release name beats a short library label.
  let best: { id: string; len: number } | undefined;
  for (const item of items) {
    const dn = decodeDisplayName(item.magnet);
    for (const candidate of [dn, item.name]) {
      if (!candidate) continue;
      const key = normalizeName(candidate);
      if (key.length < 8) continue; // too short to be a confident match
      if (norm.includes(key) || key.includes(norm)) {
        if (!best || key.length > best.len) best = { id: item.id, len: key.length };
      }
    }
  }
  return best?.id;
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

  return scanCache().map(({ name, sizeBytes }) => {
    let kind: StorageEntryKind;
    let libraryItemId: string | undefined;

    if (name === "subtitles") {
      kind = "subtitles";
    } else if (/_h264\.mp4(\.done)?$/i.test(name)) {
      kind = "transcode";
    } else {
      libraryItemId = matchEntryToItem(name, items);
      kind = libraryItemId ? "matched" : "orphan";
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

// Bytes on disk per library item id — one cache scan, reused for per-item and
// per-folder totals in the library API.
export function getUsageByItem(): Map<string, number> {
  const usage = new Map<string, number>();
  for (const entry of reconcile()) {
    if (!entry.libraryItemId) continue;
    usage.set(entry.libraryItemId, (usage.get(entry.libraryItemId) ?? 0) + entry.sizeBytes);
  }
  return usage;
}

// Guard shared by every delete path: the resolved target must sit strictly
// inside the cache directory.
function resolveInsideCache(relPath: string): string {
  const cachePath = getCachePath();
  const target = resolve(cachePath, relPath);
  if (target === cachePath || !target.startsWith(cachePath + sep)) {
    throw new Error(`Refusing to delete outside cache dir: ${relPath}`);
  }
  return target;
}

// Delete a single cache entry from disk. Returns the bytes reclaimed.
export function deleteCacheFolderFs(folderName: string): number {
  const target = resolveInsideCache(folderName);
  if (!existsSync(target)) return 0;

  const reclaimed = entrySize(target);
  rmSync(target, { recursive: true, force: true });
  return reclaimed;
}

// Delete one file inside the cache dir (a single episode of a season pack).
// Returns the bytes reclaimed.
export function deleteCacheFile(relPath: string): number {
  const target = resolveInsideCache(relPath);
  if (!existsSync(target)) return 0;
  if (!statSync(target).isFile()) {
    throw new Error(`Not a file: ${relPath}`);
  }

  const reclaimed = allocatedSize(target);
  unlinkSync(target);
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
