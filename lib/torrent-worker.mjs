/**
 * Standalone WebTorrent worker process.
 * Runs outside of Next.js/Webpack to avoid UDP socket interference.
 * Communicates via HTTP server on a random port (port sent to parent via IPC).
 */

import http from "http";
import { join } from "path";
import {
  rmSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "fs";
import WebTorrent from "webtorrent";

const PROJECT_ROOT = process.cwd();
const CACHE_PATH = join(PROJECT_ROOT, "data", "cache");
const SETTINGS_PATH = join(PROJECT_ROOT, "data", "settings.json");

const PUBLIC_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://open.stealth.si:80/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "wss://tracker.openwebtorrent.com",
  "wss://tracker.btorrent.xyz",
];

const DEFAULT_SETTINGS = {
  downloadLimit: -1,
  uploadLimit: -1,
  maxConnections: 55,
  cleanupDelaySeconds: 30,
  prebufferSeconds: 30,
  bufferSizeMB: 300,
};

// --- Settings ---

function getSettings() {
  try {
    if (existsSync(SETTINGS_PATH)) {
      const data = readFileSync(SETTINGS_PATH, "utf-8");
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

// --- Ensure dirs ---

if (!existsSync(CACHE_PATH)) {
  mkdirSync(CACHE_PATH, { recursive: true });
}

// --- WebTorrent Client ---

const settings = getSettings();
const client = new WebTorrent({
  maxConns: settings.maxConnections,
  ...(settings.downloadLimit !== -1 && { downloadLimit: settings.downloadLimit }),
  ...(settings.uploadLimit !== -1 && { uploadLimit: settings.uploadLimit }),
});

client.on("error", (err) => {
  console.error("WebTorrent error:", err);
});

// --- State ---

const sessions = new Map(); // infoHash -> Set<sessionId>
const cleanupTimers = new Map(); // infoHash -> timeout
const torrentPromises = new Map(); // dedupKey -> Promise
const addedAt = new Map(); // infoHash -> timestamp

// --- Cache cleanup ---

function cleanOrphanedCache() {
  try {
    const maxAgeMs = getSettings().cleanupDelaySeconds * 1000;
    const now = Date.now();
    const entries = readdirSync(CACHE_PATH, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "subtitles") continue;
      const fullPath = join(CACHE_PATH, entry.name);
      try {
        const stat = statSync(fullPath);
        const age = now - stat.mtimeMs;
        if (age > maxAgeMs) {
          console.log(
            `Cleaning orphaned cache: ${entry.name} (${Math.round(age / 60000)}min old)`
          );
          rmSync(fullPath, { recursive: true, force: true });
        }
      } catch {}
    }
  } catch (err) {
    console.error("Failed to clean orphaned cache:", err);
  }
}

cleanOrphanedCache();

// --- Sweep ---

function sweepOrphanedTorrents() {
  const graceMs = getSettings().cleanupDelaySeconds * 1000;
  for (const torrent of client.torrents) {
    const hash = torrent.infoHash;
    const sessionCount = sessions.get(hash)?.size || 0;
    const hasTimer = cleanupTimers.has(hash);
    const added = addedAt.get(hash) || 0;
    const age = Date.now() - added;
    if (sessionCount > 0 || hasTimer || age < graceMs) continue;
    console.log(`Sweep: removing orphaned torrent ${torrent.name} (${hash})`);
    removeTorrent(hash);
  }
}

setInterval(sweepOrphanedTorrents, 120000);

// --- Helper: extract infoHash from magnet ---

function extractInfoHash(input) {
  const match = input.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  return match ? match[1].toLowerCase() : null;
}

// --- Torrent operations ---

function getTorrent(infoHash) {
  return (
    client.torrents.find(
      (t) => t.infoHash.toLowerCase() === infoHash.toLowerCase()
    ) || null
  );
}

function findTorrentByMagnetURI(uri) {
  return client.torrents.find((t) => t.magnetURI === uri) || null;
}

function getTorrentInfo(torrent) {
  return {
    infoHash: torrent.infoHash,
    name: torrent.name,
    files: torrent.files.map((f, index) => ({
      name: f.name,
      path: f.path,
      length: f.length,
      index,
    })),
    progress: torrent.progress,
    downloadSpeed: torrent.downloadSpeed,
    uploadSpeed: torrent.uploadSpeed,
    numPeers: torrent.numPeers,
    ready: torrent.ready,
  };
}

async function addTorrent(magnet) {
  const infoHash = extractInfoHash(magnet);

  // Check existing
  const existing = infoHash
    ? client.torrents.find(
        (t) => t.infoHash === infoHash || t.magnetURI === magnet
      )
    : client.torrents.find((t) => t.magnetURI === magnet);

  if (existing) {
    if (existing.ready) return getTorrentInfo(existing);
    return new Promise((resolve) => {
      existing.once("ready", () => resolve(getTorrentInfo(existing)));
    });
  }

  const dedupKey = infoHash || magnet;
  if (torrentPromises.has(dedupKey)) {
    return torrentPromises.get(dedupKey);
  }

  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Torrent metadata timeout"));
    }, 60000);

    try {
      const torrent = client.add(magnet, {
        path: CACHE_PATH,
        announce: PUBLIC_TRACKERS,
      });

      torrent.on("ready", () => {
        clearTimeout(timeout);
        addedAt.set(torrent.infoHash, Date.now());
        console.log(`Torrent ready: ${torrent.name} (${torrent.infoHash})`);
        resolve(getTorrentInfo(torrent));
      });

      torrent.on("error", (err) => {
        clearTimeout(timeout);
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("duplicate torrent")) {
          const hashMatch = message.match(/([a-f0-9]{40})/i);
          const dup = hashMatch
            ? client.torrents.find((t) => t.infoHash === hashMatch[1])
            : null;
          if (dup) {
            if (dup.ready) resolve(getTorrentInfo(dup));
            else
              dup.once("ready", () => {
                clearTimeout(timeout);
                resolve(getTorrentInfo(dup));
              });
            return;
          }
        }
        console.error(`Torrent error: ${message}`);
        reject(err);
      });
    } catch (err) {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("duplicate torrent")) {
        const hashMatch = message.match(/([a-f0-9]{40})/i);
        const dup = hashMatch
          ? client.torrents.find((t) => t.infoHash === hashMatch[1])
          : null;
        if (dup) {
          if (dup.ready) resolve(getTorrentInfo(dup));
          else
            dup.once("ready", () => {
              clearTimeout(timeout);
              resolve(getTorrentInfo(dup));
            });
          return;
        }
      }
      reject(err);
    }
  });

  // Catch to prevent unhandled rejection when stored in map
  const tracked = promise.catch(() => null);
  torrentPromises.set(dedupKey, tracked);
  tracked.finally(() => torrentPromises.delete(dedupKey));

  return promise;
}

function startSession(infoHash) {
  const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const timer = cleanupTimers.get(infoHash);
  if (timer) {
    clearTimeout(timer);
    cleanupTimers.delete(infoHash);
  }

  if (!sessions.has(infoHash)) {
    sessions.set(infoHash, new Set());
  }
  sessions.get(infoHash).add(sessionId);

  console.log(
    `Session started: ${sessionId} for ${infoHash} (total: ${sessions.get(infoHash).size})`
  );
  return sessionId;
}

function endSession(infoHash, sessionId) {
  const s = sessions.get(infoHash);
  if (!s) return;

  s.delete(sessionId);
  console.log(
    `Session ended: ${sessionId} for ${infoHash} (remaining: ${s.size})`
  );

  if (s.size === 0) {
    sessions.delete(infoHash);
    scheduleCleanup(infoHash);
  }
}

function scheduleCleanup(infoHash) {
  const delay = getSettings().cleanupDelaySeconds * 1000;
  console.log(`Scheduling cleanup for ${infoHash} in ${delay}ms`);
  const timer = setTimeout(() => removeTorrent(infoHash), delay);
  cleanupTimers.set(infoHash, timer);
}

function removeTorrent(infoHash) {
  const torrent = getTorrent(infoHash);
  if (!torrent) return;
  const torrentPath = join(CACHE_PATH, torrent.name);
  console.log(`Removing torrent: ${torrent.name} (${infoHash})`);
  torrent.destroy({ destroyStore: true }, () => {
    try {
      if (existsSync(torrentPath)) {
        rmSync(torrentPath, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`Failed to cleanup files for ${infoHash}:`, err);
    }
  });
  cleanupTimers.delete(infoHash);
  addedAt.delete(infoHash);
}

function getActiveTorrents() {
  return client.torrents.map((t) => getTorrentInfo(t));
}

function getSessionCount(infoHash) {
  return sessions.get(infoHash)?.size || 0;
}

// --- HTTP Server ---

const MAX_CHUNK_SIZE = 5 * 1024 * 1024;

function parseRange(rangeHeader, fileSize) {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) return [0, fileSize - 1];
  const start = parseInt(match[1], 10);
  const end = match[2]
    ? Math.min(parseInt(match[2], 10), fileSize - 1)
    : Math.min(start + MAX_CHUNK_SIZE - 1, fileSize - 1);
  return [start, end];
}

const contentTypes = {
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  m4v: "video/mp4",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
};

function jsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const path = url.pathname;

  try {
    // POST /add - Add torrent
    if (req.method === "POST" && path === "/add") {
      const body = await parseBody(req);
      if (!body?.magnet) return jsonResponse(res, 400, { error: "Missing magnet" });

      const infoHash = extractInfoHash(body.magnet);

      // Check if already exists
      const existing = infoHash ? getTorrent(infoHash) : findTorrentByMagnetURI(body.magnet);
      if (existing) {
        if (existing.ready) return jsonResponse(res, 200, getTorrentInfo(existing));
        // Wait for existing to be ready
        existing.once("ready", () => jsonResponse(res, 200, getTorrentInfo(existing)));
        return;
      }

      // Add directly without Promise wrapper
      const torrent = client.add(body.magnet, {
        path: CACHE_PATH,
        announce: PUBLIC_TRACKERS,
      });

      torrent.on("ready", () => {
        addedAt.set(torrent.infoHash, Date.now());
        console.log(`Torrent ready: ${torrent.name} (${torrent.infoHash})`);
        jsonResponse(res, 200, getTorrentInfo(torrent));
      });

      torrent.on("error", (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("duplicate torrent")) {
          const hashMatch = msg.match(/([a-f0-9]{40})/i);
          const dup = hashMatch
            ? client.torrents.find((t) => t.infoHash === hashMatch[1])
            : null;
          if (dup) {
            if (dup.ready) return jsonResponse(res, 200, getTorrentInfo(dup));
            dup.once("ready", () => jsonResponse(res, 200, getTorrentInfo(dup)));
            return;
          }
        }
        console.error(`Torrent error: ${msg}`);
        if (!res.headersSent) jsonResponse(res, 500, { error: msg });
      });

      // Timeout
      setTimeout(() => {
        if (!res.headersSent) {
          jsonResponse(res, 504, { error: "Torrent metadata timeout" });
        }
      }, 60000);

      return;
    }

    // GET /torrents - List all
    if (req.method === "GET" && path === "/torrents") {
      const torrents = getActiveTorrents();
      const withSessions = torrents.map((t) => ({
        ...t,
        sessionCount: getSessionCount(t.infoHash),
      }));
      return jsonResponse(res, 200, { count: torrents.length, torrents: withSessions });
    }

    // GET /torrent/:infoHash - Get one
    if (req.method === "GET" && path.startsWith("/torrent/")) {
      const infoHash = path.split("/")[2];
      const torrent = getTorrent(infoHash);
      if (!torrent) return jsonResponse(res, 404, { error: "Not found" });
      return jsonResponse(res, 200, {
        ...getTorrentInfo(torrent),
        sessionCount: getSessionCount(infoHash),
      });
    }

    // GET /status?magnet= - Check torrent status
    if (req.method === "GET" && path === "/status") {
      const magnet = url.searchParams.get("magnet");
      if (!magnet) return jsonResponse(res, 400, { error: "Missing magnet" });
      const hash = extractInfoHash(magnet);
      const torrent = hash ? getTorrent(hash) : findTorrentByMagnetURI(magnet);
      if (!torrent) return jsonResponse(res, 200, { status: "not_found" });
      return jsonResponse(res, 200, {
        status: torrent.ready ? "ready" : "connecting",
        name: torrent.name,
        infoHash: torrent.infoHash,
        peers: torrent.numPeers,
        progress: Math.round(torrent.progress * 100),
        ready: torrent.ready,
        files: torrent.files.length,
      });
    }

    // POST /session - Start session
    if (req.method === "POST" && path === "/session") {
      const body = await parseBody(req);
      if (!body) return jsonResponse(res, 400, { error: "Invalid body" });

      // Handle sendBeacon cleanup (method: "DELETE")
      if (body.method === "DELETE" && body.infoHash && body.sessionId) {
        endSession(body.infoHash, body.sessionId);
        return jsonResponse(res, 200, { success: true });
      }

      if (!body.magnet) return jsonResponse(res, 400, { error: "Missing magnet" });
      const hash = extractInfoHash(body.magnet);
      const existing = hash
        ? getTorrent(hash)
        : findTorrentByMagnetURI(body.magnet);

      if (existing) {
        const sessionId = startSession(existing.infoHash);
        return jsonResponse(res, 200, {
          infoHash: existing.infoHash,
          name: existing.name,
          sessionId,
          ready: existing.ready,
        });
      }

      return jsonResponse(res, 200, { infoHash: hash, ready: false });
    }

    // DELETE /session - End session
    if (req.method === "DELETE" && path === "/session") {
      const body = await parseBody(req);
      if (body?.infoHash && body?.sessionId) {
        endSession(body.infoHash, body.sessionId);
      }
      return jsonResponse(res, 200, { success: true });
    }

    // GET /stream/:infoHash?file=N - Stream video
    if (req.method === "GET" && path.startsWith("/stream/")) {
      const infoHash = path.split("/")[2];
      const torrent = getTorrent(infoHash);
      if (!torrent) return jsonResponse(res, 404, { error: "Torrent not found" });

      const fileParam = url.searchParams.get("file");
      let file;

      if (fileParam !== null) {
        file = torrent.files[parseInt(fileParam, 10)];
      } else {
        const videoExts = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv)$/i;
        let maxSize = 0;
        for (const f of torrent.files) {
          if (videoExts.test(f.name) && f.length > maxSize) {
            maxSize = f.length;
            file = f;
          }
        }
      }

      if (!file) return jsonResponse(res, 404, { error: "No video file found" });

      const fileSize = file.length;
      file.select();

      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const contentType = contentTypes[ext] || "video/mp4";

      const rangeHeader = req.headers.range || "bytes=0-";
      const [start, end] = parseRange(rangeHeader, fileSize);
      const chunkSize = end - start + 1;

      console.log(
        `Stream ${file.name}: ${start}-${end}/${fileSize} (${(chunkSize / 1024 / 1024).toFixed(1)}MB)`
      );

      const stream = file.createReadStream({ start, end });

      // Timeout: if no data in 2 minutes, abort
      let dataTimer = setTimeout(() => {
        console.error("Stream timeout: no data received in 120s");
        stream.destroy();
        if (!res.headersSent) {
          jsonResponse(res, 503, { error: "Stream timeout" });
        } else {
          res.end();
        }
      }, 120000);

      stream.on("data", () => {
        clearTimeout(dataTimer);
        dataTimer = setTimeout(() => {
          console.error("Stream timeout: no data received in 120s");
          stream.destroy();
          res.end();
        }, 120000);
      });

      stream.on("end", () => clearTimeout(dataTimer));
      stream.on("error", (err) => {
        clearTimeout(dataTimer);
        console.error("Stream error:", err);
        if (!res.headersSent) {
          jsonResponse(res, 500, { error: "Stream error" });
        } else {
          res.end();
        }
      });

      res.writeHead(206, {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Content-Length": chunkSize,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
      });

      stream.pipe(res);
      return;
    }

    // GET /subtitle/:infoHash - List or serve subtitles
    if (req.method === "GET" && path.startsWith("/subtitle/")) {
      const infoHash = path.split("/")[2];
      const torrent = getTorrent(infoHash);
      if (!torrent) return jsonResponse(res, 404, { error: "Torrent not found" });

      const fileParam = url.searchParams.get("file");
      const subtitleExts = /\.(srt|vtt)$/i;

      // Serve specific subtitle file
      if (fileParam !== null) {
        const idx = parseInt(fileParam, 10);
        const file = torrent.files[idx];
        if (!file || !subtitleExts.test(file.name)) {
          return jsonResponse(res, 404, { error: "Subtitle file not found" });
        }

        const chunks = [];
        const stream = file.createReadStream();
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => {
          let content = Buffer.concat(chunks).toString("utf-8");
          if (file.name.endsWith(".srt")) {
            content =
              "WEBVTT\n\n" +
              content
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n")
                .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
          }
          res.writeHead(200, {
            "Content-Type": "text/vtt; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
          });
          res.end(content);
        });
        stream.on("error", (err) => {
          console.error("Subtitle stream error:", err);
          jsonResponse(res, 500, { error: "Failed to read subtitle" });
        });
        return;
      }

      // List subtitles
      const subtitles = torrent.files
        .map((f, i) => ({ name: f.name, index: i, type: "file" }))
        .filter((f) => subtitleExts.test(f.name));

      return jsonResponse(res, 200, { subtitles });
    }

    // OPTIONS - CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
      });
      return res.end();
    }

    jsonResponse(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("Worker request error:", err);
    if (!res.headersSent) {
      jsonResponse(res, 500, { error: err.message || "Internal error" });
    }
  }
});

// Listen on random port and send to parent
server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  console.log(`Torrent worker listening on port ${port}`);
  if (process.send) {
    process.send({ type: "ready", port });
  }
});

// Prevent unhandled rejections from crashing the worker
process.on("unhandledRejection", (err) => {
  console.error("Worker unhandled rejection:", err?.message || err);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Worker shutting down...");
  server.close();
  client.destroy(() => process.exit(0));
});

process.on("SIGINT", () => {
  server.close();
  client.destroy(() => process.exit(0));
});
