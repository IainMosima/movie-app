import "server-only";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/data-dir";
import { getAllItems } from "@/lib/library-store";
import { extractInfoHashFromMagnet } from "@/lib/torrent-cache-actions";
import type { WatchRecord, WatchProgressData } from "@/types";

// Below this we assume you were just peeking, not watching — keeps five-second
// glances out of Continue Watching.
const MIN_TRACKED_SECONDS = 30;

// Past this much of the runtime it counts as watched.
const FINISHED_RATIO = 0.92;
const FINISHED_TAIL_SECONDS = 90;

// Cap the file so it can't grow without bound.
const MAX_RECORDS = 50;

function getWatchProgressPath(): string {
  return join(getDataDir(), "watch-progress.json");
}

export function getWatchProgress(): WatchProgressData {
  const path = getWatchProgressPath();
  if (!existsSync(path)) return { records: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<WatchProgressData>;
    return { records: parsed.records ?? [] };
  } catch {
    // A corrupt or unreadable file must never break playback or the home page.
    return { records: [] };
  }
}

function saveWatchProgress(data: WatchProgressData): void {
  const records = data.records
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_RECORDS);
  writeFileSync(getWatchProgressPath(), JSON.stringify({ records }, null, 2));
}

function sameTitle(record: WatchRecord, infoHash: string, fileIndex: number): boolean {
  return (
    record.infoHash.toLowerCase() === infoHash.toLowerCase() &&
    record.fileIndex === fileIndex
  );
}

export function isFinished(positionSec: number, durationSec: number): boolean {
  if (!durationSec || durationSec <= 0) return false;
  if (positionSec / durationSec >= FINISHED_RATIO) return true;
  return durationSec - positionSec <= FINISHED_TAIL_SECONDS;
}

export function getRecord(infoHash: string, fileIndex: number): WatchRecord | null {
  return (
    getWatchProgress().records.find((r) => sameTitle(r, infoHash, fileIndex)) ?? null
  );
}

/** Unfinished titles, most recently watched first — this is Continue Watching. */
export function listUnfinished(limit = 12): WatchRecord[] {
  return getWatchProgress()
    .records.filter((r) => !r.finished && r.positionSec >= MIN_TRACKED_SECONDS)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/**
 * The watch page only knows an infoHash, but resuming days later needs a magnet
 * to re-add the torrent. Prefer the saved library item's magnet (items persist
 * their infoHash once a torrent resolves); otherwise synthesise a bare one —
 * the worker attaches its own public trackers to every add, so that is enough.
 */
function resolveSource(infoHash: string): { magnet: string; libraryItemId?: string } {
  try {
    const hash = infoHash.toLowerCase();
    const item = getAllItems().find(
      (i) =>
        i.infoHash?.toLowerCase() === hash ||
        extractInfoHashFromMagnet(i.magnet)?.toLowerCase() === hash
    );
    if (item) return { magnet: item.magnet, libraryItemId: item.id };
  } catch {
    // fall through to the synthesised magnet
  }
  return { magnet: `magnet:?xt=urn:btih:${infoHash}` };
}

export function upsertRecord(input: {
  infoHash: string;
  fileIndex: number;
  positionSec: number;
  durationSec: number;
  title?: string;
}): WatchRecord | null {
  const { infoHash, fileIndex, positionSec, durationSec } = input;
  if (!infoHash || positionSec < MIN_TRACKED_SECONDS) return null;

  const data = getWatchProgress();
  const existing = data.records.find((r) => sameTitle(r, infoHash, fileIndex));
  const source = existing
    ? { magnet: existing.magnet, libraryItemId: existing.libraryItemId }
    : resolveSource(infoHash);

  const record: WatchRecord = {
    infoHash: infoHash.toLowerCase(),
    fileIndex,
    title: input.title?.trim() || existing?.title || "Untitled",
    magnet: source.magnet,
    ...(source.libraryItemId ? { libraryItemId: source.libraryItemId } : {}),
    positionSec: Math.round(positionSec),
    // Duration arrives late for MKV streams; never let a 0 overwrite a real one.
    durationSec: Math.round(durationSec || existing?.durationSec || 0),
    finished: false,
    updatedAt: Date.now(),
  };
  record.finished = isFinished(record.positionSec, record.durationSec);

  data.records = [record, ...data.records.filter((r) => !sameTitle(r, infoHash, fileIndex))];
  saveWatchProgress(data);
  return record;
}

export function deleteRecord(infoHash: string, fileIndex?: number): boolean {
  const data = getWatchProgress();
  const before = data.records.length;
  data.records = data.records.filter((r) =>
    fileIndex === undefined
      ? r.infoHash.toLowerCase() !== infoHash.toLowerCase()
      : !sameTitle(r, infoHash, fileIndex)
  );
  if (data.records.length === before) return false;
  saveWatchProgress(data);
  return true;
}
