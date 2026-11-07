"use client";

import { useState, useEffect, useRef } from "react";
import {
  Film,
  FileText,
  File,
  Play,
  Loader2,
  HardDrive,
  Star,
  Users,
  Wifi,
  ChevronUp,
  ChevronDown,
  Eraser,
  Download,
  Pause,
  MonitorPlay,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { sortByEpisode, episodeCode, showName } from "@/lib/episode-order";
import {
  useDownloadProgress,
  formatSpeed,
  FLOOR_BYTES,
  type DownloadStatus,
  type DownloadTarget,
} from "@/hooks/use-download-progress";
import { ScrollPager } from "@/components/scroll-pager";
import { SeriesBar, type SeriesEpisode } from "@/components/series-bar";
import { progressPct, timeLeft } from "@/hooks/use-watch-progress";
import type { WatchRecord } from "@/types";

interface TorrentFile {
  index: number;
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  isVideo: boolean;
  extension: string;
  cachedBytes: number;
  cachedFormatted: string;
}

interface TorrentStatus {
  status: "not_found" | "connecting" | "ready";
  name?: string;
  peers?: number;
  ready?: boolean;
  files?: number;
}

interface FilePickerProps {
  open: boolean;
  onClose: () => void;
  magnet: string;
  title: string;
  onSelectFile: (infoHash: string, fileIndex: number, fileName: string) => void;
  onVLC?: (infoHash: string, fileIndex: number, fileName: string) => void;
}

export function FilePicker({
  open,
  onClose,
  magnet,
  title,
  onSelectFile,
  onVLC,
}: FilePickerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torrentName, setTorrentName] = useState("");
  const [infoHash, setInfoHash] = useState("");
  const [files, setFiles] = useState<TorrentFile[]>([]);
  const [mainVideoIndex, setMainVideoIndex] = useState<number | null>(null);
  const [clearingIndex, setClearingIndex] = useState<number | null>(null);
  const [cachedTotal, setCachedTotal] = useState({ bytes: 0, formatted: "0 B" });
  const [isClearingAll, setIsClearingAll] = useState(false);

  // Status polling
  const [status, setStatus] = useState<TorrentStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState("Starting...");
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (open && magnet) {
      fetchFiles();
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [open, magnet]);

  const pollStatus = () => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/torrent/status?magnet=${encodeURIComponent(magnet)}`
        );
        if (res.ok) {
          const data: TorrentStatus = await res.json();
          setStatus(data);

          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);

          if (data.status === "connecting") {
            if (data.peers && data.peers > 0) {
              setStatusMessage(
                `Connected to ${data.peers} peer${data.peers > 1 ? "s" : ""}... (${elapsed}s)`
              );
            } else {
              setStatusMessage(`Searching for peers... (${elapsed}s)`);
            }
          } else if (data.status === "ready") {
            setStatusMessage("Loading file list...");
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 1000);
  };

  const fetchFiles = async () => {
    setIsLoading(true);
    setError(null);
    setFiles([]);
    setStatus(null);
    setStatusMessage("Connecting to peers...");
    startTimeRef.current = Date.now();

    // Start status polling
    pollStatus();

    try {
      const res = await fetch("/api/torrent/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet }),
      });

      // Stop polling
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch files");
      }

      const data = await res.json();
      setTorrentName(data.name);
      setInfoHash(data.infoHash);
      setFiles(data.files);
      setMainVideoIndex(data.mainVideoIndex);
      setCachedTotal({
        bytes: data.cachedTotalBytes ?? 0,
        formatted: data.cachedTotalFormatted ?? "0 B",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch files");
    } finally {
      setIsLoading(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    }
  };

  // Re-read on-disk sizes after a clear. The torrent is already active at this
  // point, so this returns immediately — no loading spinner needed.
  const refreshSizes = async () => {
    try {
      const res = await fetch("/api/torrent/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setFiles(data.files);
      setCachedTotal({
        bytes: data.cachedTotalBytes ?? 0,
        formatted: data.cachedTotalFormatted ?? "0 B",
      });
    } catch {
      // Leave the last known sizes on screen
    }
  };

  const handlePlay = (fileIndex: number) => {
    if (infoHash) {
      // Look up by the torrent's own index, not by array position. They happen
      // to coincide today because the server emits files in index order, but
      // any reordering server-side would silently play the wrong file.
      const file = files.find((f) => f.index === fileIndex);
      onSelectFile(infoHash, fileIndex, file?.name || "video");
    }
  };

  const clearFile = async (file: TorrentFile) => {
    await fetch(
      `/api/torrent/${infoHash}/file/${file.index}/cache?path=${encodeURIComponent(file.path)}`,
      { method: "DELETE" }
    );
  };

  const handleClear = async (e: React.MouseEvent, file: TorrentFile) => {
    e.stopPropagation();
    if (!infoHash) return;
    setClearingIndex(file.index);
    try {
      await clearFile(file);
      await refreshSizes();
      await downloads.refresh();
    } finally {
      setClearingIndex(null);
    }
  };

  const handleClearAll = async () => {
    if (!infoHash) return;
    const cached = files.filter((f) => f.cachedBytes > 0);
    if (cached.length === 0) return;
    if (
      !window.confirm(
        `Clear ${cachedTotal.formatted} of cached bytes for "${torrentName}"? It re-downloads on next play.`
      )
    )
      return;

    setIsClearingAll(true);
    try {
      for (const file of cached) {
        await clearFile(file);
      }
      await refreshSizes();
    } finally {
      setIsClearingAll(false);
    }
  };

  const getFileIcon = (file: TorrentFile) => {
    if (file.isVideo) return Film;
    if (
      file.extension === "srt" ||
      file.extension === "sub" ||
      file.extension === "ass"
    )
      return FileText;
    return File;
  };

  // Torrent file order is not episode order — a pack in the library lists
  // E06, E02, E07, E01, ... — so sort on the parsed episode number.
  const videoFiles = sortByEpisode(
    files.filter((f) => f.isVideo),
    (f) => f.name
  );
  const otherFiles = files.filter((f) => !f.isVideo);

  const rowOf = (f: TorrentFile) => ({ id: String(f.index), infoHash, fileIndex: f.index });
  const downloads = useDownloadProgress(open && !!infoHash, videoFiles.map(rowOf));
  const targetOf = (f: TorrentFile): DownloadTarget => {
    const code = episodeCode(f.name);
    return {
      magnet,
      infoHash,
      fileIndex: f.index,
      title: code ? `${showName(torrentName || title)} · ${code}` : f.name,
      size: f.size,
    };
  };
  // The series strip reads this pack's watch history (one record per episode).
  const [watch, setWatch] = useState<Record<number, WatchRecord>>({});
  useEffect(() => {
    if (!open || !infoHash) return;
    let alive = true;
    fetch("/api/progress")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { history?: WatchRecord[] } | null) => {
        if (!alive || !d?.history) return;
        const mine: Record<number, WatchRecord> = {};
        for (const r of d.history) if (r.infoHash.toLowerCase() === infoHash.toLowerCase()) mine[r.fileIndex] = r;
        setWatch(mine);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, infoHash]);

  const seriesEpisodes: SeriesEpisode[] = videoFiles.map((f) => {
    const r = watch[f.index];
    const state = !r ? "unwatched" : r.finished ? "watched" : "watching";
    return {
      key: String(f.index),
      code: episodeCode(f.name) ?? f.name,
      state,
      pct: r ? progressPct(r) : 0,
      timeLeft: r && !r.finished ? timeLeft(r) : undefined,
      updatedAt: r?.updatedAt,
    };
  });
  const seriesCurrent = (() => {
    const w = seriesEpisodes
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => e.state === "watching")
      .sort((a, b) => (b.e.updatedAt ?? 0) - (a.e.updatedAt ?? 0))[0];
    if (w) return w.idx;
    const first = seriesEpisodes.findIndex((e) => e.state === "unwatched");
    return first < 0 ? 0 : first;
  })();
  const nextFile = videoFiles[seriesCurrent + 1];
  const watchedOnDisk = videoFiles.filter((f) => watch[f.index]?.finished && f.cachedBytes > 0);

  // "Download ahead" runs past the last episode that is on disk or pinned.
  const lastHeld = videoFiles.reduce(
    (at, f, i) => (f.cachedBytes > 0 || downloads.status(rowOf(f)).state !== "idle" ? i : at),
    -1
  );
  const ahead = videoFiles.slice(lastHeld + 1).map((f) => ({
    rowId: String(f.index),
    label: episodeCode(f.name) ?? f.name,
    target: targetOf(f),
    status: downloads.status(rowOf(f)),
    size: f.size,
  }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-[calc(100%-1.5rem)] sm:max-w-2xl h-[88vh] sm:h-[85vh] flex flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="pr-8 truncate">{title}</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="relative">
              <Loader2 className="h-10 w-10 animate-spin text-purple-500" />
              {status?.peers !== undefined && status.peers > 0 && (
                <div className="absolute -top-1 -right-1 bg-green-500 text-white text-[10px] rounded-full h-5 w-5 flex items-center justify-center font-bold">
                  {status.peers}
                </div>
              )}
            </div>

            <div className="text-center">
              <p className="text-sm text-zinc-300 mb-1">{statusMessage}</p>
              <p className="text-xs text-zinc-600">
                This can take up to a minute for rare torrents
              </p>
            </div>

            {/* Connection indicator */}
            <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
              <span className="flex items-center gap-1">
                <Wifi
                  className={cn(
                    "h-3.5 w-3.5",
                    status?.peers && status.peers > 0
                      ? "text-green-500"
                      : "text-zinc-600"
                  )}
                />
                {status?.peers || 0} peers
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="mt-4 text-zinc-500"
            >
              Cancel
            </Button>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-red-400">{error}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onClose}
                className="border-zinc-700"
              >
                Cancel
              </Button>
              <Button variant="outline" onClick={fetchFiles} className="border-zinc-700">
                Try Again
              </Button>
            </div>
          </div>
        )}

        {!isLoading && !error && files.length > 0 && (
          <>
            {/* Torrent name + what it currently costs on disk */}
            <div className="px-1 pb-2 border-b border-zinc-800">
              <p className="text-sm text-zinc-400 truncate">
                <HardDrive className="h-3.5 w-3.5 inline mr-1.5" />
                {torrentName}
              </p>
              <div className="flex items-center justify-between gap-2 flex-wrap mt-1">
                <p className="text-xs text-zinc-600">
                  {files.length} file{files.length !== 1 ? "s" : ""} •{" "}
                  {videoFiles.length} video{videoFiles.length !== 1 ? "s" : ""} •{" "}
                  <span className={cachedTotal.bytes > 0 ? "text-amber-500/90" : ""}>
                    {cachedTotal.formatted} on disk
                  </span>
                </p>
                {cachedTotal.bytes > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleClearAll}
                    disabled={isClearingAll || clearingIndex !== null}
                    className="shrink-0 h-7 border-amber-900/60 text-amber-300 hover:bg-amber-950/40 hover:text-amber-200"
                  >
                    {isClearingAll ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    ) : (
                      <Eraser className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    Clear all
                  </Button>
                )}
              </div>
              <DownloadAhead episodes={ahead} free={downloads.free} onStart={downloads.startMany} />
            </div>

            <SeriesBar
              episodes={seriesEpisodes}
              onPlay={(key) => handlePlay(Number(key))}
              next={
                nextFile
                  ? {
                      key: String(nextFile.index),
                      code: episodeCode(nextFile.name) ?? nextFile.name,
                      status: downloads.status(rowOf(nextFile)),
                      onDownload: () => downloads.start(String(nextFile.index), targetOf(nextFile)),
                      onTogglePause: () => downloads.togglePause(rowOf(nextFile)),
                    }
                  : undefined
              }
              watchedBytes={watchedOnDisk.reduce((n, f) => n + f.cachedBytes, 0)}
              onClearWatched={async () => {
                for (const f of watchedOnDisk) {
                  await fetch(
                    `/api/torrent/${infoHash}/file/${f.index}/cache?path=${encodeURIComponent(f.path)}`,
                    { method: "DELETE" }
                  ).catch(() => {});
                }
                await fetchFiles();
                await downloads.refresh();
              }}
            />

            {/* Scroll container with TV-friendly buttons */}
            <ScrollPager className="scrollbar-visible -mr-6 pr-6">
              <div className="space-y-4 py-2 pl-1 pr-2">
                {/* Video files */}
                {videoFiles.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-zinc-500 mb-3 uppercase tracking-wider">
                      Video Files
                    </h3>
                    <div className="space-y-2">
                      {videoFiles.map((file) => {
                        const Icon = getFileIcon(file);
                        const isMain = file.index === mainVideoIndex;
                        const isClearing = clearingIndex === file.index;
                        const code = episodeCode(file.name);
                        const dl = downloads.status(rowOf(file));
                        const dlActive = dl.state === "starting" || dl.state === "queued" || dl.state === "downloading";

                        return (
                          <div
                            key={file.index}
                            className="group relative overflow-hidden flex flex-col sm:flex-row sm:items-center sm:gap-2 rounded-xl border-2 border-transparent hover:border-purple-600 transition-colors"
                          >
                            <button
                              onClick={() => handlePlay(file.index)}
                              className="flex flex-1 items-center gap-3 sm:gap-4 p-3 pb-1 sm:p-4 text-left hover:bg-purple-600/20 focus:bg-purple-600/20 focus:outline-none rounded-xl min-w-0 w-full"
                            >
                              <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl flex items-center justify-center shrink-0 bg-zinc-800 group-hover:bg-purple-600 transition-colors">
                                <Icon className="h-5 w-5 sm:h-6 sm:w-6" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm sm:text-base text-zinc-200 truncate font-medium">
                                  {code ?? file.name}
                                </p>
                                {code && (
                                  <p className="text-[11px] text-zinc-600 truncate">
                                    {file.name}
                                  </p>
                                )}
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  <span className="text-sm text-zinc-500">
                                    {file.sizeFormatted}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className="text-xs uppercase border-zinc-700"
                                  >
                                    {file.extension}
                                  </Badge>
                                  {file.cachedBytes > 0 && (
                                    <span className="text-xs text-amber-500/90">
                                      {file.cachedFormatted} on disk
                                    </span>
                                  )}
                                  {isMain && (
                                    <span className="flex items-center gap-1 text-xs text-amber-500">
                                      <Star className="h-3.5 w-3.5 fill-current" />
                                      Main
                                    </span>
                                  )}
                                </div>
                              </div>
                              <Play className="hidden sm:block h-6 w-6 text-zinc-600 group-hover:text-purple-400 shrink-0 transition-colors" />
                            </button>
                            {/* Phone: actions on their own line so the name keeps the full width */}
                            <div className="flex items-center justify-end gap-1 px-2 pb-1 sm:p-0 sm:contents">
                            <DownloadStateLabel s={dl} className="shrink min-w-0 px-1 mr-auto sm:mr-0" />
                            {dl.state !== "ready" && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (dl.state === "downloading" || dl.state === "queued" || dl.state === "paused")
                                    downloads.togglePause(rowOf(file));
                                  else downloads.start(String(file.index), targetOf(file));
                                }}
                                disabled={dl.state === "starting"}
                                className={cn(
                                  "shrink-0 h-11 w-11 flex items-center justify-center rounded-lg hover:bg-purple-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-30 transition-colors",
                                  dlActive || dl.state === "paused" ? "text-purple-300" : "text-zinc-500 hover:text-purple-300"
                                )}
                                title={
                                  dl.state === "paused"
                                    ? "Resume download"
                                    : dl.state === "downloading" || dl.state === "queued"
                                      ? "Pause download"
                                      : "Download in the background so it's ready to watch"
                                }
                                aria-label={`${
                                  dl.state === "paused" ? "Resume" : dl.state === "downloading" || dl.state === "queued" ? "Pause" : "Download"
                                } ${code ?? file.name}`}
                              >
                                {dl.state === "starting" ? (
                                  <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
                                ) : dl.state === "downloading" || dl.state === "queued" ? (
                                  <Pause className="h-4 w-4" />
                                ) : dl.state === "paused" ? (
                                  <Play className="h-4 w-4 fill-current" />
                                ) : (
                                  <Download className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            {onVLC && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onVLC(infoHash, file.index, file.name);
                                }}
                                disabled={!infoHash}
                                className="shrink-0 h-11 w-11 flex items-center justify-center rounded-lg text-zinc-500 hover:text-purple-300 hover:bg-purple-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 disabled:opacity-30 transition-colors"
                                title="Copy VLC link"
                                aria-label="Copy VLC link"
                              >
                                <MonitorPlay className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={(e) => handleClear(e, file)}
                              disabled={isClearing || isClearingAll || file.cachedBytes === 0}
                              className="shrink-0 h-11 w-11 flex items-center justify-center rounded-lg text-zinc-500 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-30 disabled:hover:text-zinc-500 disabled:hover:bg-transparent transition-colors mr-1 sm:mr-2"
                              title={
                                file.cachedBytes > 0
                                  ? `Clear ${file.cachedFormatted} of cached bytes (re-downloads on next play)`
                                  : "Nothing cached for this episode"
                              }
                            >
                              {isClearing ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Eraser className="h-4 w-4" />
                              )}
                            </button>
                            </div>
                            <DownloadBar s={dl} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Other files */}
                {otherFiles.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-zinc-500 mb-2 uppercase tracking-wider">
                      Other Files
                    </h3>
                    <div className="space-y-1">
                      {otherFiles.map((file) => {
                        const Icon = getFileIcon(file);
                        return (
                          <div
                            key={file.index}
                            className="flex items-center gap-3 p-2 rounded-lg text-zinc-500"
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="text-xs truncate flex-1">
                              {file.name}
                            </span>
                            <span className="text-xs shrink-0">
                              {file.sizeFormatted}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </ScrollPager>

            {/* Actions */}
            <div className="flex justify-end pt-4 border-t border-zinc-800">
              <Button variant="ghost" onClick={onClose} size="lg" className="px-6">
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const fmtBytes = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`;

/** Inline row state: Starting… / Queued / ↓ 43% · 2.1 MB/s / ✓ Ready / error. */
export function DownloadStateLabel({ s, className }: { s: DownloadStatus; className?: string }) {
  const base = cn("inline-flex items-center gap-1 text-xs tabular-nums", className);
  switch (s.state) {
    case "starting":
      return (
        <span className={cn(base, "text-zinc-300")} role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          Starting…
        </span>
      );
    case "queued":
      return (
        <span className={cn(base, "text-zinc-500")} role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          Queued
        </span>
      );
    case "downloading":
      return (
        <span className={cn(base, "text-purple-300")}>
          ↓ {Math.floor(s.progress * 100)}%{s.speed > 0 && ` · ${formatSpeed(s.speed)}`}
        </span>
      );
    case "paused":
      return (
        <span className={cn(base, "text-zinc-400")}>
          Paused · {Math.floor(s.progress * 100)}%
        </span>
      );
    case "ready":
      return <span className={cn(base, "text-emerald-300")}>✓ Ready</span>;
    case "error":
      return <span className={cn(base, "text-red-300")}>{s.message || "Download failed"}</span>;
    default:
      return null;
  }
}

/** Thin progress line along the bottom of a `relative overflow-hidden` row. */
export function DownloadBar({ s }: { s: DownloadStatus }) {
  if (s.state !== "downloading") return null;
  return (
    <div className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-800" aria-hidden>
      <div className="h-full bg-purple-500 transition-[width] duration-700" style={{ width: `${Math.max(1, s.progress * 100)}%` }} />
    </div>
  );
}

export interface AheadEpisode {
  rowId: string;
  label: string;
  target: DownloadTarget;
  status: DownloadStatus;
  /** Full file size in bytes, when known. */
  size?: number;
}

/**
 * "Download ahead through: [S01E05 ▾]". `episodes` starts at the next
 * unwatched one; the options are the ones after it, the range always includes it.
 */
export function DownloadAhead({
  episodes,
  free,
  onStart,
}: {
  episodes: AheadEpisode[];
  free: number | null;
  onStart: (items: { rowId: string; target: DownloadTarget }[]) => Promise<void>;
}) {
  const [through, setThrough] = useState(1);
  const [busy, setBusy] = useState(false);
  if (episodes.length < 2) return null;
  const last = Math.min(through, episodes.length - 1);

  // Only what isn't ready or already on its way.
  const todo = episodes.slice(0, last + 1).filter((e) => e.status.state === "idle" || e.status.state === "error");
  const known = todo.filter((e) => e.size);
  const unknown = todo.length - known.length;
  const total = known.reduce((sum, e) => sum + e.size! * (1 - e.status.progress), 0);
  const room = free === null ? null : free - FLOOR_BYTES;
  const fits = room === null || total <= room;

  const go = async () => {
    setBusy(true);
    try {
      await onStart(todo.map(({ rowId, target }) => ({ rowId, target })));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
      <label className="flex items-center gap-2 text-sm text-zinc-400">
        <span className="shrink-0">Download ahead through</span>
        <select
          value={last}
          onChange={(e) => setThrough(Number(e.target.value))}
          className="h-11 min-w-0 rounded-lg border border-zinc-700 bg-zinc-800 px-3 text-sm text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
        >
          {episodes.slice(1).map((e, i) => (
            <option key={e.rowId} value={i + 1}>
              {e.label}
            </option>
          ))}
        </select>
      </label>
      <span className={cn("text-xs tabular-nums", fits ? "text-zinc-500" : "text-red-300")}>
        {todo.length === 0
          ? "All on their way"
          : `${fmtBytes(total)}${unknown ? ` + ${unknown} unknown` : ""} · ${
              fits ? "Fits" : `Needs ${fmtBytes(total - room!)} more space`
            }`}
      </span>
      <Button
        onClick={go}
        disabled={busy || !fits || todo.length === 0}
        variant="outline"
        className="h-11 border-zinc-700 focus-visible:ring-2 focus-visible:ring-purple-400"
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        Download {todo.length} episode{todo.length !== 1 ? "s" : ""}
      </Button>
    </div>
  );
}
