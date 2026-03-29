import "server-only";
import { fork, type ChildProcess } from "child_process";
import { join } from "path";
import type { TorrentInfo } from "@/types";

declare global {
  // eslint-disable-next-line no-var
  var __torrentEngine: TorrentEngine | undefined;
}

const WORKER_SCRIPT = join(process.cwd(), "lib", "torrent-worker.mjs");

class TorrentEngine {
  private worker: ChildProcess | null = null;
  private workerPort: number | null = null;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;

  constructor() {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    this.spawnWorker();
  }

  private spawnWorker(): void {
    this.worker = fork(WORKER_SCRIPT, [], {
      stdio: ["pipe", "inherit", "inherit", "ipc"],
      cwd: process.cwd(),
    });

    this.worker.on("message", (msg: { type: string; port?: number }) => {
      if (msg.type === "ready" && msg.port) {
        this.workerPort = msg.port;
        console.log(`Torrent worker ready on port ${msg.port}`);
        this.resolveReady();
      }
    });

    this.worker.on("exit", (code) => {
      console.error(`Torrent worker exited with code ${code}`);
      this.workerPort = null;
      // Auto-restart
      setTimeout(() => {
        this.readyPromise = new Promise((resolve) => {
          this.resolveReady = resolve;
        });
        this.spawnWorker();
      }, 1000);
    });
  }

  private async baseUrl(): Promise<string> {
    await this.readyPromise;
    return `http://127.0.0.1:${this.workerPort}`;
  }

  private async request(path: string, options?: RequestInit): Promise<Response> {
    const base = await this.baseUrl();
    return fetch(`${base}${path}`, options);
  }

  // --- Public API (matches the old TorrentEngine interface) ---

  async addTorrent(magnet: string): Promise<TorrentInfo> {
    const res = await this.request("/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ magnet }),
    });

    const data = await res.json();

    // If torrent is already ready, return immediately
    if (res.status === 200) return data;

    // 202 = loading. Poll until ready (up to 60s)
    const infoHash = data.infoHash;
    if (!infoHash) throw new Error("No infoHash returned");

    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusRes = await this.request(`/torrent/${infoHash}`);
      if (statusRes.ok) {
        const info = await statusRes.json();
        if (info.ready) return info;
      }
    }

    throw new Error("Torrent metadata timeout");
  }

  async getTorrent(infoHash: string): Promise<TorrentInfo | null> {
    const res = await this.request(`/torrent/${infoHash}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return res.json();
  }

  async findTorrentByMagnetURI(uri: string): Promise<TorrentInfo | null> {
    // Use the status endpoint which accepts magnet
    const res = await this.request(
      `/status?magnet=${encodeURIComponent(uri)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status === "not_found") return null;
    return data;
  }

  async getTorrentStatus(
    magnet: string
  ): Promise<{
    status: string;
    name?: string;
    infoHash?: string;
    peers?: number;
    progress?: number;
    ready?: boolean;
    files?: number;
  }> {
    const res = await this.request(
      `/status?magnet=${encodeURIComponent(magnet)}`
    );
    return res.json();
  }

  async startSession(
    magnet: string
  ): Promise<{
    infoHash: string;
    name?: string;
    sessionId?: string;
    ready: boolean;
  }> {
    const res = await this.request("/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ magnet }),
    });
    return res.json();
  }

  async startSessionBeaconCleanup(
    infoHash: string,
    sessionId: string
  ): Promise<void> {
    await this.request("/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "DELETE", infoHash, sessionId }),
    });
  }

  async endSession(infoHash: string, sessionId: string): Promise<void> {
    await this.request("/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ infoHash, sessionId }),
    });
  }

  async getActiveTorrents(): Promise<{
    count: number;
    torrents: (TorrentInfo & { sessionCount: number })[];
  }> {
    const res = await this.request("/torrents");
    return res.json();
  }

  /**
   * Returns the worker's base URL for proxying stream/subtitle requests.
   * The API routes use this to build proxy URLs.
   */
  async getWorkerBaseUrl(): Promise<string> {
    return this.baseUrl();
  }

  async destroy(): Promise<void> {
    if (this.worker) {
      this.worker.kill("SIGTERM");
      this.worker = null;
    }
  }
}

export function getTorrentEngine(): TorrentEngine {
  if (!globalThis.__torrentEngine) {
    globalThis.__torrentEngine = new TorrentEngine();
  }
  return globalThis.__torrentEngine;
}

export type { TorrentEngine };
