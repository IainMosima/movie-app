"use client";

import { useState, useEffect, useCallback } from "react";
import type { DataDirReport, BrowseResponse } from "@/types";

export function useDataDir() {
  const [report, setReport] = useState<DataDirReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/data-dir");
      if (!res.ok) throw new Error("Failed to fetch data directory");
      const json: DataDirReport = await res.json();
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

  const browse = async (path?: string): Promise<BrowseResponse> => {
    const url = path ? `/api/data-dir/browse?path=${encodeURIComponent(path)}` : "/api/data-dir/browse";
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to browse");
    return res.json();
  };

  const switchTo = async (path: string) => {
    const res = await fetch("/api/data-dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to switch data directory");
    }
    await refresh();
    return res.json();
  };

  return {
    report,
    isLoading,
    error,
    browse,
    switchTo,
    refresh,
  };
}
