#!/usr/bin/env node

/**
 * List files in a torrent magnet link (peerflix-style)
 * Usage: node list-files.mjs <magnet-link>
 */

import WebTorrent from "webtorrent";

const magnet = process.argv[2];

if (!magnet) {
  console.error("Usage: node list-files.mjs <magnet-link>");
  console.error("");
  console.error("Example:");
  console.error('  node list-files.mjs "magnet:?xt=urn:btih:..."');
  process.exit(1);
}

console.log("\nFetching torrent metadata...\n");

const client = new WebTorrent({
  maxConns: 40,
});

const timeout = setTimeout(() => {
  console.error("Timeout: Could not fetch metadata in 60 seconds");
  client.destroy();
  process.exit(1);
}, 60000);

client.add(magnet, (torrent) => {
  clearTimeout(timeout);

  console.log(`Torrent: ${torrent.name}`);
  console.log(`InfoHash: ${torrent.infoHash}`);
  console.log("");
  console.log("Files:");
  console.log("─".repeat(60));

  // Find largest video for highlighting
  let largestVideoIdx = -1;
  let largestVideoSize = 0;
  const videoExts = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv)$/i;

  torrent.files.forEach((file, index) => {
    if (videoExts.test(file.name) && file.length > largestVideoSize) {
      largestVideoSize = file.length;
      largestVideoIdx = index;
    }
  });

  torrent.files.forEach((file, index) => {
    const sizeMB = (file.length / (1024 * 1024)).toFixed(2);
    const sizeGB = (file.length / (1024 * 1024 * 1024)).toFixed(2);
    const sizeStr = file.length > 1024 * 1024 * 1024 ? `${sizeGB} GB` : `${sizeMB} MB`;
    const isMain = index === largestVideoIdx;
    const marker = isMain ? "★ " : "  ";
    const ext = file.name.split(".").pop()?.toUpperCase() || "";

    console.log(
      `${marker}[${index.toString().padStart(2)}] ${file.name}`
    );
    console.log(`      ${sizeStr.padStart(10)} │ ${ext}`);
  });

  console.log("");
  console.log("─".repeat(60));

  if (largestVideoIdx >= 0) {
    console.log(`\n★ Main video detected at index ${largestVideoIdx}`);
  }

  console.log("\nTo stream in the web app:");
  console.log(`  Open http://localhost:3000 and search/paste magnet`);
  console.log("");
  console.log("To stream via CLI (if webtorrent-cli installed):");
  console.log(`  webtorrent "${magnet}" --select ${largestVideoIdx >= 0 ? largestVideoIdx : 0} -o /tmp`);
  console.log("");

  client.destroy();
  process.exit(0);
});

client.on("error", (err) => {
  clearTimeout(timeout);
  console.error("Error:", err.message);
  client.destroy();
  process.exit(1);
});
