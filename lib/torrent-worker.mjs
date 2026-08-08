/**
 * Standalone WebTorrent worker process.
 * Runs outside of Next.js/Webpack to avoid UDP socket interference.
 * Communicates via HTTP server on a random port (port sent to parent via IPC).
 */

import http from "http";
import { join, resolve } from "path";
import {
  rmSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  createReadStream as fsCreateReadStream,
} from "fs";
import { spawn } from "child_process";
import WebTorrent from "webtorrent";
import pump from "pump";
import rangeParser from "range-parser";

const PROJECT_ROOT = process.cwd();

// Mirrors lib/data-dir.ts's resolution (pointer file > DATA_DIR env > ./data
// default). Read once at process start — a fresh read happens naturally on
// every worker respawn triggered by a runtime directory switch.
function resolveDataDir() {
  const mediaRoot = resolve(process.env.MEDIA_ROOT || PROJECT_ROOT);
  const pointerPath = join(mediaRoot, ".active-data-dir");
  if (existsSync(pointerPath)) {
    const stored = readFileSync(pointerPath, "utf-8").trim();
    if (stored) return resolve(stored);
  }
  return process.env.DATA_DIR
    ? resolve(process.env.DATA_DIR)
    : join(PROJECT_ROOT, "data");
}

const DATA_DIR = resolveDataDir();
const CACHE_PATH = join(DATA_DIR, "cache");

// Keep the worker alive even if a tracker callback or other async code throws.
// Without this, Node exits on uncaught exceptions and the parent supervisor
// restarts from scratch, losing all in-progress download state.
process.on("uncaughtException", (err) => {
  console.error("[worker] uncaughtException:", err?.stack || err?.message || err);
});
process.on("unhandledRejection", (err) => {
  console.error("[worker] unhandledRejection:", err?.stack || err?.message || err);
});
const SETTINGS_PATH = join(DATA_DIR, "settings.json");
const LIBRARY_PATH = join(DATA_DIR, "library.json");

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
  uploadLimit: 1048576,   // 1 MB/s — prevents upstream saturation that kills WiFi
  maxConnections: 35,     // lower NAT table pressure on home routers
  cleanupDelaySeconds: 30,
  prebufferSeconds: 90,
  bufferSizeMB: 200,
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
const selectedVideoFile = new Map(); // infoHash -> currently selected file object

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

// --- Sweep disabled — user deletes torrents manually via the app ---

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
        // Start with nothing selected. Without this, WebTorrent selects every
        // piece the moment metadata lands, so a season pack begins downloading
        // all episodes in the window before the "ready" handler below can
        // deselect them.
        deselect: true,
      });

      torrent.on("ready", () => {
        clearTimeout(timeout);
        addedAt.set(torrent.infoHash, Date.now());
        patchTorrentGetters(torrent);

        // Clear WebTorrent's implicit whole-torrent piece selection, then deselect all files
        if (torrent.pieces?.length) {
          torrent.deselect(0, torrent.pieces.length - 1, false);
        }
        torrent.files.forEach((f) => f.deselect());

        const videoExts = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv)$/i;
        const videoFiles = torrent.files.filter((f) => videoExts.test(f.name));

        if (videoFiles.length === 1) {
          // Single-video torrent (movie): auto-select so it starts downloading immediately
          videoFiles[0].select();
          selectedVideoFile.set(torrent.infoHash, videoFiles[0]);
          waitForHead(torrent, videoFiles[0]).catch(() => {}); // prime head pieces early
          console.log(`Torrent ready: ${torrent.name} (${torrent.infoHash}) — auto-selected ${videoFiles[0].name}`);
        } else {
          // Multi-video torrent (season pack): wait for the user to pick an episode
          console.log(`Torrent ready: ${torrent.name} (${torrent.infoHash}) — ${videoFiles.length} episodes, waiting for selection`);
        }

        // Select subtitle files — they're small and download fast
        const subExts = /\.(srt|vtt|ass|ssa|sub)$/i;
        for (const f of torrent.files) {
          if (subExts.test(f.name)) {
            f.select();
          }
        }

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
  markActive(infoHash);

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
    schedulePause(infoHash);
  }
}

// --- Idle pausing ---
//
// A torrent stays in the client after you stop watching it, and WebTorrent keeps
// pulling every selected piece. Watching three episodes of a series therefore
// leaves three torrents downloading at once, long after only one is on screen.
// Stopping means deselecting — NOT destroying: the bytes already on disk stay
// put so watch progress can resume from them, and reclaiming stays a deliberate
// choice made through the UI.

const pausedTorrents = new Set(); // infoHash of torrents parked as idle
const lastActivityAt = new Map(); // infoHash -> timestamp of last stream/probe

function idleDelayMs() {
  // Reuse the existing cleanup setting; never park anything faster than 10s.
  return Math.max(10, getSettings().cleanupDelaySeconds) * 1000;
}

/** Called whenever bytes are actually being served for a torrent. */
function markActive(infoHash) {
  lastActivityAt.set(infoHash, Date.now());
  pausedTorrents.delete(infoHash);
  const timer = cleanupTimers.get(infoHash);
  if (timer) {
    clearTimeout(timer);
    cleanupTimers.delete(infoHash);
  }
}

function isBusy(infoHash) {
  if (getSessionCount(infoHash) > 0) return true;
  const last = lastActivityAt.get(infoHash);
  return last !== undefined && Date.now() - last < idleDelayMs();
}

/** Stop downloading, keep every byte already written. */
function pauseTorrent(infoHash) {
  const torrent = getTorrent(infoHash);
  if (!torrent) return;
  if (isBusy(infoHash)) {
    // Still in use — check again later rather than cutting a live stream off.
    schedulePause(infoHash);
    return;
  }
  if (pausedTorrents.has(infoHash)) return;

  try {
    if (torrent.pieces?.length) {
      torrent.deselect(0, torrent.pieces.length - 1);
    }
    for (const file of torrent.files) {
      try {
        file.deselect();
      } catch {}
    }
  } catch (err) {
    console.error(`Failed to pause ${infoHash}:`, err?.message || err);
    return;
  }

  pausedTorrents.add(infoHash);
  // Forget the selection so resuming the same episode re-selects it rather than
  // being short-circuited by the "already selected" check in /stream and /probe.
  selectedVideoFile.delete(infoHash);
  console.log(`Paused idle torrent: ${torrent.name} (files kept on disk)`);
}

function schedulePause(infoHash) {
  const existing = cleanupTimers.get(infoHash);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    cleanupTimers.delete(infoHash);
    pauseTorrent(infoHash);
  }, idleDelayMs());
  cleanupTimers.set(infoHash, timer);
}

// Catches torrents that were added but never streamed — opening the file picker
// and backing out would otherwise leave a movie downloading forever.
setInterval(() => {
  for (const torrent of client.torrents) {
    const hash = torrent.infoHash;
    if (!torrent.ready) continue;
    if (pausedTorrents.has(hash) || cleanupTimers.has(hash)) continue;
    if (isBusy(hash)) continue;
    const since = lastActivityAt.get(hash) ?? addedAt.get(hash) ?? Date.now();
    if (Date.now() - since < idleDelayMs()) continue;
    pauseTorrent(hash);
  }
}, 15_000).unref?.();

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
  selectedVideoFile.delete(infoHash);
  pausedTorrents.delete(infoHash);
  lastActivityAt.delete(infoHash);
}

function getActiveTorrents() {
  return client.torrents.map((t) => getTorrentInfo(t));
}

function findVideoFile(torrent, fileParam) {
  if (fileParam !== undefined && fileParam !== null) {
    return torrent.files[parseInt(fileParam, 10)];
  }
  const videoExts = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv)$/i;
  let maxSize = 0;
  let videoFile = null;
  for (const f of torrent.files) {
    if (videoExts.test(f.name) && f.length > maxSize) {
      maxSize = f.length;
      videoFile = f;
    }
  }
  return videoFile;
}

// Wait until the first `headBytes` of `file` are on disk (not just sparse-allocated).
// Drains a priority createReadStream to force WebTorrent off rarest-first for the head,
// so ffprobe/ffmpeg see real EBML bytes at offset 0 instead of zeros.
async function waitForHead(torrent, file, headBytes = 2_000_000, timeoutMs = 30_000) {
  const endByte = Math.min(file.length - 1, headBytes - 1);
  const pieceLen = torrent.pieceLength;
  const startPiece = Math.floor(file.offset / pieceLen);
  const endPiece = Math.floor((file.offset + endByte) / pieceLen);

  const hasAll = () => {
    for (let i = startPiece; i <= endPiece; i++) {
      if (!torrent.bitfield.get(i)) return false;
    }
    return true;
  };
  if (hasAll()) return true;

  const priorityStream = file.createReadStream({ start: 0, end: endByte });
  priorityStream.on("data", () => {});
  priorityStream.on("error", () => {});

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (hasAll()) return true;
    }
    return false;
  } finally {
    priorityStream.destroy();
  }
}

// Delete a single file's bytes from disk and clear its bitfield pieces so
// WebTorrent re-downloads them if the file is re-selected. Used on episode
// switch inside a season pack to keep disk bounded to one episode at a time.
function purgeFileBytes(torrent, file) {
  try {
    const pieceLen = torrent.pieceLength;
    const startPiece = Math.floor(file.offset / pieceLen);
    const endPiece = Math.floor((file.offset + file.length - 1) / pieceLen);

    // Use WebTorrent's own _markUnverified to recreate Piece objects + flip bitfield.
    // Manually flipping only bitfield[i]=false while pieces[i] is already null (WebTorrent
    // nulls verified pieces as a memory optimization) produces a state WebTorrent never
    // creates itself, causing null-derefs in _request, speedRanker, _hotswap, etc.
    // _markUnverified allocates a fresh Piece so all internal sites see a valid object.
    // We suppress its implicit select() call so we don't undo the preceding file.deselect().
    const prevStartAsDeselected = torrent._startAsDeselected;
    torrent._startAsDeselected = true;
    try {
      for (let i = startPiece; i <= endPiece; i++) {
        if (torrent.bitfield.get(i)) torrent._markUnverified(i);
      }
    } finally {
      torrent._startAsDeselected = prevStartAsDeselected;
    }

    const diskPath = join(CACHE_PATH, file.path);
    if (existsSync(diskPath)) {
      unlinkSync(diskPath);
      console.log(`Purged episode bytes: ${file.name}`);
    }
  } catch (err) {
    console.error(`purgeFileBytes failed for ${file.name}:`, err.message);
  }
}

// Patch WebTorrent's `get downloaded` to handle null pieces gracefully.
// Upstream bug: pieces[i] is set to null once WebTorrent verifies a piece to disk
// (memory optimization), but the getter only guards against this when bitfield[i]=true.
// Our purgeFileBytes() sets bitfield[i]=false on already-nulled pieces, which causes
// the else-branch to dereference null → crash from tracker-announce callbacks.
// This patch restores the missing null-guard so purge+re-download works safely.
function patchTorrentGetters(torrent) {
  const proto = Object.getPrototypeOf(torrent);
  if (proto.__downloadedPatched) return;
  Object.defineProperty(proto, "downloaded", {
    configurable: true,
    get() {
      if (!this.bitfield || !this.pieces) return 0;
      let downloaded = 0;
      const last = this.pieces.length - 1;
      for (let i = 0; i <= last; i++) {
        if (this.bitfield.get(i)) {
          downloaded += (i === last && this.lastPieceLength) ? this.lastPieceLength : this.pieceLength;
        } else {
          const piece = this.pieces[i];
          if (piece) downloaded += (piece.length - piece.missing);
          // piece === null + bitfield false → purged; contributes 0
        }
      }
      return Math.min(this.length, downloaded);
    },
  });
  proto.__downloadedPatched = true;
}

function getSessionCount(infoHash) {
  return sessions.get(infoHash)?.size || 0;
}

// --- HTTP Server ---

const MB = 1024 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));


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
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
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

// --- TV Interface (Chrome 38 compatible — ES5, no CSS vars, no fetch) ---

function escapeHTML(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildTVPageHTML(items, port) {
  var rows = "";
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var magnetEscaped = escapeHTML(item.magnet);
    var nameEscaped = escapeHTML(item.name);
    rows += '<div class="item" tabindex="0" data-magnet="' + magnetEscaped + '" data-name="' + nameEscaped + '" onclick="playItem(this)">'
      + '<span class="play-icon">&#9654;</span>'
      + '<span class="name">' + nameEscaped + '</span>'
      + '</div>';
  }

  return '<!DOCTYPE html>'
    + '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Spaceflix TV</title>'
    + '<style>'
    + 'html,body{margin:0;padding:0;background:#0d0b14;color:#f9f9f9;font-family:Arial,Helvetica,sans-serif;}'
    + '.header{padding:24px 32px;border-bottom:1px solid #2a2440;}'
    + '.header h1{margin:0;font-size:28px;color:#8b5cf6;}'
    + '.list{padding:16px 32px;}'
    + '.item{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;'
    + 'padding:16px 20px;margin-bottom:4px;border-radius:8px;cursor:pointer;border:2px solid transparent;}'
    + '.item:hover,.item:focus{background:#1e1a2e;border-color:#8b5cf6;outline:none;}'
    + '.play-icon{color:#8b5cf6;font-size:20px;margin-right:16px;-webkit-flex-shrink:0;flex-shrink:0;}'
    + '.name{font-size:18px;color:#e0e0e0;}'
    + '.loading{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);'
    + '-webkit-align-items:center;align-items:center;-webkit-justify-content:center;justify-content:center;z-index:100;}'
    + '.loading.show{display:-webkit-flex;display:flex;}'
    + '.loading-text{color:#f9f9f9;font-size:22px;}'
    + '.spinner{border:4px solid #2a2440;border-top:4px solid #8b5cf6;border-radius:50%;width:40px;height:40px;'
    + 'margin-bottom:16px;-webkit-animation:spin 1s linear infinite;animation:spin 1s linear infinite;}'
    + '@-webkit-keyframes spin{0%{-webkit-transform:rotate(0deg)}100%{-webkit-transform:rotate(360deg)}}'
    + '@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}'
    + '.empty{text-align:center;padding:60px 20px;color:#71717a;font-size:18px;}'
    + '</style></head><body>'
    + '<div class="header"><h1>Spaceflix</h1></div>'
    + '<div class="list">'
    + (rows || '<div class="empty">No items in library. Add movies from your laptop.</div>')
    + '</div>'
    + '<div class="loading" id="loadingOverlay">'
    + '<div style="text-align:center"><div class="spinner" style="margin:0 auto 16px auto"></div>'
    + '<div class="loading-text" id="loadingText">Loading...</div></div></div>'
    + '<script>'
    + 'function playItem(el){'
    + '  var magnet=el.getAttribute("data-magnet");'
    + '  var name=el.getAttribute("data-name");'
    + '  var overlay=document.getElementById("loadingOverlay");'
    + '  var text=document.getElementById("loadingText");'
    + '  overlay.className="loading show";'
    + '  text.innerHTML="Loading " + name + "...";'
    + '  var xhr=new XMLHttpRequest();'
    + '  xhr.open("POST","/add",true);'
    + '  xhr.setRequestHeader("Content-Type","application/json");'
    + '  xhr.onreadystatechange=function(){'
    + '    if(xhr.readyState===4){'
    + '      if(xhr.status===200||xhr.status===202){'
    + '        try{'
    + '          var data=JSON.parse(xhr.responseText);'
    + '          var hash=data.infoHash;'
    + '          if(hash){'
    + '            window.location.href="/tv/play/"+hash+"?title="+encodeURIComponent(name);'
    + '            return;'
    + '          }'
    + '        }catch(e){}'
    + '      }'
    + '      overlay.className="loading";'
    + '      text.innerHTML="Failed to load. Try again.";'
    + '    }'
    + '  };'
    + '  xhr.send(JSON.stringify({magnet:magnet}));'
    + '}'
    + '</script></body></html>';
}

function buildTVPlayerHTML(infoHash, title, port) {
  var titleEscaped = escapeHTML(title);

  return '<!DOCTYPE html>'
    + '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + titleEscaped + ' - Spaceflix</title>'
    + '<style>'
    + 'html,body{margin:0;padding:0;background:#000;color:#f9f9f9;font-family:Arial,Helvetica,sans-serif;overflow:hidden;}'
    + '.top-bar{position:fixed;top:0;left:0;right:0;padding:12px 24px;background:rgba(0,0,0,0.8);z-index:10;'
    + 'display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;}'
    + '.back{color:#8b5cf6;text-decoration:none;font-size:18px;margin-right:16px;padding:8px 12px;border-radius:6px;}'
    + '.back:hover,.back:focus{background:#1e1a2e;outline:none;}'
    + '.title{font-size:18px;color:#e0e0e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;}'
    + '.sub-btn{color:#e0e0e0;background:rgba(255,255,255,0.1);border:none;padding:8px 14px;border-radius:6px;font-size:14px;cursor:pointer;margin-left:8px;}'
    + '.sub-btn:focus,.sub-btn:hover{background:rgba(139,92,246,0.4);outline:none;}'
    + 'video{position:fixed;top:0;left:0;width:100%;height:100%;background:#000;}'
    + '.cue{position:fixed;left:0;right:0;bottom:12%;text-align:center;z-index:9;font-size:28px;line-height:1.4;color:#fff;'
    + 'text-shadow:0 0 4px #000,0 0 6px #000,2px 2px 4px #000;padding:0 40px;white-space:pre-line;pointer-events:none;}'
    + '.status{position:fixed;bottom:0;left:0;right:0;padding:10px 24px;background:rgba(0,0,0,0.7);'
    + 'font-size:14px;color:#8b8b9e;z-index:10;text-align:center;}'
    + '</style></head><body>'
    + '<div class="top-bar">'
    + '<a href="/tv" class="back" tabindex="0">&#8592; Back</a>'
    + '<span class="title">' + titleEscaped + '</span>'
    + '<button class="sub-btn" id="subBtn" tabindex="0">Subs: Off</button>'
    + '</div>'
    + '<video id="player" controls style="display:none"></video>'
    + '<div class="cue" id="cue"></div>'
    + '<div class="status" id="status">Preparing video for TV playback...</div>'
    + '<script>'
    + 'var statusEl=document.getElementById("status");'
    + 'var cueEl=document.getElementById("cue");'
    + 'var subBtn=document.getElementById("subBtn");'
    + 'var vid=document.getElementById("player");'
    + 'var hash="' + infoHash + '";'
    + 'var transcodeUrl="/transcode/"+hash;'
    + 'var ready=false;'
    // --- Subtitle state ---
    + 'var subList=[];'        // [{label, src}]
    + 'var subCues={};'        // {index: [{start,end,text}]}
    + 'var activeSub=-1;'      // -1 = off, otherwise index into subList
    + 'var lastCueText="";'
    // --- Subtitle parser (ported from the React player) ---
    + 'function parseTime(ts){'
    + '  var p=ts.trim().split(":");'
    + '  if(p.length===3){var r=p[2].split(".");return (+p[0])*3600+(+p[1])*60+(+r[0])+(+(r[1]||0))/1000;}'
    + '  if(p.length===2){var r2=p[1].split(".");return (+p[0])*60+(+r2[0])+(+(r2[1]||0))/1000;}'
    + '  return 0;'
    + '}'
    + 'function parseVTT(txt){'
    + '  var cues=[];'
    + '  var blocks=txt.replace(/\\r\\n/g,"\\n").split("\\n\\n");'
    + '  for(var b=0;b<blocks.length;b++){'
    + '    var lines=blocks[b].split("\\n");'
    + '    for(var i=0;i<lines.length;i++){'
    + '      var m=lines[i].match(/(\\d{1,2}:[\\d:.]+)\\s*-->\\s*(\\d{1,2}:[\\d:.]+)/);'
    + '      if(m){'
    + '        var s=parseTime(m[1]),e=parseTime(m[2]);'
    // Strip HTML tags, ASS/SSA override codes, and {\\N} line breaks
    + '        var t=lines.slice(i+1).join("\\n")'
    + '          .replace(/\\{\\\\[^}]*\\}/g,"")'
    + '          .replace(/<[^>]+>/g,"")'
    + '          .replace(/\\\\N/g,"\\n")'
    + '          .trim();'
    + '        if(t)cues.push({start:s,end:e,text:t});'
    + '        break;'
    + '      }'
    + '    }'
    + '  }'
    + '  return cues;'
    + '}'
    // --- Load subtitle list on boot ---
    + 'function loadSubList(){'
    + '  var xhr=new XMLHttpRequest();'
    + '  xhr.open("GET","/subtitle/"+hash,true);'
    + '  xhr.onreadystatechange=function(){'
    + '    if(xhr.readyState===4&&xhr.status===200){'
    + '      try{'
    + '        var d=JSON.parse(xhr.responseText);'
    + '        var subs=(d.subtitles||[]);'
    + '        subList=subs.map(function(s){return {label:s.name,src:"/subtitle/"+hash+"?file="+s.index};});'
    + '      }catch(e){}'
    + '    }'
    + '  };'
    + '  xhr.send();'
    + '}'
    // --- Fetch and parse a given sub, then activate it ---
    + 'function activateSub(idx){'
    + '  activeSub=idx;'
    + '  cueEl.innerHTML="";lastCueText="";'
    + '  if(idx<0){subBtn.innerHTML="Subs: Off";return;}'
    + '  subBtn.innerHTML="Subs: "+(subList[idx].label.length>20?subList[idx].label.slice(0,20)+"...":subList[idx].label);'
    + '  if(subCues[idx]){return;}'
    + '  var xhr=new XMLHttpRequest();'
    + '  xhr.open("GET",subList[idx].src,true);'
    + '  xhr.onreadystatechange=function(){'
    + '    if(xhr.readyState===4&&xhr.status===200){'
    + '      subCues[idx]=parseVTT(xhr.responseText);'
    + '    }'
    + '  };'
    + '  xhr.send();'
    + '}'
    // --- Cycle through subtitles (off -> sub 0 -> sub 1 -> ... -> off) ---
    + 'subBtn.addEventListener("click",function(){'
    + '  if(subList.length===0){return;}'
    + '  var next=activeSub+1;'
    + '  if(next>=subList.length)next=-1;'
    + '  activateSub(next);'
    + '});'
    // --- Per-frame cue matching against video time ---
    + 'vid.addEventListener("timeupdate",function(){'
    + '  if(activeSub<0){return;}'
    + '  var cues=subCues[activeSub];'
    + '  if(!cues){return;}'
    + '  var t=vid.currentTime,match="";'
    + '  for(var i=0;i<cues.length;i++){'
    + '    if(cues[i].start<=t&&t<=cues[i].end){match=cues[i].text;break;}'
    + '    if(cues[i].start>t)break;'
    + '  }'
    + '  if(match!==lastCueText){'
    // Render with <br> for newlines; text is already stripped of HTML
    + '    cueEl.innerHTML=match.split("\\n").map(function(l){'
    + '      return l.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");'
    + '    }).join("<br>");'
    + '    lastCueText=match;'
    + '  }'
    + '});'
    // --- Transcode readiness check ---
    + 'function checkTranscode(){'
    + '  var xhr=new XMLHttpRequest();'
    + '  xhr.open("GET",transcodeUrl,true);'
    + '  xhr.onreadystatechange=function(){'
    + '    if(xhr.readyState===4){'
    + '      if(xhr.status===200){'
    + '        ready=true;'
    + '        statusEl.innerHTML="Ready! Starting playback...";'
    + '        vid.src=transcodeUrl;'
    + '        vid.style.display="block";'
    + '        vid.play();'
    + '      }else if(xhr.status===202){'
    + '        statusEl.innerHTML="Transcoding for TV... please wait";'
    + '        setTimeout(checkTranscode,3000);'
    + '      }else{'
    + '        statusEl.innerHTML="Error preparing video. Try again.";'
    + '      }'
    + '    }'
    + '  };'
    + '  xhr.send();'
    + '}'
    + 'loadSubList();'
    + 'checkTranscode();'
    + 'function pollStatus(){'
    + '  var xhr=new XMLHttpRequest();'
    + '  xhr.open("GET","/torrent/"+hash,true);'
    + '  xhr.onreadystatechange=function(){'
    + '    if(xhr.readyState===4&&xhr.status===200){'
    + '      try{'
    + '        var d=JSON.parse(xhr.responseText);'
    + '        var speed=d.downloadSpeed||0;'
    + '        var peers=d.numPeers||0;'
    + '        var pct=Math.round((d.progress||0)*100);'
    + '        var speedStr=speed<1048576?(Math.round(speed/1024)+" KB/s"):(Math.round(speed/1048576*10)/10+" MB/s");'
    + '        if(!ready){statusEl.innerHTML="Transcoding... "+pct+"% downloaded | "+peers+" peers | "+speedStr;}'
    + '        else{statusEl.innerHTML=peers+" peer"+(peers!==1?"s":"")+" | "+speedStr+" | "+pct+"% downloaded";}'
    + '      }catch(e){}'
    + '    }'
    + '  };'
    + '  xhr.send();'
    + '}'
    + 'setInterval(pollStatus,3000);'
    + 'pollStatus();'
    + 'vid.addEventListener("error",function(){'
    + '  statusEl.innerHTML="Playback error. The video codec may not be supported on this TV.";'
    + '  statusEl.style.color="#e05252";'
    + '});'
    + '</script></body></html>';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const path = url.pathname;

  try {
    // POST /add - Add torrent
    // Delegates to addTorrent() so every add goes through the same selection
    // policy: nothing selected by default, a single video auto-selected for
    // movies, a multi-episode pack left idle until the user picks an episode.
    if (req.method === "POST" && path === "/add") {
      const body = await parseBody(req);
      if (!body?.magnet) return jsonResponse(res, 400, { error: "Missing magnet" });

      try {
        const info = await addTorrent(body.magnet);
        if (!res.headersSent) jsonResponse(res, 200, info);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Torrent error: ${msg}`);
        if (!res.headersSent) {
          jsonResponse(res, msg.includes("timeout") ? 504 : 500, { error: msg });
        }
      }
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

    // DELETE /torrent/:infoHash/file?index=N — Purge one file's bytes without destroying the torrent
    if (req.method === "DELETE" && path.startsWith("/torrent/") && path.endsWith("/file")) {
      const infoHash = path.split("/")[2];
      const fileIndex = parseInt(url.searchParams.get("index") || "", 10);
      if (Number.isNaN(fileIndex)) {
        return jsonResponse(res, 400, { error: "Missing or invalid ?index=" });
      }
      const torrent = getTorrent(infoHash);
      if (!torrent) return jsonResponse(res, 404, { error: "Torrent not active" });
      const file = torrent.files[fileIndex];
      if (!file) return jsonResponse(res, 404, { error: "File index out of range" });
      try { file.deselect(); } catch {}
      purgeFileBytes(torrent, file);
      return jsonResponse(res, 200, { success: true });
    }

    // DELETE /torrent/:infoHash - Remove torrent and wipe cached files from disk
    if (req.method === "DELETE" && path.startsWith("/torrent/")) {
      const infoHash = path.split("/")[2];
      const torrent = getTorrent(infoHash);
      if (!torrent) {
        // Torrent not active — try to delete any on-disk cache by scanning for matching folder
        // Match by infoHash in name, or by item name passed via ?name= query param
        const nameParam = url.searchParams.get("name");
        const entries = readdirSync(CACHE_PATH, { withFileTypes: true });
        const match = entries.find((e) => {
          if (!e.isDirectory() && !e.isFile()) return false;
          const lower = e.name.toLowerCase();
          if (lower.includes(infoHash.toLowerCase())) return true;
          if (nameParam && lower.includes(nameParam.toLowerCase())) return true;
          return false;
        });
        if (match) {
          try {
            rmSync(join(CACHE_PATH, match.name), { recursive: true, force: true });
            console.log(`Deleted orphan cache: ${match.name}`);
          } catch (err) {
            console.error(`Failed to delete orphan cache: ${err.message}`);
          }
        }
        return jsonResponse(res, 200, { success: true, note: "not_active" });
      }
      // Cancel any pending cleanup timer so it doesn't interfere
      const timer = cleanupTimers.get(infoHash);
      if (timer) { clearTimeout(timer); cleanupTimers.delete(infoHash); }
      removeTorrent(infoHash);
      console.log(`Deleted torrent on request: ${infoHash}`);
      return jsonResponse(res, 200, { success: true });
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
      const file = findVideoFile(torrent, fileParam);

      if (!file) return jsonResponse(res, 404, { error: "No video file found" });

      markActive(infoHash);

      // Switch active selection to the requested episode if needed
      const prevVideoFile = selectedVideoFile.get(infoHash);
      if (prevVideoFile !== file) {
        if (prevVideoFile) { prevVideoFile.deselect(); purgeFileBytes(torrent, prevVideoFile); }
        file.select();
        selectedVideoFile.set(infoHash, file);
        console.log(`Episode selected: ${file.name}`);
      }

      const fileSize = file.length;

      const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
      const contentType = contentTypes[ext] || "video/mp4";

      // Match WebTorrent's built-in server (same as Peerflix)
      const headers = {
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Expires": "0",
        "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
        // DLNA headers — critical for TV streaming
        "transferMode.dlna.org": "Streaming",
        "contentFeatures.dlna.org": "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01700000000000000000000000000000",
      };

      let range = rangeParser(fileSize, req.headers.range || "");

      if (Array.isArray(range)) {
        // Valid range request — 206
        range = range[0];
        headers["Content-Range"] = `bytes ${range.start}-${range.end}/${fileSize}`;
        headers["Content-Length"] = range.end - range.start + 1;

        console.log(
          `Stream ${file.name}: ${range.start}-${range.end}/${fileSize} (${((range.end - range.start + 1) / 1024 / 1024).toFixed(1)}MB) peers=${torrent.numPeers} dl=${Math.round(torrent.downloadSpeed / 1024)}KB/s progress=${(torrent.progress * 100).toFixed(1)}%`
        );

        res.writeHead(206, headers);
        const stream = file.createReadStream({ start: range.start, end: range.end });
        pump(stream, res);
      } else {
        // No range or invalid range — 200, stream full file
        headers["Content-Length"] = fileSize;

        console.log(
          `Stream ${file.name}: full file ${(fileSize / 1024 / 1024).toFixed(1)}MB peers=${torrent.numPeers} dl=${Math.round(torrent.downloadSpeed / 1024)}KB/s progress=${(torrent.progress * 100).toFixed(1)}%`
        );

        res.writeHead(200, headers);
        const stream = file.createReadStream();
        pump(stream, res);
      }
      return;
    }

    // GET /probe/:infoHash — Return codec/container info + durationSec for the seek bar
    if (req.method === "GET" && path.startsWith("/probe/")) {
      const infoHash = path.split("/")[2];
      const torrent = getTorrent(infoHash);
      if (!torrent) return jsonResponse(res, 404, { error: "Torrent not found" });

      const fileParam = url.searchParams.get("file");
      const file = findVideoFile(torrent, fileParam);
      if (!file) return jsonResponse(res, 404, { error: "No video file" });

      markActive(infoHash);

      // Activate selection on the probed file so it starts downloading
      const prevProbeFile = selectedVideoFile.get(infoHash);
      if (prevProbeFile !== file) {
        if (prevProbeFile) { prevProbeFile.deselect(); purgeFileBytes(torrent, prevProbeFile); }
        file.select();
        selectedVideoFile.set(infoHash, file);
        waitForHead(torrent, file).catch(() => {}); // prime head pieces early
        console.log(`Episode selected (probe): ${file.name}`);
      }

      const diskPath = join(CACHE_PATH, file.path);
      // Wait for the first 2 MB (EBML header) before probing — sparse-allocated files
      // have zeros at offset 0 until that piece actually downloads, which confuses ffprobe.
      if (!existsSync(diskPath) || !(await waitForHead(torrent, file))) {
        console.log(`Probe ${file.name}: head not ready (buffering)`);
        return jsonResponse(res, 200, { durationSec: null });
      }

      const ff = spawn("ffprobe", [
        "-v", "quiet",
        "-show_format",
        "-show_streams",
        "-of", "json",
        diskPath,
      ]);

      let output = "";
      let ffErr = "";
      ff.stdout.on("data", (d) => { output += d.toString(); });
      ff.stderr.on("data", (d) => { ffErr += d.toString(); });
      ff.on("close", () => {
        try {
          const data = JSON.parse(output);
          const audioStream = data.streams?.find((s) => s.codec_type === "audio");
          const videoStream = data.streams?.find((s) => s.codec_type === "video");
          const audioCodec = (audioStream?.codec_name || "").toLowerCase();
          const videoCodec = (videoStream?.codec_name || "").toLowerCase();
          const formatName = (data.format?.format_name || "").toLowerCase();
          // Try multiple duration sources — partial files may have duration in only one place
          const rawDurations = {
            format: parseFloat(data.format?.duration || "0"),
            video: parseFloat(videoStream?.duration || "0"),
            audio: parseFloat(audioStream?.duration || "0"),
          };
          // MKV "DURATION" tag is HH:MM:SS.nnnnnnnnn format — parse it
          const parseMkvDuration = (s) => {
            if (!s || typeof s !== "string") return 0;
            const m = s.match(/^(\d+):(\d+):([\d.]+)$/);
            if (!m) return 0;
            return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3]);
          };
          const mkvDurationVideo = parseMkvDuration(videoStream?.tags?.DURATION);
          const mkvDurationAudio = parseMkvDuration(audioStream?.tags?.DURATION);
          const durationSec =
            rawDurations.format ||
            rawDurations.video ||
            rawDurations.audio ||
            mkvDurationVideo ||
            mkvDurationAudio ||
            null;

          console.log(
            `Probe ${file.name}: container=${formatName} v=${videoCodec} a=${audioCodec} duration=${durationSec}s`
          );
          jsonResponse(res, 200, { audioCodec, videoCodec, container: formatName, durationSec });
        } catch {
          if (ffErr) console.log(`Probe ${file.name}: ffprobe error — ${ffErr.slice(0, 200)}`);
          jsonResponse(res, 200, { durationSec: null });
        }
      });
      ff.on("error", (err) => {
        console.error(`Probe ${file.name}: spawn error — ${err.message}`);
        jsonResponse(res, 200, { durationSec: null });
      });
      return;
    }

    // GET /transcode/:infoHash — Live transcode x265→H.264 for TV playback
    if (req.method === "GET" && path.startsWith("/transcode/")) {
      const infoHash = path.split("/")[2];
      const torrent = getTorrent(infoHash);
      if (!torrent) return jsonResponse(res, 404, { error: "Torrent not found" });

      const fileParam = url.searchParams.get("file");
      const file = findVideoFile(torrent, fileParam);
      if (!file) return jsonResponse(res, 404, { error: "No video file found" });

      markActive(infoHash);

      // Use file path on disk — more reliable than piping through stdin
      const diskPath = join(CACHE_PATH, torrent.name, file.name);
      console.log(`Transcode ${file.name}: x265→H.264 from ${diskPath} peers=${torrent.numPeers} progress=${(torrent.progress * 100).toFixed(1)}%`);

      if (!existsSync(diskPath)) {
        return jsonResponse(res, 404, { error: "File not yet downloaded" });
      }

      // Transcode to a temp H.264 MP4 file on disk, then serve it as a static file.
      // This is the most compatible approach for old TV browsers.
      const transcodePath = join(CACHE_PATH, infoHash + "_h264.mp4");
      // Marker file — only written after ffmpeg exits cleanly. Without this, serving the
      // MP4 while ffmpeg is still writing it gives the browser a broken moov atom, which
      // makes video.duration Infinity/NaN and the TV progress bar unusable.
      const transcodeDonePath = transcodePath + ".done";

      // If already transcoded (marker present), serve directly
      if (existsSync(transcodeDonePath) && existsSync(transcodePath)) {
        console.log(`Serving pre-transcoded file: ${transcodePath}`);
        const stat = statSync(transcodePath);
        const fileSize = stat.size;

        let range = rangeParser(fileSize, req.headers.range || "");
        if (Array.isArray(range)) {
          range = range[0];
          res.writeHead(206, {
            "Content-Type": "video/mp4",
            "Content-Range": "bytes " + range.start + "-" + range.end + "/" + fileSize,
            "Content-Length": range.end - range.start + 1,
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
          });
            pump(fsCreateReadStream(transcodePath, { start: range.start, end: range.end }), res);
        } else {
          res.writeHead(200, {
            "Content-Type": "video/mp4",
            "Content-Length": fileSize,
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
          });
            pump(fsCreateReadStream(transcodePath), res);
        }
        return;
      }

      // If transcode is already in progress (file exists but no marker yet), don't respawn ffmpeg
      if (existsSync(transcodePath) && !existsSync(transcodeDonePath)) {
        return jsonResponse(res, 202, { status: "transcoding", message: "Transcoding in progress..." });
      }

      // Start transcoding in background
      console.log(`Starting transcode to ${transcodePath}...`);
      const ffmpeg = spawn("ffmpeg", [
        "-i", diskPath,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-loglevel", "warning",
        "-y",
        transcodePath,
      ]);

      ffmpeg.stderr.on("data", (d) => {
        const msg = d.toString().trim();
        if (msg) console.log(`FFmpeg: ${msg}`);
      });

      ffmpeg.on("exit", (code) => {
        if (code === 0) {
          console.log(`Transcode complete: ${transcodePath}`);
          try {
            writeFileSync(transcodeDonePath, String(Date.now()));
          } catch (err) {
            console.error("Failed to write transcode marker:", err);
          }
        } else {
          console.error(`FFmpeg exited with code ${code}`);
          // Clean up the partial file so the next request retries instead of serving garbage
          try { if (existsSync(transcodePath)) unlinkSync(transcodePath); } catch {}
        }
      });

      // Return immediately — tell the client to wait and retry
      jsonResponse(res, 202, { status: "transcoding", message: "Transcoding started. Reload in a minute." });

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
          // Strip ASS/SSA override codes like {\an8}, {\i1}, {\pos(x,y)} that leak from
          // dirty subtitle files. Keep the surrounding text intact.
          content = content.replace(/\{\\[^}]*\}/g, "");
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

    // GET /tv — TV-friendly library page (Chrome 38 compatible)
    if (req.method === "GET" && (path === "/tv" || path === "/tv/")) {
      var libraryItems = [];
      try {
        var libData = JSON.parse(readFileSync(LIBRARY_PATH, "utf-8"));
        libraryItems = libData.items || [];
      } catch (e) {}
      var port = server.address().port;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildTVPageHTML(libraryItems, port));
      return;
    }

    // GET /tv/play/:infoHash — TV video player page
    if (req.method === "GET" && path.startsWith("/tv/play/")) {
      var playHash = path.split("/")[3];
      var playTitle = url.searchParams.get("title") || "Video";
      var port = server.address().port;
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildTVPlayerHTML(playHash, decodeURIComponent(playTitle), port));
      return;
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

// Listen on all interfaces so TV/LAN clients can connect directly for streaming
// 10-hour socket timeout (same as WebTorrent's built-in server) — prevents TV connections from dropping
server.on("connection", (socket) => {
  socket.setTimeout(36000000);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log("Port 9191 in use, retrying in 2s...");
    setTimeout(() => server.listen(9191, "0.0.0.0"), 2000);
  } else {
    console.error("Server error:", err);
  }
});

server.listen(9191, "0.0.0.0", () => {
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
