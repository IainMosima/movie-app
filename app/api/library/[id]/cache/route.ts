import { NextRequest, NextResponse } from "next/server";
import { getItemById } from "@/lib/library-store";
import { extractInfoHashFromMagnet, deleteFromWorker } from "@/lib/torrent-cache-actions";
import { deleteCacheForLibraryItem } from "@/lib/storage-store";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = getItemById(id);
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const infoHash = extractInfoHashFromMagnet(item.magnet);
  if (infoHash) await deleteFromWorker(infoHash, item.name);

  // Filesystem fallback: clear cached bytes even if the worker isn't running.
  try {
    deleteCacheForLibraryItem(id);
  } catch (e) {
    console.error("Cache fs-fallback failed:", e);
  }

  return NextResponse.json({ success: true });
}
