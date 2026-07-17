import { NextRequest, NextResponse } from "next/server";
import { getDataDir, getMediaRoot, setDataDir } from "@/lib/data-dir";
import { getDiskSpace } from "@/lib/storage-store";
import { getTorrentEngine } from "@/lib/torrent-engine";
import type { DataDirReport } from "@/types";

// GET /api/data-dir - current active data directory + free space there
export async function GET() {
  try {
    const disk = getDiskSpace();
    const report: DataDirReport = {
      activeDir: getDataDir(),
      mediaRoot: getMediaRoot(),
      freeBytes: disk.freeBytes,
      totalBytes: disk.totalBytes,
    };
    return NextResponse.json(report);
  } catch (error) {
    console.error("Failed to get data dir:", error);
    return NextResponse.json(
      { error: "Failed to get data dir" },
      { status: 500 }
    );
  }
}

// POST /api/data-dir - switch the active data directory and restart the torrent worker
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const path = body?.path;
    if (typeof path !== "string" || path.trim().length === 0) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    const activeDir = setDataDir(path);
    await getTorrentEngine().restartWorker();

    return NextResponse.json({ success: true, activeDir });
  } catch (error) {
    console.error("Failed to switch data dir:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to switch data dir" },
      { status: 500 }
    );
  }
}
