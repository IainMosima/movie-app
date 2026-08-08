import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listUnfinished, upsertRecord } from "@/lib/watch-store";

const ProgressSchema = z.object({
  infoHash: z.string().min(1),
  fileIndex: z.number().int().nonnegative().default(0),
  positionSec: z.number().nonnegative(),
  durationSec: z.number().nonnegative().default(0),
  title: z.string().optional(),
});

// GET /api/progress - unfinished titles, most recent first (Continue Watching)
export async function GET() {
  try {
    return NextResponse.json({ records: listUnfinished() });
  } catch (error) {
    console.error("Failed to read watch progress:", error);
    // Never break the home page over progress tracking.
    return NextResponse.json({ records: [] });
  }
}

// POST /api/progress - record where you got to.
// Also reached via navigator.sendBeacon on exit, which sends text/plain rather
// than JSON, so the body is parsed from raw text instead of request.json().
export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (!raw) return NextResponse.json({ error: "Empty body" }, { status: 400 });

    const parsed = ProgressSchema.parse(JSON.parse(raw));
    const record = upsertRecord(parsed);

    // Below the tracking floor is a no-op, not an error.
    return NextResponse.json({ success: true, record });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to save watch progress:", error);
    return NextResponse.json(
      { error: "Failed to save watch progress" },
      { status: 500 }
    );
  }
}
