"use client";

import { useState, useEffect, useCallback } from "react";
import type { StorageReport } from "@/types";

export function useStorage() {
  const [report, setReport] = useState<StorageReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/storage");
      if (!res.ok) throw new Error("Failed to fetch storage report");
      const json: StorageReport = await res.json();
      setReport(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => load(), [load]);

  const deleteOrphan = async (folder: string) => {
    const res = await fetch("/api/storage", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    });
    if (!res.ok) throw new Error("Failed to delete cache folder");
    await refresh();
    return res.json();
  };

  const deleteAllOrphans = async () => {
    const res = await fetch("/api/storage", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orphansOnly: true }),
    });
    if (!res.ok) throw new Error("Failed to reclaim orphans");
    await refresh();
    return res.json();
  };

  const orphanCount = report?.entries.filter((e) => e.kind === "orphan").length ?? 0;

  return {
    report,
    isLoading,
    error,
    orphanCount,
    deleteOrphan,
    deleteAllOrphans,
    refresh,
  };
}
