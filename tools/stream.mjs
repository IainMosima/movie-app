#!/usr/bin/env node

/**
 * Stream a torrent file via HTTP (peerflix-style, with Range support)
 * Usage: node stream.mjs <magnet> [fileIndex] [port]
 *
 * Supports seeking via HTTP Range headers for proper video playback.
 */

import WebTorrent from "webtorrent";
import http from "http";
import { networkInterfaces } from "os";

const magnet = process.argv[2];
const fileIndex = Number(process.argv[3] || -1); // -1 = auto-detect largest video
const port = Number(process.argv[4] || 8000);

if (!magnet) {
  console.error("Usage: node stream.mjs <magnet> [fileIndex] [port]");
  console.error("");
  console.error("Arguments:");
  console.error("  magnet     - Magnet link (required)");
  console.error("  fileIndex  - File index to stream (default: largest video)");
  console.error("  port       - HTTP port (default: 8000)");
  console.error("");
  console.error("Example:");
  console.error('  node stream.mjs "magnet:?xt=urn:btih:..." 0 8000');
  console.error("");
  console.error("Tip: Run list-files.mjs first to see available files");
  process.exit(1);
}

function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

function getMimeType(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const types = {
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    webm: "video/webm",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    m4v: "video/mp4",
    wmv: "video/x-ms-wmv",
    flv: "video/x-flv",
  };
  return types[ext] || "application/octet-stream";
}

console.log("\nStarting torrent client...\n");

const client = new WebTorrent({
  maxConns: 55,
});

client.add(magnet, { path: "/tmp/stream-cache" }, (torrent) => {
  console.log(`Torrent: ${torrent.name}`);
  console.log(`InfoHash: ${torrent.infoHash}`);
  console.log(`Files: ${torrent.files.length}`);
  console.log("");

  // Find file to stream
  let file;
  const videoExts = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv)$/i;

  if (fileIndex >= 0 && fileIndex < torrent.files.length) {
    file = torrent.files[fileIndex];
  } else {
    // Auto-detect: find largest video file
    let maxSize = 0;
    torrent.files.forEach((f) => {
      if (videoExts.test(f.name) && f.length > maxSize) {
        maxSize = f.length;
        file = f;
      }
    });
  }

  if (!file) {
    console.error("No suitable video file found");
    console.error("Available files:");
    torrent.files.forEach((f, i) => {
      console.error(`  [${i}] ${f.name}`);
    });
    client.destroy();
    process.exit(1);
  }

  const mimeType = getMimeType(file.name);
  const localIP = getLocalIP();

  console.log(`Streaming: ${file.name}`);
  console.log(`Size: ${(file.length / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  console.log(`Type: ${mimeType}`);
  console.log("");

  const server = http.createServer((req, res) => {
    const range = req.headers.range;
    const fileSize = file.length;

    if (req.url === "/") {
      // Serve a simple HTML player page
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${file.name}</title>
          <style>
            body { margin: 0; background: #000; display: flex; align-items: center; justify-content: center; height: 100vh; }
            video { max-width: 100%; max-height: 100%; }
          </style>
        </head>
        <body>
          <video controls autoplay>
            <source src="/video" type="${mimeType}">
          </video>
        </body>
        </html>
      `);
      return;
    }

    if (req.url !== "/video") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    if (!range) {
      // No range requested - send full file (rare for video)
      console.log(`[${new Date().toISOString()}] Full request`);
      res.writeHead(200, {
        "Content-Type": mimeType,
        "Content-Length": fileSize,
        "Accept-Ranges": "bytes",
      });
      file.createReadStream().pipe(res);
      return;
    }

    // Parse Range header
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    console.log(
      `[${new Date().toISOString()}] Range: ${start}-${end} (${(chunkSize / 1024 / 1024).toFixed(1)} MB)`
    );

    res.writeHead(206, {
      "Content-Type": mimeType,
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Content-Length": chunkSize,
      "Accept-Ranges": "bytes",
    });

    file.createReadStream({ start, end }).pipe(res);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log("─".repeat(50));
    console.log("");
    console.log("Stream ready!");
    console.log("");
    console.log(`Local:   http://localhost:${port}`);
    console.log(`Network: http://${localIP}:${port}`);
    console.log("");
    console.log(`Direct video URL: http://${localIP}:${port}/video`);
    console.log("");
    console.log("─".repeat(50));
    console.log("");
    console.log("Press Ctrl+C to stop");
    console.log("");
  });

  // Progress logging
  let lastProgress = 0;
  torrent.on("download", () => {
    const progress = Math.round(torrent.progress * 100);
    if (progress !== lastProgress && progress % 5 === 0) {
      lastProgress = progress;
      console.log(
        `Download: ${progress}% │ ↓ ${(torrent.downloadSpeed / 1024 / 1024).toFixed(1)} MB/s │ Peers: ${torrent.numPeers}`
      );
    }
  });
});

client.on("error", (err) => {
  console.error("Error:", err.message);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  client.destroy(() => {
    console.log("Done");
    process.exit(0);
  });
});
