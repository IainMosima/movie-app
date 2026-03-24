import "server-only";
import { execFile } from "child_process";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync } from "fs";

const SUBTITLE_CACHE_PATH = join(process.cwd(), "data", "cache", "subtitles");

// Text-based subtitle codecs that ffmpeg can convert to WebVTT
const TEXT_CODECS = new Set([
  "subrip",
  "srt",
  "ass",
  "ssa",
  "mov_text",
  "webvtt",
  "text",
  "ttml",
  "stl",
  "microdvd",
  "mpl2",
  "realtext",
  "subviewer",
  "subviewer1",
  "jacosub",
  "sami",
]);

interface EmbeddedSubtitle {
  streamIndex: number;
  codec: string;
  language: string;
  title: string;
}

// Cache ffmpeg availability check
let ffmpegAvailable: boolean | null = null;

export function isFFmpegAvailable(): Promise<boolean> {
  if (ffmpegAvailable !== null) return Promise.resolve(ffmpegAvailable);

  return new Promise((resolve) => {
    execFile("ffprobe", ["-version"], (error) => {
      ffmpegAvailable = !error;
      resolve(ffmpegAvailable);
    });
  });
}

export function probeEmbeddedSubtitles(
  filePath: string
): Promise<EmbeddedSubtitle[]> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        "-select_streams",
        "s",
        filePath,
      ],
      { timeout: 15000 },
      (error, stdout) => {
        if (error || !stdout) {
          resolve([]);
          return;
        }

        try {
          const data = JSON.parse(stdout);
          const streams: EmbeddedSubtitle[] = (data.streams || [])
            .filter((s: { codec_name?: string }) =>
              TEXT_CODECS.has(s.codec_name?.toLowerCase() || "")
            )
            .map(
              (s: {
                index: number;
                codec_name: string;
                tags?: { language?: string; title?: string };
              }) => ({
                streamIndex: s.index,
                codec: s.codec_name,
                language: s.tags?.language || "",
                title: s.tags?.title || "",
              })
            );
          resolve(streams);
        } catch {
          resolve([]);
        }
      }
    );
  });
}

// Deduplicate concurrent extraction requests
const extractionPromises = new Map<string, Promise<string | null>>();

export function extractSubtitleTrack(
  filePath: string,
  streamIndex: number,
  infoHash: string
): Promise<string | null> {
  const cacheDir = join(SUBTITLE_CACHE_PATH, infoHash);
  const outPath = join(cacheDir, `stream_${streamIndex}.vtt`);

  // Already cached
  if (existsSync(outPath)) return Promise.resolve(outPath);

  // Deduplicate concurrent requests
  const key = `${infoHash}:${streamIndex}`;
  if (extractionPromises.has(key)) {
    return extractionPromises.get(key)!;
  }

  const promise = new Promise<string | null>((resolve) => {
    mkdirSync(cacheDir, { recursive: true });

    execFile(
      "ffmpeg",
      ["-y", "-i", filePath, "-map", `0:${streamIndex}`, "-c:s", "webvtt", outPath],
      { timeout: 60000 },
      (error) => {
        if (error) {
          console.error(
            `Failed to extract subtitle stream ${streamIndex}:`,
            error.message
          );
          resolve(null);
        } else {
          resolve(outPath);
        }
      }
    );
  }).finally(() => {
    extractionPromises.delete(key);
  });

  extractionPromises.set(key, promise);
  return promise;
}

export function readCachedSubtitle(
  infoHash: string,
  streamIndex: number
): string | null {
  const outPath = join(
    SUBTITLE_CACHE_PATH,
    infoHash,
    `stream_${streamIndex}.vtt`
  );
  if (!existsSync(outPath)) return null;
  return readFileSync(outPath, "utf-8");
}
