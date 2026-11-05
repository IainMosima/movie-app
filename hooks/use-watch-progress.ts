"use client";

import { useState, useEffect, useCallback } from "react";
import { formatDuration } from "@/lib/utils";
import { extractInfoHash } from "@/lib/torrent-utils";
import type { LibraryItem, WatchRecord } from "@/types";

export type WatchState = "unwatched" | "watching" | "watched";

export interface WatchStatus {
  state: WatchState;
  pct: number;
  label: string;
  record: WatchRecord | null;
}

export function timeLeft(record: WatchRecord): string {
  if (!record.durationSec || record.durationSec <= record.positionSec) {
    return `${formatDuration(record.positionSec)} in`;
  }
  const remaining = Math.round((record.durationSec - record.positionSec) / 60);
  if (remaining < 1) return "almost done";
  if (remaining < 60) return `${remaining} min left`;
  const hours = Math.floor(remaining / 60);
  const mins = remaining % 60;
  return mins ? `${hours}h ${mins}m left` : `${hours}h left`;
}

export function progressPct(record: WatchRecord): number {
  return record.durationSec
    ? Math.min(100, Math.round((record.positionSec / record.durationSec) * 100))
    : 0;
}

const UNWATCHED: WatchStatus = { state: "unwatched", pct: 0, label: "", record: null };

/**
 * Where a library item stands. Records are keyed by infoHash + fileIndex; an
 * item that picked an episode uses that file's record, otherwise the most
 * recently played file of the torrent speaks for it.
 */
export function watchStatusFor(
  item: Pick<LibraryItem, "id" | "magnet" | "infoHash" | "fileIndex">,
  history: WatchRecord[],
): WatchStatus {
  const hash = (item.infoHash ?? extractInfoHash(item.magnet))?.toLowerCase();
  const mine = history.filter((r) => (hash && r.infoHash === hash) || r.libraryItemId === item.id);
  if (mine.length === 0) return UNWATCHED;

  const record =
    (item.fileIndex !== undefined && mine.find((r) => r.fileIndex === item.fileIndex)) ||
    mine.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));

  if (record.finished) return { state: "watched", pct: 100, label: "Watched", record };
  return { state: "watching", pct: progressPct(record), label: timeLeft(record), record };
}

export function useWatchProgress() {
  const [records, setRecords] = useState<WatchRecord[]>([]);
  const [history, setHistory] = useState<WatchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/progress");
      if (!res.ok) throw new Error("Failed to fetch watch progress");
      const json: { records: WatchRecord[]; history?: WatchRecord[] } = await res.json();
      setRecords(json.records ?? []);
      setHistory(json.history ?? []);
    } catch {
      // Continue Watching is an extra, never a blocker for the home page.
      setRecords([]);
      setHistory([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const forget = async (record: WatchRecord) => {
    // Drop it locally first so the row responds instantly.
    setRecords((prev) =>
      prev.filter((r) => !(r.infoHash === record.infoHash && r.fileIndex === record.fileIndex)),
    );
    try {
      await fetch(`/api/progress/${record.infoHash}?file=${record.fileIndex}`, {
        method: "DELETE",
      });
    } catch {
      await load();
    }
  };

  const markWatched = async (item: LibraryItem) => {
    const status = watchStatusFor(item, history);
    const infoHash = status.record?.infoHash ?? item.infoHash ?? extractInfoHash(item.magnet);
    if (!infoHash) return;
    await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        infoHash,
        fileIndex: status.record?.fileIndex ?? item.fileIndex ?? 0,
        positionSec: status.record?.positionSec ?? 0,
        durationSec: status.record?.durationSec ?? 0,
        title: item.name,
        finished: true,
      }),
    });
    await load();
  };

  const markUnwatched = async (item: LibraryItem) => {
    const { record } = watchStatusFor(item, history);
    if (!record) return;
    // An item that picked an episode forgets just that one; otherwise the torrent.
    const file = item.fileIndex !== undefined ? `?file=${record.fileIndex}` : "";
    await fetch(`/api/progress/${record.infoHash}${file}`, { method: "DELETE" });
    await load();
  };

  return {
    records,
    history,
    isLoading,
    forget,
    markWatched,
    markUnwatched,
    refresh: load,
  };
}
