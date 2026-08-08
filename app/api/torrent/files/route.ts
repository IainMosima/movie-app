import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { z } from "zod";
import { isValidTorrentInput } from "@/lib/torrent-utils";
import { getTorrentEngine } from "@/lib/torrent-engine";
import { getAllItems, updateItem } from "@/lib/library-store";
import { getCachePath, allocatedSize, formatBytes } from "@/lib/storage-store";
import { extractInfoHashFromMagnet } from "@/lib/torrent-cache-actions";
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
  // Bytes this file actually occupies on disk right now (0 = nothing cached).
  cachedBytes: number;
  cachedFormatted: string;
}

export interface TorrentFilesResponse {
  infoHash: string;
  name: string;
  files: TorrentFile[];
  mainVideoIndex: number | null;
  cachedTotalBytes: number;
  cachedTotalFormatted: string;
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
    rememberCacheFolder(magnet, torrentInfo);

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

/**
 * Record the torrent's real on-disk folder name and infoHash on the matching
 * library item the first time we learn them. Torrent names often differ from
 * the magnet's `dn=` (release-group and tracker prefixes), and without this the
 * storage reconciler has to guess — which is how a library item's cache ends up
 * labelled an orphan and its "Clear cache" silently reclaims nothing.
 */
function rememberCacheFolder(magnet: string, torrent: TorrentInfo): void {
  try {
    const hash = torrent.infoHash?.toLowerCase();
    const item = getAllItems().find(
      (i) =>
        i.magnet === magnet ||
        (hash != null && extractInfoHashFromMagnet(i.magnet)?.toLowerCase() === hash)
    );
    if (!item) return;
    if (item.cacheFolder === torrent.name && item.infoHash === hash) return;

    updateItem(item.id, { cacheFolder: torrent.name, infoHash: hash });
  } catch (e) {
    console.error("Failed to record cache folder:", e);
  }
}

function buildResponse(torrent: TorrentInfo): TorrentFilesResponse {
  const cachePath = getCachePath();

  const files: TorrentFile[] = torrent.files.map((file) => {
    const cachedBytes = allocatedSize(join(cachePath, file.path));
    return {
      index: file.index,
      name: file.name,
      path: file.path,
      size: file.length,
      sizeFormatted: formatSize(file.length),
      isVideo: isVideoFile(file.name),
      extension: getExtension(file.name),
      cachedBytes,
      cachedFormatted: formatBytes(cachedBytes),
    };
  });

  let mainVideoIndex: number | null = null;
  let maxSize = 0;

  files.forEach((file) => {
    if (file.isVideo && file.size > maxSize) {
      maxSize = file.size;
      mainVideoIndex = file.index;
    }
  });

  const cachedTotalBytes = files.reduce((sum, f) => sum + f.cachedBytes, 0);

  return {
    infoHash: torrent.infoHash,
    name: torrent.name,
    files,
    mainVideoIndex,
    cachedTotalBytes,
    cachedTotalFormatted: formatBytes(cachedTotalBytes),
  };
}
