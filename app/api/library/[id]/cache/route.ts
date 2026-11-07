import { NextRequest, NextResponse } from "next/server";
import { getItemById } from "@/lib/library-store";
import { extractInfoHashFromMagnet, deleteFromWorker } from "@/lib/torrent-cache-actions";
import { deleteCacheForLibraryItem } from "@/lib/storage-store";
import { removeDownload } from "@/lib/downloads-store";

// DELETE /api/library/[id]/cache[?after=<seconds>]
// `after` defers the delete (Next uses it) so wiping the episode you just
// finished never competes with loading the one you're moving on to.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = getItemById(id);
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const after = Math.min(120, Math.max(0, Number(req.nextUrl.searchParams.get("after")) || 0));
  if (after > 0) {
    setTimeout(() => clearItem(id).catch((e) => console.error("Deferred clear failed:", e)), after * 1000);
    return NextResponse.json({ scheduled: true, after }, { status: 202 });
  }
  await clearItem(id);
  return NextResponse.json({ success: true });
}

async function clearItem(id: string): Promise<void> {
  const item = getItemById(id);
  if (!item) return;
  const infoHash = extractInfoHashFromMagnet(item.magnet);
  if (infoHash) await deleteFromWorker(infoHash, item.name);

  // Filesystem fallback: clear cached bytes even if the worker isn't running.
  try {
    deleteCacheForLibraryItem(id);
  } catch (e) {
    console.error("Cache fs-fallback failed:", e);
  }

  const hash = item.infoHash ?? infoHash;
  if (hash) removeDownload(hash);
}
