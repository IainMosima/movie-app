import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // WebTorrent uses native modules that aren't compatible with Turbopack
  // Server components can use them but we need to configure external packages
  serverExternalPackages: [
    "webtorrent",
    "node-datachannel",
    "webrtc-polyfill",
    "@thaunknown/simple-peer",
  ],
  experimental: {
    // Disable Turbopack for builds since WebTorrent native modules aren't compatible
  },
};

export default nextConfig;
