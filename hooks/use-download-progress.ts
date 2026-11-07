"use client";

import { useCallback, useEffect, useState } from "react";

/** What POST /api/downloads needs. Folder items may know only the magnet. */
export interface DownloadTarget {
  magnet: string;
  infoHash?: string;
  fileIndex?: number;
  title: string;
  size?: number;
}

/** One entry of GET /api/downloads. */
export interface DownloadEntry {
  id: string;
  infoHash: string;
  fileIndex: number;
  title: string;
  magnet?: string;
  size: number;
  progress: number;
  state: "queued" | "downloading" | "paused" | "ready" | "error";
  speed: number;
  message?: string;
}

export interface DownloadRow {
  id: string;
  /** infoHash + file index when already known (null until the torrent resolves). */
  infoHash: string | null;
  fileIndex: number | null;
}

export type DownloadState = "idle" | "starting" | "queued" | "downloading" | "paused" | "ready" | "error";

export interface DownloadStatus {
  state: DownloadState;
  progress: number;
  speed: number;
  message?: string;
}

export const FLOOR_BYTES = 8 * 1024 ** 3;

const keyOf = (infoHash: string, fileIndex: number) => `${infoHash.toLowerCase()}:${fileIndex}`;

/** B/s → "512 B/s", "84 KB/s", "2.1 MB/s". */
export function formatSpeed(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`;
  if (bps < 1024 ** 2) return `${Math.round(bps / 1024)} KB/s`;
  return `${(bps / 1024 ** 2).toFixed(1)} MB/s`;
}

/**
 * Background "Download" buttons on /api/downloads. Polls every 2s while a row
 * it shows is starting/queued/downloading, every 15s otherwise, only while open.
 */
export function useDownloadProgress(open: boolean, rows: DownloadRow[]) {
  const [entries, setEntries] = useState<Record<string, DownloadEntry>>({});
  const [free, setFree] = useState<number | null>(null);
  const [resolved, setResolved] = useState<Record<string, string>>({}); // row id -> download id
  const [starting, setStarting] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/downloads");
      if (!res.ok) return;
      const data: { downloads?: DownloadEntry[]; free?: number } = await res.json();
      const next: Record<string, DownloadEntry> = {};
      for (const d of data.downloads ?? []) next[d.id.toLowerCase()] = d;
      setEntries(next);
      if (typeof data.free === "number") setFree(data.free);
    } catch {
      // keep the last known numbers on screen
    }
  }, []);

  const entryFor = (row: DownloadRow): DownloadEntry | undefined => {
    const id =
      resolved[row.id] ??
      (row.infoHash && row.fileIndex !== null ? keyOf(row.infoHash, row.fileIndex) : null);
    if (id) return entries[id.toLowerCase()];
    // A folder item without a fileIndex downloads its main video; one pin per torrent.
    const hash = row.infoHash?.toLowerCase();
    return hash ? Object.values(entries).find((e) => e.infoHash.toLowerCase() === hash) : undefined;
  };

  const status = (row: DownloadRow): DownloadStatus => {
    if (starting[row.id]) return { state: "starting", progress: 0, speed: 0 };
    if (errors[row.id]) return { state: "error", progress: 0, speed: 0, message: errors[row.id] };
    const e = entryFor(row);
    if (!e) return { state: "idle", progress: 0, speed: 0 };
    return { state: e.state, progress: e.progress, speed: e.speed, message: e.message };
  };

  const active = rows.some((r) => {
    const s = status(r).state;
    return s === "starting" || s === "queued" || s === "downloading";
  });

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(refresh, active ? 2000 : 15000);
    return () => clearInterval(t);
  }, [open, active, refresh]);

  const post = async (list: { rowId: string; target: DownloadTarget }[]) => {
    const ids = list.map((i) => i.rowId);
    const mark = (v: boolean) =>
      setStarting((s) => ({ ...s, ...Object.fromEntries(ids.map((id) => [id, v])) }));
    mark(true);
    setErrors((e) => ({ ...e, ...Object.fromEntries(ids.map((id) => [id, ""])) }));
    const fail = (rowId: string, msg: string) => setErrors((e) => ({ ...e, [rowId]: msg }));
    try {
      const body = list.length === 1 ? list[0].target : { items: list.map((i) => i.target) };
      const res = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (list.length === 1) {
        // Single: the entry itself, or { error, message }.
        const r = json as { id?: string; error?: string; message?: string };
        const rowId = list[0].rowId;
        if (r.error || !r.id) fail(rowId, r.message || r.error || `Couldn't start download (${res.status})`);
        else setResolved((m) => ({ ...m, [rowId]: r.id!.toLowerCase() }));
      } else {
        // Batch: { downloads: [entry...], errors: [{ title, message }] } — accepted
        // entries aren't positional, so match each request by episode, then title.
        const rows: DownloadEntry[] = json.downloads ?? [];
        const errs: { title: string; message: string }[] = json.errors ?? [];
        for (const { rowId, target } of list) {
          const err = errs.find((e) => e.title === target.title);
          if (err) {
            fail(rowId, err.message);
            continue;
          }
          const hit = rows.find(
            (r) =>
              (target.infoHash &&
                target.fileIndex !== undefined &&
                r.infoHash.toLowerCase() === target.infoHash.toLowerCase() &&
                r.fileIndex === target.fileIndex) ||
              r.title === target.title
          );
          if (hit) setResolved((m) => ({ ...m, [rowId]: hit.id.toLowerCase() }));
        }
      }
      await refresh();
    } catch (err) {
      for (const id of ids) fail(id, err instanceof Error ? err.message : "Couldn't start download");
    } finally {
      mark(false);
    }
  };

  const start = (rowId: string, target: DownloadTarget) => post([{ rowId, target }]);
  const startMany = (items: { rowId: string; target: DownloadTarget }[]) =>
    items.length ? post(items) : Promise.resolve();

  /** Pause a running download, or resume a paused one (bytes are kept either way). */
  const togglePause = async (row: DownloadRow) => {
    const e = entryFor(row);
    if (!e) return;
    const action = e.state === "paused" ? "resume" : "pause";
    setStarting((s) => ({ ...s, [row.id]: action === "resume" }));
    try {
      const res = await fetch("/api/downloads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id, action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrors((x) => ({ ...x, [row.id]: data.message || `Couldn't ${action}` }));
      }
      await refresh();
    } finally {
      setStarting((s) => ({ ...s, [row.id]: false }));
    }
  };

  return { start, startMany, togglePause, status, entry: entryFor, refresh, free };
}
