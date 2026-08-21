import { NextRequest, NextResponse } from "next/server";
import { getAllItems } from "@/lib/library-store";
import { getSettings } from "@/lib/settings-store";
import {
  extractInfoHashFromMagnet,
  deleteFromWorker,
} from "@/lib/torrent-cache-actions";
import {
  deleteCacheForLibraryItem,
  getUsageByItem,
  formatBytes,
} from "@/lib/storage-store";
import type { LibraryItem } from "@/types";

interface Candidate {
  id: string;
  name: string;
  bytes: number;
  formatted: string;
}

function toCandidate(item: LibraryItem, bytes: number): Candidate {
  return { id: item.id, name: item.name, bytes, formatted: formatBytes(bytes) };
}

async function purge(items: Candidate[]): Promise<number> {
  let reclaimed = 0;
  for (const candidate of items) {
    const item = getAllItems().find((i) => i.id === candidate.id);
    if (!item) continue;
    const infoHash = extractInfoHashFromMagnet(item.magnet);
    if (infoHash) await deleteFromWorker(infoHash, item.name);
    try {
      deleteCacheForLibraryItem(candidate.id);
      reclaimed += candidate.bytes;
    } catch (e) {
      console.error(`Auto-purge failed for ${item.name}:`, e);
    }
  }
  return reclaimed;
}

/**
 * Called when playback of `infoHash` starts. Everything else still holding
 * bytes is a purge candidate.
 *
 * Episodes sitting in the same folder as what you just started are purged
 * without asking — moving to the next episode is the whole point of a series
 * folder, and the previous one has served its purpose. Anything else (a movie,
 * or an item in a different folder) is only reported back, so the player can
 * ask first — unless `autoPurgePrevious` is on, or the caller confirms.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const infoHash: string | undefined = body?.infoHash?.toLowerCase();
  if (!infoHash) {
    return NextResponse.json({ error: "Missing infoHash" }, { status: 400 });
  }

  const items = getAllItems();
  const current = items.find(
    (i) => extractInfoHashFromMagnet(i.magnet)?.toLowerCase() === infoHash
  );

  const usage = getUsageByItem();
  const cachedOthers = items
    .filter((i) => i.id !== current?.id && (usage.get(i.id) ?? 0) > 0)
    .map((i) => toCandidate(i, usage.get(i.id) ?? 0));

  // Same-folder siblings go without asking; a loose item has no siblings.
  const siblings = current?.folderId
    ? cachedOthers.filter(
        (c) => items.find((i) => i.id === c.id)?.folderId === current.folderId
      )
    : [];
  const siblingIds = new Set(siblings.map((s) => s.id));
  const rest = cachedOthers.filter((c) => !siblingIds.has(c.id));

  const auto = getSettings().autoPurgePrevious === true;
  const confirmed = body?.confirm === true;

  const purgedNow = [...siblings, ...(auto || confirmed ? rest : [])];
  const reclaimed = await purge(purgedNow);

  return NextResponse.json({
    purged: purgedNow,
    reclaimedBytes: reclaimed,
    reclaimedFormatted: formatBytes(reclaimed),
    // Left alone — the player asks about these.
    pending: auto || confirmed ? [] : rest,
  });
}
