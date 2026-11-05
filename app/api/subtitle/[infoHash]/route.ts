import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { readFileSync } from "fs";
import {
  isFFmpegAvailable,
  probeEmbeddedSubtitles,
  extractSubtitleTrack,
} from "@/lib/subtitle-extractor";
import { getTorrentEngine } from "@/lib/torrent-engine";
import { getDataDir } from "@/lib/data-dir";
import type { TorrentFileInfo } from "@/types";

const VIDEO = /\.(mkv|mp4|m4v|mov|webm|avi)$/i;
// Containers ffmpeg can pull text subtitle tracks out of.
const HAS_EMBEDDED = /\.(mkv|mp4|m4v|mov|webm)$/i;
const EPISODE = /s(\d{1,2})[ ._-]?e(\d{1,3})/i;

/** The video being watched: the requested file, or the biggest video (a movie). */
function pickVideo(files: TorrentFileInfo[], fileParam: string | null) {
  const asked = fileParam !== null ? files[parseInt(fileParam, 10)] : undefined;
  if (asked && VIDEO.test(asked.name)) return asked;
  return files
    .filter((f) => VIDEO.test(f.name))
    .reduce<TorrentFileInfo | undefined>((a, b) => (!a || b.length > a.length ? b : a), undefined);
}

function episodeKey(path: string): string | null {
  const m = path.match(EPISODE);
  return m ? `${parseInt(m[1], 10)}x${parseInt(m[2], 10)}` : null;
}

/**
 * Subtitle files belonging to this video. A season pack ships every episode's
 * subs; keep the ones naming the same SxxEyy (in the file or folder name) or
 * sharing the video's name. Nothing matches → it's a movie, offer them all.
 */
function subsFor(video: TorrentFileInfo | undefined, subs: TorrentFileInfo[]) {
  if (!video) return subs;
  const ep = episodeKey(video.path);
  const stem = video.name.replace(/\.[^.]+$/, "").toLowerCase();
  const mine = subs.filter(
    (s) => (ep && episodeKey(s.path) === ep) || s.name.toLowerCase().startsWith(stem)
  );
  if (mine.length > 0) return mine;
  // Other episodes' subs exist but none for this one — don't show the wrong ones.
  return ep && subs.some((s) => episodeKey(s.path)) ? [] : subs;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ infoHash: string }> }
) {
  const { infoHash } = await params;
  const searchParams = request.nextUrl.searchParams;
  const fileParam = searchParams.get("file");
  const subFileParam = searchParams.get("sub");
  const embeddedParam = searchParams.get("embedded");

  try {
    const engine = getTorrentEngine();
    const baseUrl = await engine.getWorkerBaseUrl();

    const torrent = await engine.getTorrent(infoHash);
    if (!torrent) {
      return NextResponse.json({ error: "Torrent not found" }, { status: 404 });
    }

    const video = pickVideo(torrent.files, fileParam);

    // Embedded track of the video being watched, as VTT (needs ffmpeg).
    if (embeddedParam !== null) {
      const streamIndex = parseInt(embeddedParam, 10);
      if (isNaN(streamIndex) || !video || !HAS_EMBEDDED.test(video.name)) {
        return NextResponse.json({ error: "No embedded subtitles" }, { status: 404 });
      }
      const vttPath = await extractSubtitleTrack(
        join(getDataDir(), "cache", video.path),
        streamIndex,
        infoHash,
        video.index,
        (video.progress ?? 0) >= 1
      );
      if (!vttPath) {
        return NextResponse.json({ error: "Failed to extract subtitle" }, { status: 500 });
      }
      return new NextResponse(readFileSync(vttPath, "utf-8"), {
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    // A subtitle file from the torrent — proxy to the worker.
    if (subFileParam !== null) {
      const workerRes = await fetch(`${baseUrl}/subtitle/${infoHash}?file=${subFileParam}`);
      return new NextResponse(workerRes.body, {
        status: workerRes.status,
        headers: { "Content-Type": "text/vtt; charset=utf-8" },
      });
    }

    // List the subtitles for this video.
    const subExts = /\.(srt|vtt)$/i;
    const subtitles: Array<
      | { name: string; index: number; type: "file" }
      | { name: string; streamIndex: number; type: "embedded" }
    > = subsFor(video, torrent.files.filter((f) => subExts.test(f.name))).map((f) => ({
      name: f.name,
      index: f.index,
      type: "file",
    }));

    if (video && HAS_EMBEDDED.test(video.name) && (await isFFmpegAvailable())) {
      const embedded = await probeEmbeddedSubtitles(join(getDataDir(), "cache", video.path));
      for (const track of embedded) {
        subtitles.push({
          name: track.title || track.language || `Track ${track.streamIndex}`,
          streamIndex: track.streamIndex,
          type: "embedded",
        });
      }
    }

    return NextResponse.json({
      subtitles,
      complete: (video?.progress ?? 0) >= 1,
    });
  } catch (error) {
    console.error("Subtitle error:", error);
    return NextResponse.json({ error: "Failed to get subtitles" }, { status: 500 });
  }
}
