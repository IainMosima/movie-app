import "server-only";
import WebTorrent from "webtorrent";
import { join } from "path";
import { rmSync, existsSync, mkdirSync } from "fs";
import { getSettings } from "./settings-store";
import type { TorrentInfo, TorrentFileInfo } from "@/types";

declare global {
  // eslint-disable-next-line no-var
  var __torrentEngine: TorrentEngine | undefined;
}

const CACHE_PATH = join(process.cwd(), "data", "cache");

// Ensure cache directory exists
if (!existsSync(CACHE_PATH)) {
  mkdirSync(CACHE_PATH, { recursive: true });
}

class TorrentEngine {
  private client: WebTorrent.Instance;
  private sessions: Map<string, Set<string>>; // infoHash -> sessionIds
  private cleanupTimers: Map<string, NodeJS.Timeout>;
  private torrentPromises: Map<string, Promise<WebTorrent.Torrent>>;

  constructor() {
    const settings = getSettings();
    this.client = new WebTorrent({
      maxConns: settings.maxConnections,
      downloadLimit: settings.downloadLimit === -1 ? 0 : settings.downloadLimit,
      uploadLimit: settings.uploadLimit === -1 ? 0 : settings.uploadLimit,
    });
    this.sessions = new Map();
    this.cleanupTimers = new Map();
    this.torrentPromises = new Map();

    this.client.on("error", (err) => {
      console.error("WebTorrent error:", err);
    });
  }

  // Extract infoHash from magnet URI
  private extractInfoHash(magnet: string): string | null {
    const match = magnet.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
    return match ? match[1].toLowerCase() : null;
  }

  // Add torrent from magnet, returns when metadata is ready
  async addTorrent(magnet: string): Promise<WebTorrent.Torrent> {
    const infoHash = this.extractInfoHash(magnet);

    // Check if torrent already exists
    const existing = this.client.torrents.find(
      (t) => t.infoHash === infoHash || t.magnetURI === magnet
    );
    if (existing) {
      // Wait for it to be ready if not already
      if (existing.ready) return existing;
      return new Promise((resolve) => {
        existing.once("ready", () => resolve(existing));
      });
    }

    // Check if we're already adding this torrent
    if (infoHash && this.torrentPromises.has(infoHash)) {
      return this.torrentPromises.get(infoHash)!;
    }

    const promise = new Promise<WebTorrent.Torrent>((resolve, reject) => {
      const torrent = this.client.add(magnet, {
        path: CACHE_PATH,
      });

      torrent.on("ready", () => {
        console.log(`Torrent ready: ${torrent.name} (${torrent.infoHash})`);
        resolve(torrent);
      });

      torrent.on("error", (err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Torrent error: ${message}`);
        reject(err);
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        if (!torrent.ready) {
          reject(new Error("Torrent metadata timeout"));
        }
      }, 60000);
    });

    if (infoHash) {
      this.torrentPromises.set(infoHash, promise);
      promise.finally(() => {
        this.torrentPromises.delete(infoHash);
      });
    }

    return promise;
  }

  // Get an existing torrent by infoHash
  getTorrent(infoHash: string): WebTorrent.Torrent | null {
    return (
      this.client.torrents.find(
        (t) => t.infoHash.toLowerCase() === infoHash.toLowerCase()
      ) || null
    );
  }

  // Get torrent info for API response
  getTorrentInfo(torrent: WebTorrent.Torrent): TorrentInfo {
    const files: TorrentFileInfo[] = torrent.files.map((f, index) => ({
      name: f.name,
      path: f.path,
      length: f.length,
      index,
    }));

    return {
      infoHash: torrent.infoHash,
      name: torrent.name,
      files,
      progress: torrent.progress,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      numPeers: torrent.numPeers,
      ready: torrent.ready,
    };
  }

  // Find the main video file in a torrent
  findVideoFile(torrent: WebTorrent.Torrent): WebTorrent.TorrentFile | null {
    const videoExtensions = /\.(mp4|mkv|webm|avi|mov|m4v)$/i;
    const videoFiles = torrent.files.filter((f) => videoExtensions.test(f.name));

    if (videoFiles.length === 0) return null;

    // Return the largest video file
    return videoFiles.reduce((largest, file) =>
      file.length > largest.length ? file : largest
    );
  }

  // Get file by index
  getFileByIndex(
    torrent: WebTorrent.Torrent,
    index: number
  ): WebTorrent.TorrentFile | null {
    return torrent.files[index] || null;
  }

  // Session management for auto-cleanup
  startSession(infoHash: string): string {
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Cancel any pending cleanup
    const timer = this.cleanupTimers.get(infoHash);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(infoHash);
    }

    // Add session
    if (!this.sessions.has(infoHash)) {
      this.sessions.set(infoHash, new Set());
    }
    this.sessions.get(infoHash)!.add(sessionId);

    console.log(
      `Session started: ${sessionId} for ${infoHash} (total: ${this.sessions.get(infoHash)!.size})`
    );
    return sessionId;
  }

  // End a session, starts cleanup timer if no sessions left
  endSession(infoHash: string, sessionId: string): void {
    const sessions = this.sessions.get(infoHash);
    if (!sessions) return;

    sessions.delete(sessionId);
    console.log(
      `Session ended: ${sessionId} for ${infoHash} (remaining: ${sessions.size})`
    );

    if (sessions.size === 0) {
      this.sessions.delete(infoHash);
      this.scheduleCleanup(infoHash);
    }
  }

  // Schedule cleanup after delay
  private scheduleCleanup(infoHash: string): void {
    const settings = getSettings();
    const delay = settings.cleanupDelaySeconds * 1000;

    console.log(`Scheduling cleanup for ${infoHash} in ${delay}ms`);

    const timer = setTimeout(() => {
      this.removeTorrent(infoHash);
    }, delay);

    this.cleanupTimers.set(infoHash, timer);
  }

  // Remove torrent and delete files
  removeTorrent(infoHash: string): void {
    const torrent = this.getTorrent(infoHash);
    if (!torrent) return;

    const torrentPath = join(CACHE_PATH, torrent.name);

    console.log(`Removing torrent: ${torrent.name} (${infoHash})`);

    torrent.destroy({ destroyStore: true }, () => {
      // Also clean up any remaining files
      try {
        if (existsSync(torrentPath)) {
          rmSync(torrentPath, { recursive: true, force: true });
        }
      } catch (err) {
        console.error(`Failed to cleanup files for ${infoHash}:`, err);
      }
    });

    this.cleanupTimers.delete(infoHash);
  }

  // Get all active torrents info
  getActiveTorrents(): TorrentInfo[] {
    return this.client.torrents.map((t) => this.getTorrentInfo(t));
  }

  // Get session count for a torrent
  getSessionCount(infoHash: string): number {
    return this.sessions.get(infoHash)?.size || 0;
  }

  // Cleanup all torrents (for shutdown)
  async destroy(): Promise<void> {
    // Clear all timers
    for (const timer of this.cleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.cleanupTimers.clear();
    this.sessions.clear();

    return new Promise((resolve) => {
      this.client.destroy(() => {
        resolve();
      });
    });
  }
}

export function getTorrentEngine(): TorrentEngine {
  if (!globalThis.__torrentEngine) {
    globalThis.__torrentEngine = new TorrentEngine();
  }
  return globalThis.__torrentEngine;
}

export type { TorrentEngine };
