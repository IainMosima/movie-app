"use client";

import { useSyncExternalStore } from "react";
import { Wifi } from "lucide-react";
import { copyText, useLanOrigin } from "@/hooks/use-vlc-copy";

/**
 * Top-bar chip, only when the app is open on localhost: shows the Wi-Fi
 * address phones and TVs use, and one tap copies it.
 */
export function LanAddress() {
  const origin = useLanOrigin();
  // Browser-only fact; false while rendering on the server so hydration matches.
  const local = useSyncExternalStore(
    () => () => {},
    () => /^(localhost|127\.|\[?::1\]?$)/.test(window.location.hostname),
    () => false
  );

  if (!local || !origin) return null;
  const host = origin.replace(/^https?:\/\//, "");

  return (
    <button
      onClick={() => copyText(origin, `Copied ${host}`)}
      className="h-10 flex items-center gap-2 rounded-full px-3 text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
      aria-label={`Copy Wi-Fi address ${host}`}
      title="Copy the address for your phone or TV"
    >
      <Wifi className="h-4 w-4" />
      <span className="text-xs tabular-nums">{host}</span>
    </button>
  );
}
