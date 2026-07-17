import { NextRequest, NextResponse } from "next/server";
import { clearFileFromWorker } from "@/lib/torrent-cache-actions";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ infoHash: string; index: string }> }
) {
  const { infoHash, index } = await params;
  const fileIndex = parseInt(index, 10);
  if (Number.isNaN(fileIndex)) {
    return NextResponse.json({ error: "Invalid index" }, { status: 400 });
  }
  await clearFileFromWorker(infoHash, fileIndex);
  return NextResponse.json({ success: true });
}
