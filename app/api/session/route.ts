import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidTorrentInput, extractInfoHash } from "@/lib/torrent-utils";
import { getTorrentEngine } from "@/lib/torrent-engine";

const StartSessionSchema = z.object({
  magnet: z.string().refine(isValidTorrentInput, "Invalid magnet link or .torrent URL"),
});

const EndSessionSchema = z.object({
  infoHash: z.string(),
  sessionId: z.string(),
});

// POST /api/session - Start or end session (sendBeacon from tab close sends POST)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const engine = getTorrentEngine();

    // Handle sendBeacon cleanup (tab close sends POST with method: "DELETE")
    if (body.method === "DELETE" && body.infoHash && body.sessionId) {
      engine.endSession(body.infoHash, body.sessionId);
      return NextResponse.json({ success: true });
    }

    const { magnet } = StartSessionSchema.parse(body);
    const infoHash = extractInfoHash(magnet);

    // Check if already loaded
    const existing = infoHash
      ? engine.getTorrent(infoHash)
      : engine.findTorrentByMagnetURI(magnet);

    if (existing) {
      const sessionId = engine.startSession(existing.infoHash);
      return NextResponse.json({
        infoHash: existing.infoHash,
        name: existing.name,
        sessionId,
        ready: existing.ready,
      });
    }

    // Not loaded yet
    return NextResponse.json({
      infoHash,
      ready: false,
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

// DELETE /api/session - End session, trigger cleanup timer
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { infoHash, sessionId } = EndSessionSchema.parse(body);

    const engine = getTorrentEngine();
    engine.endSession(infoHash, sessionId);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ success: true });
  }
}
