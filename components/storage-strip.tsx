"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, HardDrive, Loader2, RefreshCw } from "lucide-react";
import { useStorage } from "@/hooks/use-storage";
import type { DownloadEntry } from "@/hooks/use-download-progress";
import { DownloadsDialog } from "@/components/downloads-dialog";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Below this the app refuses to pull new episodes ahead; matches the server floor. */
const FLOOR_BYTES = 8 * 1024 ** 3;

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400";
const btn = `h-10 shrink-0 rounded-lg px-3 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-40 transition-colors ${ring}`;

/**
 * One quiet line on the home page: how much room is left, what the downloads
 * use and what's downloading right now. The full list lives in Settings → Storage.
 */
export function StorageStrip() {
  const { report, refresh, deleteAllOrphans } = useStorage();
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);

  const loadDownloads = useCallback(async () => {
    try {
      const res = await fetch("/api/downloads");
      if (res.ok) setDownloads(((await res.json()).downloads ?? []) as DownloadEntry[]);
    } catch {
      // keep the last line on screen
    }
  }, []);

  const active = downloads.filter((d) => d.state === "downloading" || d.state === "queued");

  useEffect(() => {
    loadDownloads();
  }, [loadDownloads]);

  useEffect(() => {
    if (active.length === 0) return;
    const t = setInterval(loadDownloads, 5000);
    return () => clearInterval(t);
  }, [active.length, loadDownloads]);

  // Disk numbers drift while things download; keep them fresh while visible.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refresh(), loadDownloads()]);
    } finally {
      setRefreshing(false);
    }
  };

  const cleanUp = async () => {
    setCleaning(true);
    try {
      // The all-zero hash matches no library item, so nothing counts as "current"
      // and every finished item's bytes go.
      const res = await fetch("/api/purge-previous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ infoHash: "0".repeat(40), confirm: true }),
      });
      const purged: { reclaimedBytes?: number } = res.ok ? await res.json() : {};
      const orphans: { reclaimedBytes?: number } = await deleteAllOrphans();
      const freed = (purged.reclaimedBytes ?? 0) + (orphans.reclaimedBytes ?? 0);
      toast.success(freed > 0 ? `Freed ${formatBytes(freed)}` : "Nothing to clean up");
      setConfirming(false);
      await refreshAll();
    } catch {
      toast.error("Clean up failed");
    } finally {
      setCleaning(false);
    }
  };

  const disk = report?.disk;
  if (!disk || disk.totalBytes <= 0) return null;

  const usedPct = Math.min(100, Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100));
  const low = disk.freeBytes < FLOOR_BYTES;
  const tight = !low && disk.freeBytes < FLOOR_BYTES * 2;
  const avgPct = active.length
    ? Math.floor((active.reduce((s, d) => s + d.progress, 0) / active.length) * 100)
    : 0;

  return (
    <div className="rounded-xl bg-zinc-900/50 px-4 py-2">
      <div className="flex items-center gap-1">
        <Link
          href="/settings#storage"
          className={`flex flex-1 min-w-0 items-center gap-3 text-sm rounded-lg py-2 -ml-1 pl-1 hover:text-zinc-100 ${ring}`}
          aria-label={`Storage: ${formatBytes(disk.freeBytes)} free, downloads use ${report.cacheTotalFormatted}${
            active.length ? `, ${active.length} downloading at ${avgPct}%` : ""
          }. Open storage settings.`}
        >
          <HardDrive className="h-4 w-4 text-zinc-500 shrink-0" aria-hidden />
          <span className={`shrink-0 ${low ? "text-red-300" : tight ? "text-amber-300" : "text-zinc-200"}`}>
            {formatBytes(disk.freeBytes)} free
          </span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400 truncate">On disk {report.cacheTotalFormatted}</span>
        </Link>
          <button
            onClick={() => setShowDownloads(true)}
            className={`${btn} flex items-center gap-1.5 ${active.length ? "text-purple-300" : ""}`}
            aria-label={`Downloads${active.length ? `: ${active.length} downloading at ${avgPct}%` : ""}`}
          >
            <Download className="h-4 w-4" aria-hidden />
            <span className="tabular-nums">
              {active.length ? `${active.length} · ${avgPct}%` : "Downloads"}
            </span>
          </button>
        <button
          onClick={refreshAll}
          disabled={refreshing || cleaning}
          className={`${btn} w-10 px-0 flex items-center justify-center`}
          aria-label="Refresh storage"
          title="Refresh storage"
        >
          <RefreshCw
            className={`h-4 w-4 ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`}
            aria-hidden
          />
        </button>
        <button
          onClick={() => setConfirming(true)}
          disabled={cleaning || confirming}
          className={btn}
        >
          Clean up
        </button>
        <Link href="/settings#storage" className={`${btn} hidden sm:flex items-center`}>
          Manage
        </Link>
      </div>
      <div className="mt-1 mb-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full ${low ? "bg-red-500" : tight ? "bg-amber-500" : "bg-zinc-500"}`}
          style={{ width: `${usedPct}%` }}
        />
      </div>
      {confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" role="alert">
          <span className="text-zinc-300 mr-auto">
            Delete downloads of things you&apos;ve finished and leftover files?
          </span>
          <button
            onClick={cleanUp}
            disabled={cleaning}
            className={`h-10 rounded-lg px-4 bg-red-600 hover:bg-red-500 text-white text-sm flex items-center gap-2 disabled:opacity-60 ${ring}`}
          >
            {cleaning && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            Delete
          </button>
          <button onClick={() => setConfirming(false)} disabled={cleaning} className={btn}>
            Cancel
          </button>
        </div>
      )}
      <DownloadsDialog open={showDownloads} onOpenChange={setShowDownloads} onChanged={refreshAll} />
      {low && (
        <p className="mt-2 text-xs text-red-300">
          Under 8 GB free — new episodes won&apos;t download ahead. Clear something you&apos;ve watched.
        </p>
      )}
    </div>
  );
}
