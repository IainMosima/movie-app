import { NextRequest, NextResponse } from "next/server";
import { appendFileSync } from "fs";
import { join } from "path";

// Temporary: collects what the TV browser supports. Delete with app/tv-check.
export async function POST(request: NextRequest) {
  const body = await request.text();
  appendFileSync(join(process.cwd(), "data", "tv-check.log"), body + "\n");
  return NextResponse.json({ ok: true });
}
