"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Download, Loader2, MonitorPlay, Pause, Play, Trash2 } from "lucide-react";
import type { StorageEntry, StorageFile } from "@/types";
import { episodeCode, showName } from "@/lib/episode-order";

/** A file on disk, or a whole folder that holds no playable file. */
type DiskFile = StorageFile & { folder?: boolean };
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatSpeed, type DownloadEntry } from "@/hooks/use-download-progress";
import { useVlcCopy } from "@/hooks/use-vlc-copy";
import { watchUrl } from "@/lib/watch-url";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function timeLeft(d: DownloadEntry): string | null {
  if (d.state !== "downloading" || d.speed <= 0 || !d.size) return null;
  const secs = (d.size * (1 - d.progress)) / d.speed;
  // Right after a (re)start the speed is a trickle and the estimate is noise.
  if (!Number.isFinite(secs) || secs > 48 * 3600) return null;
  if (secs < 90) return "under 2 min left";
  if (secs < 5400) return `${Math.round(secs / 60)} min left`;
  return `${(secs / 3600).toFixed(1)} h left`;
}

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400";
const iconBtn = `h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 transition-colors ${ring}`;

/**
 * Play, inside a ring that fills with the download: purple while it's coming
 * in, grey when paused, green when the whole episode is on disk.
 */
function PlayRing({
  d,
  disabled,
  onClick,
}: {
  d: Pick<DownloadEntry, "title" | "progress" | "state">;
  disabled: boolean;
  onClick: () => void;
}) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const p = Math.min(1, Math.max(0, d.progress));
  const color =
    d.state === "ready" ? "#6ee7b7" : d.state === "downloading" ? "#a78bfa" : d.state === "error" ? "#fca5a5" : "#71717a";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 transition-colors ${ring}`}
      aria-label={`Play ${d.title} (${Math.floor(p * 100)}% downloaded)`}
      title={`Play · ${Math.floor(p * 100)}% downloaded`}
    >
      <svg viewBox="0 0 44 44" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="22" cy="22" r={r} fill="none" stroke="#27272a" strokeWidth="3" />
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          className="transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
        />
      </svg>
      <Play className="relative h-4 w-4 fill-current translate-x-[1px]" />
    </button>
  );
}

const STATE_TEXT: Record<DownloadEntry["state"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  paused: "Paused",
  ready: "Ready to watch",
  error: "Problem",
};

/**
 * Everything you pressed Download on: live progress, pause/resume, cancel.
 * Opened from the storage line on the home page.
 */
export function DownloadsDialog({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const copyVlc = useVlcCopy();
  // Everything else taking space, watched first: quick storage clean-up.
  const [disk, setDisk] = useState<StorageEntry[]>([]);
  const [confirmDisk, setConfirmDisk] = useState<string | null>(null);

  const loadDisk = useCallback(async () => {
    try {
      const res = await fetch("/api/storage");
      if (!res.ok) return;
      const report: { entries?: StorageEntry[] } = await res.json();
      setDisk(
        (report.entries ?? [])
          .filter((e) => (e.kind === "matched" || e.kind === "orphan") && e.sizeBytes > 0)
          .sort((a, b) => Number(!!b.watched) - Number(!!a.watched) || b.sizeBytes - a.sizeBytes)
      );
    } catch {
      // keep what's on screen
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    loadDisk();
    const t = setInterval(loadDisk, 10000);
    return () => clearInterval(t);
  }, [open, loadDisk]);

  const deleteFiles = async (files: DiskFile[]) => {
    setBusy("disk");
    let freed = 0;
    try {
      for (const f of files) {
        const res = f.folder
          ? await fetch("/api/storage", {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ folder: f.rel }),
            })
          : f.infoHash && f.fileIndex !== undefined
            ? await fetch(
                `/api/torrent/${f.infoHash}/file/${f.fileIndex}/cache?path=${encodeURIComponent(f.rel)}`,
                { method: "DELETE" }
              )
            : await fetch("/api/storage", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: f.rel }),
              });
        if (res.ok) freed += f.sizeBytes;
      }
      toast.success(freed > 0 ? `Freed ${formatBytes(freed)}` : "Nothing was deleted");
      setConfirmDisk(null);
      await Promise.all([loadDisk(), load()]);
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };
  const router = useRouter();

  // The torrent may not be loaded (paused, or after a restart): add it first,
  // the same way Resume does on the home page, then open the player.
  const play = async (d: Pick<DownloadEntry, "id" | "infoHash" | "fileIndex" | "title" | "magnet">) => {
    setBusy(d.id);
    try {
      const res = await fetch("/api/torrent/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet: d.magnet || `magnet:?xt=urn:btih:${d.infoHash}` }),
      });
      if (!res.ok) throw new Error();
      onOpenChange(false);
      router.push(watchUrl(d.infoHash, d.title, d.fileIndex, "/"));
    } catch {
      toast.error("Couldn't open the player — try again");
      setBusy(null);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/downloads");
      if (res.ok) setDownloads(((await res.json()).downloads ?? []) as DownloadEntry[]);
    } catch {
      // keep what's on screen
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [open, load]);

  const act = async (d: DownloadEntry, action: "pause" | "resume") => {
    setBusy(d.id);
    try {
      const res = await fetch("/api/downloads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.message || `Couldn't ${action}`);
      }
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  // Cancel = stop and delete what's been downloaded so far.
  const cancel = async (d: DownloadEntry) => {
    setBusy(d.id);
    try {
      await fetch(`/api/torrent/${d.infoHash}/file/${d.fileIndex}/cache`, { method: "DELETE" });
      await fetch(`/api/downloads?id=${encodeURIComponent(d.id)}`, { method: "DELETE" });
      toast.success(`Cancelled ${d.title}`);
      setCancelling(null);
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  const order: Record<DownloadEntry["state"], number> = {
    downloading: 0,
    queued: 1,
    paused: 2,
    error: 3,
    ready: 4,
  };
  const sorted = [...downloads].sort((a, b) => order[a.state] - order[b.state]);

  // On disk, per episode — minus anything already in the Downloads list above.
  const inDownloads = new Set(downloads.map((d) => d.id));
  const shows = disk
    .map((e) => ({
      key: e.name,
      title: showName(e.itemName ?? e.name),
      orphan: e.kind === "orphan",
      // No playable file inside (partial pieces, extras) but still using space:
      // offer the whole folder as one row.
      files: (e.files && e.files.length > 0
        ? (e.files as DiskFile[])
        : [{ rel: e.name, name: e.itemName ?? e.name, sizeBytes: e.sizeBytes, sizeFormatted: e.sizeFormatted, folder: true } as DiskFile]
      )
        .filter((f) => !(f.infoHash && f.fileIndex !== undefined && inDownloads.has(`${f.infoHash}:${f.fileIndex}`)))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }))
    .filter((s) => s.files.length > 0);
  const watchedFiles = shows.flatMap((s) => s.files.filter((f) => f.watched));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-[calc(100%-1.5rem)] sm:max-w-xl max-h-[85vh] flex flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="text-lg">Downloads &amp; storage</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2">
          {!loaded && (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-zinc-500 motion-reduce:animate-none" />
            </div>
          )}
          {loaded && sorted.length === 0 && (
            <p className="py-10 text-center text-sm text-zinc-500">
              Nothing downloading. Use the download button on any episode to get it ready ahead of time.
            </p>
          )}
          {sorted.map((d) => {
            const pct = Math.floor(d.progress * 100);
            const isBusy = busy === d.id;
            const eta = timeLeft(d);
            return (
              <div key={d.id} className="relative overflow-hidden rounded-xl bg-zinc-950/60 p-3 sm:p-4">
                <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm sm:text-base text-zinc-100 line-clamp-2" title={d.title}>
                      {d.title}
                    </p>
                    <p className="mt-1 text-xs tabular-nums text-zinc-500">
                      <span
                        className={
                          d.state === "downloading"
                            ? "text-purple-300"
                            : d.state === "ready"
                              ? "text-emerald-300"
                              : d.state === "error"
                                ? "text-red-300"
                                : "text-zinc-400"
                        }
                      >
                        {d.state === "error" && d.message ? d.message : STATE_TEXT[d.state]}
                      </span>
                      {d.state !== "ready" && ` · ${pct}%`}
                      {d.size > 0 && ` · ${formatBytes(d.size * Math.min(1, d.progress))} of ${formatBytes(d.size)}`}
                      {d.state === "downloading" && d.speed > 0 && ` · ${formatSpeed(d.speed)}`}
                      {eta && ` · ${eta}`}
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-1 -mr-1 sm:mr-0">
                    {isBusy && <Loader2 className="h-4 w-4 animate-spin text-zinc-500 motion-reduce:animate-none" />}
                    <PlayRing d={d} disabled={isBusy} onClick={() => play(d)} />
                    <button
                      onClick={() => copyVlc(d.infoHash, d.fileIndex, d.title)}
                      className={iconBtn}
                      aria-label={`Copy VLC link for ${d.title}`}
                      title="Copy VLC link"
                    >
                      <MonitorPlay className="h-4 w-4" />
                    </button>
                    {(d.state === "downloading" || d.state === "queued" || d.state === "error") && (
                      <button
                        onClick={() => act(d, "pause")}
                        disabled={isBusy}
                        className={iconBtn}
                        aria-label={`Pause ${d.title}`}
                        title="Pause"
                      >
                        <Pause className="h-4 w-4" />
                      </button>
                    )}
                    {d.state === "paused" && (
                      <button
                        onClick={() => act(d, "resume")}
                        disabled={isBusy}
                        className={`${iconBtn} text-purple-300`}
                        aria-label={`Resume ${d.title}`}
                        title="Resume download"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setCancelling(d.id)}
                      disabled={isBusy}
                      className={`${iconBtn} hover:text-red-300`}
                      aria-label={`Delete ${d.title}`}
                      title={d.state === "ready" ? "Delete from disk" : "Stop and delete"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {cancelling === d.id && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" role="alert">
                    <span className="mr-auto text-zinc-300">
                      {d.state === "ready"
                        ? `Delete this episode from disk? Frees ${formatBytes(d.size)}.`
                        : "Stop and delete what\u2019s downloaded?"}
                    </span>
                    <button
                      onClick={() => cancel(d)}
                      disabled={isBusy}
                      className={`h-10 rounded-lg px-4 bg-red-600 hover:bg-red-500 text-white text-sm disabled:opacity-60 ${ring}`}
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setCancelling(null)}
                      disabled={isBusy}
                      className={`h-10 rounded-lg px-3 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 ${ring}`}
                    >
                      Keep
                    </button>
                  </div>
                )}

                {d.state !== "ready" && (
                  <div className="absolute inset-x-0 bottom-0 h-0.5 bg-zinc-800" aria-hidden>
                    <div
                      className={`h-full transition-[width] duration-700 motion-reduce:transition-none ${
                        d.state === "downloading" ? "bg-purple-500" : "bg-zinc-600"
                      }`}
                      style={{ width: `${Math.max(1, pct)}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {shows.length > 0 && (
            <div className="pt-5">
              <div className="mb-2 flex min-h-9 items-center gap-2">
                <h3 className="mr-auto text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  On disk
                </h3>
                {watchedFiles.length > 0 &&
                  (confirmDisk === "watched" ? (
                    <>
                      <span className="text-xs text-zinc-300">
                        Delete {formatBytes(watchedFiles.reduce((n, f) => n + f.sizeBytes, 0))}?
                      </span>
                      <button
                        onClick={() => deleteFiles(watchedFiles)}
                        disabled={busy === "disk"}
                        className={`h-9 rounded-lg px-3 bg-red-600 hover:bg-red-500 text-white text-xs disabled:opacity-60 ${ring}`}
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDisk(null)}
                        className={`h-9 rounded-lg px-2 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 ${ring}`}
                      >
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDisk("watched")}
                      className={`h-9 rounded-lg px-3 text-xs text-zinc-400 hover:text-red-300 hover:bg-zinc-800 ${ring}`}
                    >
                      Delete watched
                    </button>
                  ))}
              </div>

              <div className="space-y-3">
                {shows.map((show) => (
                  <div key={show.key} className="rounded-xl bg-zinc-950/40">
                    {show.files.length > 1 && (
                      <p className="px-3 pt-3 sm:px-4 text-sm font-medium text-zinc-300 line-clamp-1" title={show.title}>
                        {show.title}
                      </p>
                    )}
                    <div className="divide-y divide-zinc-800/60">
                      {show.files.map((f) => {
                        const code = episodeCode(f.name);
                        const label =
                          show.files.length > 1
                            ? code ?? f.name
                            : code && !show.title.includes(code)
                              ? `${show.title} · ${code}`
                              : show.title;
                        return (
                          <div key={f.rel} className="px-3 py-2 sm:px-4">
                            <div className="flex items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-zinc-200 line-clamp-1" title={f.name}>
                                  {label}
                                </p>
                                <p className="text-xs text-zinc-500 tabular-nums">
                                  {f.sizeFormatted}
                                  {f.watched && <span className="text-emerald-300"> · Watched</span>}
                                  {show.orphan && <span className="text-amber-300"> · Not in library</span>}
                                </p>
                              </div>
                              {f.infoHash && f.fileIndex !== undefined && (
                                <>
                                  <PlayRing
                                    d={{
                                      title: label,
                                      progress: f.length ? f.sizeBytes / f.length : 1,
                                      state: !f.length || f.sizeBytes >= f.length ? "ready" : "paused",
                                    }}
                                    disabled={busy !== null}
                                    onClick={() =>
                                      play({
                                        id: `${f.infoHash}:${f.fileIndex}`,
                                        infoHash: f.infoHash!,
                                        fileIndex: f.fileIndex!,
                                        title: show.files.length > 1 && code ? `${show.title} · ${code}` : label,
                                        magnet: f.magnet,
                                      })
                                    }
                                  />
                                  <button
                                    onClick={() =>
                                      copyVlc(
                                        f.infoHash!,
                                        f.fileIndex,
                                        show.files.length > 1 && code ? `${show.title} · ${code}` : label
                                      )
                                    }
                                    className={iconBtn}
                                    aria-label={`Copy VLC link for ${label}`}
                                    title="Copy VLC link"
                                  >
                                    <MonitorPlay className="h-4 w-4" />
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => setConfirmDisk(f.rel)}
                                disabled={busy === "disk"}
                                className={`${iconBtn} hover:text-red-300`}
                                aria-label={`Delete ${label} from disk`}
                                title="Delete from disk"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                            {confirmDisk === f.rel && (
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" role="alert">
                                <span className="mr-auto text-zinc-300">
                                  Delete {label}? Frees {f.sizeFormatted}. It stays in your library.
                                </span>
                                <button
                                  onClick={() => deleteFiles([f])}
                                  disabled={busy === "disk"}
                                  className={`h-10 rounded-lg px-4 bg-red-600 hover:bg-red-500 text-white text-sm disabled:opacity-60 ${ring}`}
                                >
                                  Delete
                                </button>
                                <button
                                  onClick={() => setConfirmDisk(null)}
                                  className={`h-10 rounded-lg px-3 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 ${ring}`}
                                >
                                  Keep
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
