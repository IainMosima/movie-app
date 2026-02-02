import { NextRequest, NextResponse } from "next/server";
import WebTorrent from "webtorrent";

// Shared client with files route
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

function parseRange(
  rangeHeader: string,
  fileSize: number
): [number, number] {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return [0, fileSize - 1];
  }

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  return [start, Math.min(end, fileSize - 1)];
}

// GET /api/stream/[infoHash] - Stream video with Range support
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ infoHash: string }> }
) {
  const { infoHash } = await params;
  const searchParams = request.nextUrl.searchParams;
  const fileIndexParam = searchParams.get("file");

  try {
    const client = getClient();
    const torrent = client.torrents.find(
      (t) => t.infoHash && t.infoHash.toLowerCase() === infoHash.toLowerCase()
    );

    if (!torrent) {
      return NextResponse.json(
        { error: "Torrent not found. Load it first via /api/torrent/files" },
        { status: 404 }
      );
    }

    // Get the file to stream
    let file: WebTorrent.TorrentFile | undefined;

    if (fileIndexParam !== null) {
      const idx = parseInt(fileIndexParam, 10);
      file = torrent.files[idx];
    } else {
      // Find largest video file
      const videoExts = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv)$/i;
      let maxSize = 0;
      for (const f of torrent.files) {
        if (videoExts.test(f.name) && f.length > maxSize) {
          maxSize = f.length;
          file = f;
        }
      }
    }

    if (!file) {
      return NextResponse.json(
        { error: "No video file found" },
        { status: 404 }
      );
    }

    const fileSize = file.length;
    const rangeHeader = request.headers.get("range");

    // Determine content type
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
    const contentTypes: Record<string, string> = {
      mp4: "video/mp4",
      mkv: "video/x-matroska",
      webm: "video/webm",
      avi: "video/x-msvideo",
      mov: "video/quicktime",
      m4v: "video/mp4",
      wmv: "video/x-ms-wmv",
      flv: "video/x-flv",
    };
    const contentType = contentTypes[ext] || "video/mp4";

    if (!rangeHeader) {
      // Full file (rare for video)
      const stream = file.createReadStream();
      return new NextResponse(stream as unknown as ReadableStream, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": fileSize.toString(),
          "Accept-Ranges": "bytes",
        },
      });
    }

    // Range request
    const [start, end] = parseRange(rangeHeader, fileSize);
    const chunkSize = end - start + 1;

    console.log(
      `Stream ${file.name}: ${start}-${end}/${fileSize} (${(chunkSize / 1024 / 1024).toFixed(1)}MB)`
    );

    const stream = file.createReadStream({ start, end });

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": chunkSize.toString(),
        "Accept-Ranges": "bytes",
      },
    });
  } catch (error) {
    console.error("Stream error:", error);
    return NextResponse.json(
      { error: "Failed to stream" },
      { status: 500 }
    );
  }
}
