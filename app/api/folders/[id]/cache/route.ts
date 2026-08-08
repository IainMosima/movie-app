import { NextRequest, NextResponse } from "next/server";
import { getFolderById, getItemsByFolder } from "@/lib/library-store";
import { deleteCacheForLibraryItem, formatBytes } from "@/lib/storage-store";
import { extractInfoHashFromMagnet, deleteFromWorker } from "@/lib/torrent-cache-actions";

// DELETE /api/folders/[id]/cache - reclaim cached bytes for every item in the
// folder, keeping the items (and the folder) in the library.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const folder = getFolderById(id);
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  let reclaimedBytes = 0;
  for (const item of getItemsByFolder(id)) {
    const infoHash = extractInfoHashFromMagnet(item.magnet);
    if (infoHash) await deleteFromWorker(infoHash, item.name);

    // Filesystem fallback: clear bytes even if the worker isn't running.
    try {
      reclaimedBytes += deleteCacheForLibraryItem(item.id);
    } catch (e) {
      console.error("Cache fs-fallback failed:", e);
    }
  }

  return NextResponse.json({
    success: true,
    reclaimedBytes,
    reclaimedFormatted: formatBytes(reclaimedBytes),
  });
}
