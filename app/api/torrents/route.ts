import { NextResponse } from "next/server";
import { getTorrentEngine } from "@/lib/torrent-engine";

// GET /api/torrents - Get all active torrents (for debugging/monitoring)
export async function GET() {
  try {
    const engine = getTorrentEngine();
    const data = await engine.getActiveTorrents();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Failed to get torrents:", error);
    return NextResponse.json(
      { error: "Failed to get torrents" },
      { status: 500 }
    );
  }
}
