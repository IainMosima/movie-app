import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { clearFileFromWorker } from "@/lib/torrent-cache-actions";
import {
  getCachePath,
  allocatedSize,
  deleteCacheFile,
  formatBytes,
} from "@/lib/storage-store";

// GET /api/torrent/[infoHash]/file/[index]/cache?path=<relative cache path>
// How much disk this one file is holding right now.
export async function GET(req: NextRequest) {
  const relPath = req.nextUrl.searchParams.get("path");
  const cachedBytes = relPath ? allocatedSize(join(getCachePath(), relPath)) : 0;
  return NextResponse.json({
    cachedBytes,
    cachedFormatted: formatBytes(cachedBytes),
  });
}

// DELETE /api/torrent/[infoHash]/file/[index]/cache?path=<relative cache path>
// Clears one episode's cached bytes. Prefers the worker (it also resets the
// piece bitfield so the file re-downloads cleanly), and falls back to deleting
// the file directly when the worker is down or the torrent isn't active.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ infoHash: string; index: string }> }
) {
  const { infoHash, index } = await params;
  const fileIndex = parseInt(index, 10);
  if (Number.isNaN(fileIndex)) {
    return NextResponse.json({ error: "Invalid index" }, { status: 400 });
  }

  const relPath = req.nextUrl.searchParams.get("path");
  const diskPath = relPath ? join(getCachePath(), relPath) : null;
  const before = diskPath ? allocatedSize(diskPath) : 0;

  const viaWorker = await clearFileFromWorker(infoHash, fileIndex);

  let reclaimedBytes = 0;
  if (diskPath && relPath) {
    const after = allocatedSize(diskPath);
    reclaimedBytes = Math.max(0, before - after);

    if (!viaWorker && after > 0) {
      try {
        reclaimedBytes = deleteCacheFile(relPath);
      } catch (e) {
        console.error("Episode cache fs-fallback failed:", e);
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Failed to clear episode cache" },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({
    success: true,
    viaWorker,
    reclaimedBytes,
    reclaimedFormatted: formatBytes(reclaimedBytes),
  });
}
