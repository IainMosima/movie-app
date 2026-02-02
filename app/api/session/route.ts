import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import WebTorrent from "webtorrent";

const StartSessionSchema = z.object({
  magnet: z.string().startsWith("magnet:", "Invalid magnet link"),
});

// Shared client
declare global {
  var __webTorrentClient: WebTorrent.Instance | undefined;
}

function getClient(): WebTorrent.Instance {
  if (!globalThis.__webTorrentClient) {
    globalThis.__webTorrentClient = new WebTorrent({
      maxConns: 100,
    });
  }
  return globalThis.__webTorrentClient;
}

// POST /api/session - Ensure torrent is loaded, return infoHash
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { magnet } = StartSessionSchema.parse(body);

    const client = getClient();

    // Extract infoHash
    const match = magnet.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
    const infoHash = match ? match[1].toLowerCase() : null;

    if (!infoHash) {
      return NextResponse.json({ error: "Invalid magnet" }, { status: 400 });
    }

    // Check if already loaded
    const existing = client.torrents.find(
      (t) => t.infoHash && t.infoHash.toLowerCase() === infoHash
    );

    if (existing && existing.ready) {
      return NextResponse.json({
        infoHash: existing.infoHash,
        name: existing.name,
        ready: true,
      });
    }

    // Not loaded yet - that's fine, stream will handle it
    return NextResponse.json({
      infoHash,
      ready: !!existing,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Session error:", error);
    return NextResponse.json(
      { error: "Failed to start session" },
      { status: 500 }
    );
  }
}

// DELETE /api/session - Optional cleanup (not strictly needed)
export async function DELETE() {
  return NextResponse.json({ success: true });
}
