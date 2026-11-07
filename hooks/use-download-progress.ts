"use client";

import { useCallback, useEffect, useState } from "react";

export interface DownloadTarget {
  infoHash: string;
  fileIndex: number;
  fileSize: number;
}

export interface DownloadRow {
  id: string;
  /** infoHash + file index when already known (null until the torrent resolves). */
  infoHash: string | null;
  fileIndex: number | null;
}

const keyOf = (infoHash: string, fileIndex: number) => `${infoHash.toLowerCase()}:${fileIndex}`;

/**
 * Background "Download" buttons: pins a file via the prefetch route and reads
 * per-file progress from /api/torrents, polling every 3s while the dialog is
 * open and something it shows is still downloading.
 */
export function useDownloadProgress(open: boolean, rows: DownloadRow[]) {
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [resolved, setResolved] = useState<Record<string, string>>({}); // row id -> key
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/torrents");
      if (!res.ok) return;
      const data: {
        torrents?: { infoHash: string; files?: { index: number; progress: number }[] }[];
      } = await res.json();
      const next: Record<string, number> = {};
      for (const t of data.torrents ?? [])
        for (const f of t.files ?? []) next[keyOf(t.infoHash, f.index)] = f.progress;
      setProgress(next);
    } catch {
      // keep the last known numbers on screen
    }
  }, []);

  const keyFor = (row: DownloadRow) =>
    resolved[row.id] ??
    (row.infoHash && row.fileIndex !== null ? keyOf(row.infoHash, row.fileIndex) : null);

  const keys = rows.map(keyFor);
  const downloading = keys.some((k) => {
    const p = k ? progress[k] : undefined;
    return p !== undefined && p > 0 && p < 1;
  });
  const anyBusy = Object.values(busy).some(Boolean);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open || (!downloading && !anyBusy)) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [open, downloading, anyBusy, refresh]);

  const start = async (id: string, getTarget: () => Promise<DownloadTarget>) => {
    setBusy((b) => ({ ...b, [id]: true }));
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      const { infoHash, fileIndex, fileSize } = await getTarget();
      setResolved((r) => ({ ...r, [id]: keyOf(infoHash, fileIndex) }));
      const res = await fetch(`/api/torrent/${infoHash}/prefetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIndex, fileSize, pin: true }),
      });
      const data = await res.json().catch(() => ({}));
      // "current" = it's the episode playing, which downloads anyway.
      if (!data.prefetching && data.reason !== "current") {
        setErrors((e) => ({
          ...e,
          [id]:
            data.message || data.error || `Couldn't start download (${data.reason ?? res.status})`,
        }));
      }
      await refresh();
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [id]: err instanceof Error ? err.message : "Couldn't start download",
      }));
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  };

  const status = (row: DownloadRow) => {
    const k = keyFor(row);
    return {
      progress: k ? progress[k] : undefined,
      busy: !!busy[row.id],
      error: errors[row.id],
    };
  };

  return { start, status, refresh };
}
