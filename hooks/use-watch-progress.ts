"use client";

import { useState, useEffect, useCallback } from "react";
import type { WatchRecord } from "@/types";

export function useWatchProgress() {
  const [records, setRecords] = useState<WatchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/progress");
      if (!res.ok) throw new Error("Failed to fetch watch progress");
      const json: { records: WatchRecord[] } = await res.json();
      setRecords(json.records ?? []);
    } catch {
      // Continue Watching is an extra, never a blocker for the home page.
      setRecords([]);
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
      prev.filter(
        (r) => !(r.infoHash === record.infoHash && r.fileIndex === record.fileIndex)
      )
    );
    try {
      await fetch(`/api/progress/${record.infoHash}?file=${record.fileIndex}`, {
        method: "DELETE",
      });
    } catch {
      await load();
    }
  };

  return { records, isLoading, forget, refresh: load };
}
