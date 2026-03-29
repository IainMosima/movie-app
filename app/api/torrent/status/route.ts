import { NextRequest, NextResponse } from "next/server";
import { getTorrentEngine } from "@/lib/torrent-engine";

// GET /api/torrent/status?magnet=... - Check torrent connection status
export async function GET(request: NextRequest) {
  const magnet = request.nextUrl.searchParams.get("magnet");

  if (!magnet) {
    return NextResponse.json({ error: "Magnet required" }, { status: 400 });
  }

  try {
    const engine = getTorrentEngine();
    const data = await engine.getTorrentStatus(magnet);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Status check failed:", error);
    return NextResponse.json(
      { error: "Failed to check status" },
      { status: 500 }
    );
  }
}
