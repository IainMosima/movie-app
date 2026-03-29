import { NextRequest, NextResponse } from "next/server";
import { getTorrentEngine } from "@/lib/torrent-engine";

// GET /api/stream/[infoHash] - Proxy stream from torrent worker
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ infoHash: string }> }
) {
  const { infoHash } = await params;
  const searchParams = request.nextUrl.searchParams;
  const fileParam = searchParams.get("file");

  try {
    const engine = getTorrentEngine();
    const baseUrl = await engine.getWorkerBaseUrl();

    const workerUrl = fileParam
      ? `${baseUrl}/stream/${infoHash}?file=${fileParam}`
      : `${baseUrl}/stream/${infoHash}`;

    // Forward the range header from the browser
    const headers: Record<string, string> = {};
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      headers["Range"] = rangeHeader;
    }

    const workerRes = await fetch(workerUrl, { headers });

    // Pass through the worker's response
    const responseHeaders = new Headers();
    for (const [key, value] of workerRes.headers.entries()) {
      responseHeaders.set(key, value);
    }

    return new NextResponse(workerRes.body, {
      status: workerRes.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Stream proxy error:", error);
    return NextResponse.json(
      { error: "Failed to stream" },
      { status: 500 }
    );
  }
}

// OPTIONS preflight for TV browsers that send CORS preflight with Range header
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
    },
  });
}
