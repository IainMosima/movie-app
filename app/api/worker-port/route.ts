import { NextResponse } from "next/server";
import { getTorrentEngine } from "@/lib/torrent-engine";

// GET /api/worker-port - Returns the torrent worker's port for direct LAN streaming
export async function GET() {
  try {
    const engine = getTorrentEngine();
    const port = await engine.getWorkerPort();
    return NextResponse.json({ port });
  } catch {
    return NextResponse.json({ error: "Worker not ready" }, { status: 503 });
  }
}
