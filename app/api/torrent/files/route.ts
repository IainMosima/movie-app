import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isValidTorrentInput } from "@/lib/torrent-utils";
import { getTorrentEngine } from "@/lib/torrent-engine";
import type { TorrentInfo } from "@/types";

const GetFilesSchema = z.object({
  magnet: z.string().refine(isValidTorrentInput, "Invalid magnet link or .torrent URL"),
});

export interface TorrentFile {
  index: number;
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  isVideo: boolean;
  extension: string;
}

export interface TorrentFilesResponse {
  infoHash: string;
  name: string;
  files: TorrentFile[];
  mainVideoIndex: number | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function isVideoFile(name: string): boolean {
  return /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv)$/i.test(name);
}

function getExtension(name: string): string {
  const match = name.match(/\.([^.]+)$/);
  return match ? match[1].toLowerCase() : "";
}

// POST /api/torrent/files - Get file list from magnet or .torrent URL
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { magnet } = GetFilesSchema.parse(body);

    const engine = getTorrentEngine();
    const torrentInfo = await engine.addTorrent(magnet);

    return NextResponse.json(buildResponse(torrentInfo));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to get torrent files:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to get torrent files",
      },
      { status: 500 }
    );
  }
}

function buildResponse(torrent: TorrentInfo): TorrentFilesResponse {
  const files: TorrentFile[] = torrent.files.map((file) => ({
    index: file.index,
    name: file.name,
    path: file.path,
    size: file.length,
    sizeFormatted: formatSize(file.length),
    isVideo: isVideoFile(file.name),
    extension: getExtension(file.name),
  }));

  let mainVideoIndex: number | null = null;
  let maxSize = 0;

  files.forEach((file) => {
    if (file.isVideo && file.size > maxSize) {
      maxSize = file.size;
      mainVideoIndex = file.index;
    }
  });

  return {
    infoHash: torrent.infoHash,
    name: torrent.name,
    files,
    mainVideoIndex,
  };
}
