import { NextRequest, NextResponse } from "next/server";

/**
 * VLC only treats a URL as a subtitle when it ends in a subtitle extension, so
 * the player gets `sub-<file>.vtt` and is sent on
 * to the real subtitle endpoint.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ infoHash: string; sub: string }> }
) {
  const { infoHash, sub } = await params;
  const ext = sub.match(/^sub-(\d+)\.vtt$/);
  if (!ext) return NextResponse.json({ error: "Unknown subtitle" }, { status: 404 });

  const target = new URL(`/api/subtitle/${infoHash}?sub=${ext[1]}`, req.nextUrl);
  // Keep the host VLC used — behind 0.0.0.0 nextUrl may say localhost.
  const host = req.headers.get("host");
  if (host) target.host = host;
  return NextResponse.redirect(target, 302);
}
