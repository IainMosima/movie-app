import { NextRequest, NextResponse } from "next/server";
import { extractInfoHash } from "@/lib/torrent-utils";
import { getTorrentEngine } from "@/lib/torrent-engine";

// GET /api/torrent/status?magnet=... - Check torrent connection status
export async function GET(request: NextRequest) {
  const magnet = request.nextUrl.searchParams.get("magnet");

  if (!magnet) {
    return NextResponse.json({ error: "Magnet required" }, { status: 400 });
  }

  try {
    const engine = getTorrentEngine();
    const infoHash = extractInfoHash(magnet);

    const torrent = infoHash
      ? engine.getTorrent(infoHash)
      : engine.findTorrentByMagnetURI(magnet);

    if (!torrent) {
      return NextResponse.json({
        status: "not_found",
        message: "Torrent not started yet",
      });
    }

    return NextResponse.json({
      status: torrent.ready ? "ready" : "connecting",
      name: torrent.name || "Loading...",
      infoHash: torrent.infoHash,
      peers: torrent.numPeers,
      progress: Math.round(torrent.progress * 100),
      ready: torrent.ready,
      files: torrent.ready ? torrent.files.length : 0,
    });
  } catch (error) {
    console.error("Status check failed:", error);
    return NextResponse.json(
      { error: "Failed to check status" },
      { status: 500 }
    );
  }
}
