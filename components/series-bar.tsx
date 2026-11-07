"use client";

import { useState } from "react";
import { Download, Loader2, Pause, Play } from "lucide-react";
import { formatSpeed, type DownloadStatus } from "@/hooks/use-download-progress";

export interface SeriesEpisode {
  key: string;
  code: string; // "S01E04", or a short name when there's no code
  state: "watched" | "watching" | "unwatched";
  pct: number; // 0–100, for "watching"
  timeLeft?: string; // "22 min left", for "watching"
  updatedAt?: number; // when last watched, to find where you are
}

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Where you are in a series, at the top of a folder or season pack:
 * a segment per episode, Continue, download the next one, clear what's watched.
 */
export function SeriesBar({
  episodes,
  onPlay,
  next,
  watchedBytes,
  onClearWatched,
}: {
  episodes: SeriesEpisode[];
  onPlay: (key: string) => void;
  /** The episode after the one you're on, and its download controls. */
  next?: { key: string; code: string; status: DownloadStatus; onDownload: () => void; onTogglePause: () => void };
  watchedBytes: number;
  onClearWatched: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);
  if (episodes.length < 2) return null;

  // Where you are: the most recent half-watched episode, else the first unwatched.
  const watching = episodes
    .filter((e) => e.state === "watching")
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  const firstUnwatched = episodes.find((e) => e.state === "unwatched");
  const current = watching ?? firstUnwatched ?? episodes[0];
  const watchedCount = episodes.filter((e) => e.state === "watched").length;
  const allWatched = watchedCount === episodes.length;

  const action = watching ? "Continue" : allWatched ? "Watch again" : watchedCount > 0 ? "Up next" : "Start";
  const meta = watching
    ? watching.timeLeft
    : allWatched
      ? "Season finished"
      : `${watchedCount} of ${episodes.length} watched`;

  const clear = async () => {
    setClearing(true);
    try {
      await onClearWatched();
      setConfirming(false);
    } finally {
      setClearing(false);
    }
  };

  const s = next?.status;
  const nextActive = s && (s.state === "downloading" || s.state === "queued" || s.state === "starting");

  return (
    <section className="rounded-2xl bg-zinc-950/50 p-4" aria-label="Where you are in this series">
      {/* One segment per episode */}
      <div className="flex gap-[3px]" aria-hidden>
        {episodes.map((e) => (
          <div
            key={e.key}
            title={`${e.code}${e.state === "watched" ? " · watched" : e.state === "watching" ? ` · ${e.pct}%` : ""}`}
            className={`relative h-1.5 flex-1 overflow-hidden rounded-full ${
              e.state === "watched" ? "bg-zinc-300" : "bg-zinc-800"
            } ${e.key === current.key ? "outline outline-1 outline-offset-2 outline-zinc-500" : ""}`}
          >
            {e.state === "watching" && (
              <div className="absolute inset-y-0 left-0 bg-purple-500" style={{ width: `${Math.max(4, e.pct)}%` }} />
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-zinc-500">{action}</p>
          <p className="text-lg font-semibold text-zinc-100 tabular-nums">{current.code}</p>
          <p className="text-xs text-zinc-500">{meta}</p>
        </div>
        <button
          onClick={() => onPlay(current.key)}
          className={`h-12 shrink-0 rounded-full bg-purple-600 hover:bg-purple-500 active:scale-[0.98] px-5 flex items-center gap-2 text-sm font-medium text-white transition-[background-color,transform] motion-reduce:transition-none ${ring}`}
        >
          <Play className="h-4 w-4 fill-current" />
          {watching ? "Continue" : "Play"}
        </button>
      </div>

      {(next || watchedBytes > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-800/80 pt-3">
          {next && s && s.state !== "ready" && (
            <button
              onClick={() =>
                s.state === "downloading" || s.state === "queued" || s.state === "paused"
                  ? next.onTogglePause()
                  : next.onDownload()
              }
              disabled={s.state === "starting"}
              className={`h-10 rounded-full px-4 flex items-center gap-2 text-sm transition-colors ${
                nextActive || s.state === "paused"
                  ? "bg-purple-500/10 text-purple-200 hover:bg-purple-500/20"
                  : "bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700"
              } ${ring}`}
              title={nextActive ? "Pause" : s.state === "paused" ? "Resume" : `Download ${next.code} so it's ready`}
            >
              {s.state === "starting" ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : nextActive ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <span className="tabular-nums">
                {s.state === "downloading"
                  ? `${next.code} · ${Math.floor(s.progress * 100)}%${s.speed > 0 ? ` · ${formatSpeed(s.speed)}` : ""}`
                  : s.state === "queued"
                    ? `${next.code} · queued`
                    : s.state === "paused"
                      ? `${next.code} · paused ${Math.floor(s.progress * 100)}%`
                      : `Download ${next.code}`}
              </span>
            </button>
          )}
          {next && s?.state === "ready" && (
            <span className="h-10 rounded-full px-4 flex items-center text-sm text-emerald-300 bg-emerald-500/10">
              {next.code} ready
            </span>
          )}

          {watchedBytes > 0 &&
            (confirming ? (
              <span className="ml-auto flex items-center gap-2 text-sm" role="alert">
                <span className="text-zinc-300">Delete {formatBytes(watchedBytes)}?</span>
                <button
                  onClick={clear}
                  disabled={clearing}
                  className={`h-10 rounded-full px-4 bg-red-600 hover:bg-red-500 text-white flex items-center gap-2 disabled:opacity-60 ${ring}`}
                >
                  {clearing && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                  Delete
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={clearing}
                  className={`h-10 rounded-full px-3 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 ${ring}`}
                >
                  Keep
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className={`ml-auto h-10 rounded-full px-4 text-sm text-zinc-400 hover:text-red-300 hover:bg-zinc-800 ${ring}`}
              >
                Clear watched · {formatBytes(watchedBytes)}
              </button>
            ))}
        </div>
      )}
    </section>
  );
}
