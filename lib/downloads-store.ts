import "server-only";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/data-dir";
import { getTorrentEngine } from "@/lib/torrent-engine";

/**
 * Files the user pressed Download on. The worker keeps pins only in memory, so
 * this list is what lets a restart pick them back up (see app/api/downloads).
 */
export interface DownloadEntry {
  infoHash: string; // lowercase
  fileIndex: number;
  magnet: string;
  title: string;
  size: number;
  addedAt: number;
  /** Paused by the user: kept on disk, not fetched, skipped on restart. */
  paused?: boolean;
}

export function downloadId(infoHash: string, fileIndex: number): string {
  return `${infoHash.toLowerCase()}:${fileIndex}`;
}

function getDownloadsPath(): string {
  return join(getDataDir(), "downloads.json");
}

export function listDownloads(): DownloadEntry[] {
  const path = getDownloadsPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDownloads(entries: DownloadEntry[]): void {
  writeFileSync(getDownloadsPath(), JSON.stringify(entries, null, 2));
}

/** Add or replace (same infoHash + fileIndex) a download. */
export function addDownload(
  entry: Omit<DownloadEntry, "addedAt"> & { addedAt?: number }
): DownloadEntry {
  const saved: DownloadEntry = {
    ...entry,
    infoHash: entry.infoHash.toLowerCase(),
    addedAt: entry.addedAt ?? Date.now(),
  };
  const id = downloadId(saved.infoHash, saved.fileIndex);
  const rest = listDownloads().filter((d) => downloadId(d.infoHash, d.fileIndex) !== id);
  saveDownloads([...rest, saved]);
  return saved;
}

/** Forget one file's download, or every file of the torrent when fileIndex is omitted. */
export function removeDownload(infoHash: string, fileIndex?: number): void {
  const hash = infoHash.toLowerCase();
  const all = listDownloads();
  const kept = all.filter(
    (d) => d.infoHash !== hash || (fileIndex !== undefined && d.fileIndex !== fileIndex)
  );
  if (kept.length !== all.length) saveDownloads(kept);
}

/** Mark a download paused or running. */
export function setPaused(infoHash: string, fileIndex: number, paused: boolean): DownloadEntry | null {
  const id = downloadId(infoHash, fileIndex);
  const all = listDownloads();
  const entry = all.find((d) => downloadId(d.infoHash, d.fileIndex) === id);
  if (!entry) return null;
  entry.paused = paused || undefined;
  saveDownloads(all);
  return entry;
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} timed out`)), ms)
    ),
  ]);
}

export type WorkerPrefetchResult = {
  prefetching: boolean;
  reason?: string;
  file?: string;
};

/**
 * Ask the worker to pull one file (pin = keep it alongside other downloads
 * instead of replacing the single auto pull-ahead). Never throws.
 */
export async function workerPrefetch(
  infoHash: string,
  fileIndex: number,
  pin: boolean
): Promise<WorkerPrefetchResult> {
  try {
    const base = await withTimeout(getTorrentEngine().getWorkerBaseUrl(), 4000, "Worker");
    const res = await fetch(
      `${base}/prefetch/${infoHash}?file=${fileIndex}${pin ? "&pin=1" : ""}`,
      { method: "POST", signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return { prefetching: false, reason: "worker-error" };
    return await res.json();
  } catch {
    return { prefetching: false, reason: "unreachable" };
  }
}

/** The worker took the file: queued now, or it's the one already playing. */
export function prefetchAccepted(r: WorkerPrefetchResult): boolean {
  return r.prefetching || r.reason === "current";
}

/** Ask the worker to stop fetching one file, keeping its bytes. Never throws. */
export async function workerUnpin(infoHash: string, fileIndex: number): Promise<boolean> {
  try {
    const base = await withTimeout(getTorrentEngine().getWorkerBaseUrl(), 4000, "Worker");
    const res = await fetch(`${base}/unpin/${infoHash}?file=${fileIndex}`, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
