import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import WebTorrent from "webtorrent";

const GetFilesSchema = z.object({
  magnet: z.string().startsWith("magnet:", "Invalid magnet link"),
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

// Store client globally to reuse connections
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

// POST /api/torrent/files - Get file list from magnet (fast, like CLI)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { magnet } = GetFilesSchema.parse(body);

    const client = getClient();

    // Check if torrent already exists
    const infoHashMatch = magnet.match(
      /urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i
    );
    const infoHash = infoHashMatch ? infoHashMatch[1].toLowerCase() : null;

    let existingTorrent = infoHash
      ? client.torrents.find(
          (t) => t.infoHash && t.infoHash.toLowerCase() === infoHash.toLowerCase()
        )
      : null;

    if (existingTorrent && existingTorrent.ready) {
      // Already have it, return immediately
      return NextResponse.json(buildResponse(existingTorrent));
    }

    // Add torrent and wait for metadata
    const torrent = await new Promise<WebTorrent.Torrent>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout: Could not fetch metadata in 60 seconds"));
      }, 60000);

      // If already being added, wait for it
      if (existingTorrent) {
        existingTorrent.once("ready", () => {
          clearTimeout(timeout);
          resolve(existingTorrent!);
        });
        return;
      }

      const t = client.add(magnet, {
        path: "/tmp/streambox-cache",
      });

      t.once("ready", () => {
        clearTimeout(timeout);
        console.log(`Torrent ready: ${t.name} (${t.numPeers} peers)`);
        resolve(t);
      });

      t.once("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    return NextResponse.json(buildResponse(torrent));
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

function buildResponse(torrent: WebTorrent.Torrent): TorrentFilesResponse {
  const files: TorrentFile[] = torrent.files.map((file, index) => ({
    index,
    name: file.name,
    path: file.path,
    size: file.length,
    sizeFormatted: formatSize(file.length),
    isVideo: isVideoFile(file.name),
    extension: getExtension(file.name),
  }));

  // Find main video (largest video file)
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
