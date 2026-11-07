import "server-only";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/data-dir";
import { getAllItems, getFolderById, getItemsByFolder } from "@/lib/library-store";
import { getTorrentEngine } from "@/lib/torrent-engine";
import { episodeCode, showName, sortByEpisode } from "@/lib/episode-order";
import { VIDEO_EXT } from "@/lib/watch-url";
import { extractInfoHashFromMagnet } from "@/lib/torrent-cache-actions";
import type { WatchRecord, WatchProgressData } from "@/types";

// Below this we assume you were just peeking, not watching — keeps five-second
// glances out of Continue Watching.
const MIN_TRACKED_SECONDS = 30;

// Past this much of the runtime it counts as watched.
const FINISHED_RATIO = 0.92;
const FINISHED_TAIL_SECONDS = 90;

// Cap the file so it can't grow without bound. Finished records are the
// "Watched" tags in the library, so they're the last to go.
const MAX_RECORDS = 2000;

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
    .sort((a, b) => Number(b.finished) - Number(a.finished) || b.updatedAt - a.updatedAt)
    .slice(0, MAX_RECORDS)
    .sort((a, b) => b.updatedAt - a.updatedAt);
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

type UpNext = NonNullable<WatchRecord["upNext"]>;

/**
 * What follows a finished record: the next video in its pack if the torrent is
 * loaded, else the next item in its library folder, else (pack not loaded, not
 * in a folder) "open the pack's picker". Null when nothing comes next.
 */
async function findUpNext(record: WatchRecord): Promise<UpNext | null> {
  let torrentLoaded = false;
  try {
    const torrent = await getTorrentEngine().getTorrent(record.infoHash);
    if (torrent?.files.length) {
      torrentLoaded = true;
      const videos = sortByEpisode(
        torrent.files.filter((f) => VIDEO_EXT.test(f.name)),
        (f) => f.name
      );
      const at = videos.findIndex((f) => f.index === record.fileIndex);
      const next = at >= 0 ? videos[at + 1] : undefined;
      if (next) {
        const code = episodeCode(next.name);
        return {
          title: code ? `${showName(record.title)} · ${code}` : next.name,
          magnet: record.magnet,
          fileIndex: next.index,
        };
      }
    }
  } catch {
    // Worker unreachable: treat as not loaded.
  }

  if (!record.libraryItemId) return null;
  const item = getAllItems().find((i) => i.id === record.libraryItemId);
  if (item?.folderId) {
    const folder = getFolderById(item.folderId);
    const siblings = getItemsByFolder(item.folderId);
    const next = siblings[siblings.findIndex((i) => i.id === item.id) + 1];
    if (folder && next) {
      return {
        title: `${folder.name} · ${next.name}`,
        magnet: next.magnet,
        libraryItemId: next.id,
        ...(next.fileIndex !== undefined ? { fileIndex: next.fileIndex } : {}),
      };
    }
    return null;
  }
  if (item && !torrentLoaded) {
    return { title: showName(record.title), magnet: item.magnet, pickFrom: item.id };
  }
  return null;
}

/**
 * The home page's Continue list: unfinished titles, newest first. When the most
 * recent record overall is finished, its up next leads the list (carried on that
 * finished record, so forgetting the tile forgets it) — unless that episode is
 * already in the list as half-watched.
 */
export async function listContinue(limit = 8): Promise<WatchRecord[]> {
  const unfinished = listUnfinished(limit);
  const latest = getWatchProgress().records.reduce<WatchRecord | null>(
    (a, b) => (!a || b.updatedAt > a.updatedAt ? b : a),
    null
  );
  if (!latest?.finished) return unfinished;

  const upNext = await findUpNext(latest);
  if (!upNext) return unfinished;
  const hash = extractInfoHashFromMagnet(upNext.magnet)?.toLowerCase();
  const alreadyThere = unfinished.some(
    (r) =>
      (upNext.libraryItemId && r.libraryItemId === upNext.libraryItemId) ||
      (r.infoHash === hash && (upNext.fileIndex === undefined || r.fileIndex === upNext.fileIndex))
  );
  if (alreadyThere) return unfinished;
  return [{ ...latest, upNext }, ...unfinished].slice(0, limit);
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
  // Set by "Mark as watched": no playback position needed.
  finished?: boolean;
}): WatchRecord | null {
  const { infoHash, fileIndex, positionSec, durationSec } = input;
  if (!infoHash || (!input.finished && positionSec < MIN_TRACKED_SECONDS)) return null;

  const data = getWatchProgress();
  const existing = data.records.find((r) => sameTitle(r, infoHash, fileIndex));
  // Next marks the episode watched while the old player may still have a
  // position report in flight; don't let that straggler un-mark it. A real
  // rewatch starts well after this window.
  if (!input.finished && existing?.finished && Date.now() - existing.updatedAt < 60_000) {
    return existing;
  }
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
  if (input.finished) {
    record.finished = true;
    record.positionSec = record.durationSec || record.positionSec;
  }

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
