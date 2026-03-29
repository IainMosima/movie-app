import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WebTorrent uses native modules that aren't compatible with Turbopack
  serverExternalPackages: [
    "webtorrent",
    "node-datachannel",
    "webrtc-polyfill",
    "@thaunknown/simple-peer",
  ],
};

export default nextConfig;
