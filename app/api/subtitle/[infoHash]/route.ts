import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import {
  isFFmpegAvailable,
  probeEmbeddedSubtitles,
  extractSubtitleTrack,
} from "@/lib/subtitle-extractor";
import { getTorrentEngine } from "@/lib/torrent-engine";

const CACHE_PATH = join(process.cwd(), "data", "cache");

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ infoHash: string }> }
) {
  const { infoHash } = await params;
  const searchParams = request.nextUrl.searchParams;
  const fileIndexParam = searchParams.get("file");
  const embeddedParam = searchParams.get("embedded");

  try {
    const engine = getTorrentEngine();
    const baseUrl = await engine.getWorkerBaseUrl();

    // Check torrent exists
    const torrent = await engine.getTorrent(infoHash);
    if (!torrent) {
      return NextResponse.json(
        { error: "Torrent not found" },
        { status: 404 }
      );
    }

    // Serve embedded subtitle track as VTT (needs ffmpeg, stays in Next.js)
    if (embeddedParam !== null) {
      const streamIndex = parseInt(embeddedParam, 10);
      if (isNaN(streamIndex)) {
        return NextResponse.json(
          { error: "Invalid stream index" },
          { status: 400 }
        );
      }

      const mkvFile = torrent.files.find((f) => /\.mkv$/i.test(f.name));
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

    // Serve file-based subtitle — proxy to worker
    if (fileIndexParam !== null) {
      const workerUrl = `${baseUrl}/subtitle/${infoHash}?file=${fileIndexParam}`;
      const workerRes = await fetch(workerUrl);

      return new NextResponse(workerRes.body, {
        status: workerRes.status,
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // List all subtitle files — get from worker + check embedded
    const workerRes = await fetch(`${baseUrl}/subtitle/${infoHash}`);
    const workerData = await workerRes.json();
    const subtitles: Array<
      | { name: string; index: number; type: "file" }
      | { name: string; streamIndex: number; type: "embedded" }
    > = workerData.subtitles || [];

    // Check for embedded subtitles in MKV files
    const hasFFmpeg = await isFFmpegAvailable();
    if (hasFFmpeg) {
      const mkvFile = torrent.files
        .filter((f) => /\.mkv$/i.test(f.name))
        .reduce(
          (largest, file) =>
            !largest || file.length > largest.length ? file : largest,
          null as (typeof torrent.files)[number] | null
        );

      if (mkvFile) {
        const filePath = join(CACHE_PATH, mkvFile.path);
        const embedded = await probeEmbeddedSubtitles(filePath);
        for (const track of embedded) {
          const name =
            track.title || track.language || `Track ${track.streamIndex}`;
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
