import { NextRequest, NextResponse } from "next/server";
import { getRecord, deleteRecord } from "@/lib/watch-store";

function parseFileIndex(req: NextRequest): number {
  const raw = req.nextUrl.searchParams.get("file");
  const parsed = parseInt(raw ?? "0", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// GET /api/progress/[infoHash]?file=N - the saved position, for resume on load
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ infoHash: string }> }
) {
  const { infoHash } = await params;
  try {
    return NextResponse.json({ record: getRecord(infoHash, parseFileIndex(req)) });
  } catch (error) {
    console.error("Failed to read watch record:", error);
    // A missing position should start playback at 0, not fail it.
    return NextResponse.json({ record: null });
  }
}

// DELETE /api/progress/[infoHash]?file=N - forget this title.
// Omit ?file= to forget every episode of the torrent.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ infoHash: string }> }
) {
  const { infoHash } = await params;
  const hasFile = req.nextUrl.searchParams.has("file");

  try {
    const deleted = deleteRecord(infoHash, hasFile ? parseFileIndex(req) : undefined);
    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    console.error("Failed to delete watch record:", error);
    return NextResponse.json(
      { error: "Failed to delete watch record" },
      { status: 500 }
    );
  }
}
