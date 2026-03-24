import { NextRequest, NextResponse } from "next/server";
import WebTorrent from "webtorrent";
import { join } from "path";
import {
  isFFmpegAvailable,
  probeEmbeddedSubtitles,
  extractSubtitleTrack,
} from "@/lib/subtitle-extractor";

declare global {
  var __webTorrentClient: WebTorrent.Instance | undefined;
}

const CACHE_PATH = join(process.cwd(), "data", "cache");

function srtToVtt(srt: string): string {
  return (
    "WEBVTT\n\n" +
    srt
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
  );
}

function findLargestMkv(torrent: WebTorrent.Torrent): WebTorrent.TorrentFile | null {
  const mkvFiles = torrent.files.filter((f) => /\.mkv$/i.test(f.name));
  if (mkvFiles.length === 0) return null;
  return mkvFiles.reduce((largest, file) =>
    file.length > largest.length ? file : largest
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ infoHash: string }> }
) {
  const { infoHash } = await params;
  const searchParams = request.nextUrl.searchParams;
  const fileIndexParam = searchParams.get("file");
  const embeddedParam = searchParams.get("embedded");

  try {
    const client = globalThis.__webTorrentClient;
    if (!client) {
      return NextResponse.json(
        { error: "WebTorrent client not initialized" },
        { status: 503 }
      );
    }

    const torrent = client.torrents.find(
      (t) => t.infoHash && t.infoHash.toLowerCase() === infoHash.toLowerCase()
    );

    if (!torrent) {
      return NextResponse.json(
        { error: "Torrent not found" },
        { status: 404 }
      );
    }

    const subtitleExts = /\.(srt|vtt)$/i;

    // Serve embedded subtitle track as VTT
    if (embeddedParam !== null) {
      const streamIndex = parseInt(embeddedParam, 10);
      if (isNaN(streamIndex)) {
        return NextResponse.json(
          { error: "Invalid stream index" },
          { status: 400 }
        );
      }

      const mkvFile = findLargestMkv(torrent);
      if (!mkvFile) {
        return NextResponse.json(
          { error: "No MKV file found" },
          { status: 404 }
        );
      }

      const filePath = join(CACHE_PATH, mkvFile.path);
      const vttPath = await extractSubtitleTrack(filePath, streamIndex, infoHash);

      if (!vttPath) {
        return NextResponse.json(
          { error: "Failed to extract subtitle" },
          { status: 500 }
        );
      }

      const { readFileSync } = await import("fs");
      const vtt = readFileSync(vttPath, "utf-8");

      return new NextResponse(vtt, {
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Serve file-based subtitle as VTT
    if (fileIndexParam !== null) {
      const idx = parseInt(fileIndexParam, 10);
      const file = torrent.files[idx];

      if (!file || !subtitleExts.test(file.name)) {
        return NextResponse.json(
          { error: "Subtitle file not found" },
          { status: 404 }
        );
      }

      // Read the file content
      const content = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const stream = file.createReadStream();
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        stream.on("error", reject);
      });

      const vtt = file.name.endsWith(".vtt") ? content : srtToVtt(content);

      return new NextResponse(vtt, {
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // List all subtitle files
    const subtitles: Array<
      | { name: string; index: number; type: "file" }
      | { name: string; streamIndex: number; type: "embedded" }
    > = torrent.files
      .map((f, i) => ({ name: f.name, index: i, type: "file" as const }))
      .filter((f) => subtitleExts.test(f.name));

    // Check for embedded subtitles in MKV files
    const hasFFmpeg = await isFFmpegAvailable();
    if (hasFFmpeg) {
      const mkvFile = findLargestMkv(torrent);
      if (mkvFile) {
        const filePath = join(CACHE_PATH, mkvFile.path);
        const embedded = await probeEmbeddedSubtitles(filePath);
        for (const track of embedded) {
          const name =
            track.title ||
            track.language ||
            `Track ${track.streamIndex}`;
          subtitles.push({
            name,
            streamIndex: track.streamIndex,
            type: "embedded",
          });
        }
      }
    }

    return NextResponse.json({ subtitles });
  } catch (error) {
    console.error("Subtitle error:", error);
    return NextResponse.json(
      { error: "Failed to get subtitles" },
      { status: 500 }
    );
  }
}
