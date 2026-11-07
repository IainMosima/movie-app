import { NextRequest, NextResponse } from "next/server";
import {
  getStorageReport,
  reconcile,
  deleteCacheFolderFs,
  deleteCacheFile,
  formatBytes,
  getCachePath,
  allocatedSize,
} from "@/lib/storage-store";
import { loadMeta } from "@/lib/torrent-meta";
import { readdirSync, statSync } from "fs";
import { join, relative, basename } from "path";
import type { StorageFile } from "@/types";

const VIDEO = /\.(mkv|mp4|m4v|mov|webm|avi)$/i;

/** Video files under one cache entry that actually hold bytes. */
function videoFiles(entryName: string): { rel: string; name: string; size: number }[] {
  const root = getCachePath();
  const out: { rel: string; name: string; size: number }[] = [];
  const walk = (p: string) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const child of readdirSync(p)) walk(join(p, child));
    } else if (VIDEO.test(p)) {
      const size = allocatedSize(p);
      if (size > 0) out.push({ rel: relative(root, p), name: basename(p), size });
    }
  };
  walk(join(root, entryName));
  return out;
}
import { getWatchProgress } from "@/lib/watch-store";
import { getAllItems } from "@/lib/library-store";
import { extractInfoHashFromMagnet } from "@/lib/torrent-cache-actions";

// GET /api/storage - disk space + on-disk cache reconciliation report
export async function GET() {
  try {
    const report = getStorageReport();
    // Mark what's been watched, so the Downloads window can offer it for deletion first.
    const records = getWatchProgress().records;
    const items = getAllItems();
    for (const entry of report.entries) {
      const item = entry.libraryItemId ? items.find((i) => i.id === entry.libraryItemId) : undefined;
      const hash = (item?.infoHash ?? (item ? extractInfoHashFromMagnet(item.magnet) : null))?.toLowerCase();
      const mine = hash ? records.filter((r) => r.infoHash.toLowerCase() === hash) : [];
      if (mine.length > 0 && mine.every((r) => r.finished)) entry.watched = true;

      if (entry.kind !== "matched" && entry.kind !== "orphan") continue;
      // Per episode, so one can go without the rest. The index comes from the
      // pack's remembered file list (lib/torrent-meta), matched by file name.
      const meta = hash ? loadMeta(hash) : null;
      entry.files = videoFiles(entry.name).map((f): StorageFile => {
        const metaFile = meta?.files.find((m) => basename(m.name) === f.name);
        const idx = metaFile?.index;
        return {
          rel: f.rel,
          name: f.name,
          sizeBytes: f.size,
          sizeFormatted: formatBytes(f.size),
          ...(hash && idx !== undefined
            ? {
                infoHash: hash,
                fileIndex: idx,
                watched: mine.some((r) => r.fileIndex === idx && r.finished),
                length: metaFile?.length,
                ...(item ? { magnet: item.magnet } : {}),
              }
            : {}),
        };
      });
    }
    return NextResponse.json(report);
  } catch (error) {
    console.error("Failed to build storage report:", error);
    return NextResponse.json(
      { error: "Failed to build storage report" },
      { status: 500 }
    );
  }
}

// DELETE /api/storage - reclaim disk: { folder } for one, or { orphansOnly: true } for all orphans
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    let targets: string[];
    if (body?.orphansOnly) {
      targets = reconcile()
        .filter((e) => e.kind === "orphan")
        .map((e) => e.name);
    } else if (typeof body?.file === "string" && body.file.length > 0) {
      // One file (an episode the torrent engine doesn't have loaded).
      const reclaimedBytes = deleteCacheFile(body.file);
      return NextResponse.json({ deleted: [body.file], reclaimedBytes, reclaimedFormatted: formatBytes(reclaimedBytes) });
    } else if (typeof body?.folder === "string" && body.folder.length > 0) {
      targets = [body.folder];
    } else {
      return NextResponse.json(
        { error: "Provide { folder } or { orphansOnly: true }" },
        { status: 400 }
      );
    }

    let reclaimedBytes = 0;
    const deleted: string[] = [];
    for (const name of targets) {
      reclaimedBytes += deleteCacheFolderFs(name);
      deleted.push(name);
    }

    return NextResponse.json({
      success: true,
      deleted,
      reclaimedBytes,
      reclaimedFormatted: formatBytes(reclaimedBytes),
    });
  } catch (error) {
    console.error("Failed to reclaim storage:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reclaim storage" },
      { status: 500 }
    );
  }
}
