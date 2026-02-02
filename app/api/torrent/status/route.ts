import { NextRequest, NextResponse } from "next/server";
import WebTorrent from "webtorrent";

// Shared client
declare global {
  var __webTorrentClient: WebTorrent.Instance | undefined;
}

function getClient(): WebTorrent.Instance | null {
  return globalThis.__webTorrentClient || null;
}

// GET /api/torrent/status?magnet=... - Check torrent connection status
export async function GET(request: NextRequest) {
  const magnet = request.nextUrl.searchParams.get("magnet");

  if (!magnet) {
    return NextResponse.json({ error: "Magnet required" }, { status: 400 });
  }

  try {
    const client = getClient();

    // Extract infoHash from magnet
    const match = magnet.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
    const infoHash = match ? match[1].toLowerCase() : null;

    if (!infoHash) {
      return NextResponse.json({ error: "Invalid magnet" }, { status: 400 });
    }

    if (!client) {
      return NextResponse.json({
        status: "not_found",
        message: "Torrent not started yet",
      });
    }

    const torrent = client.torrents.find(
      (t) => t.infoHash && t.infoHash.toLowerCase() === infoHash
    );

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
