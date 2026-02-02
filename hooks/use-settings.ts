"use client";

import useSWR from "swr";
import type { EngineSettings } from "@/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useSettings() {
  const { data, error, isLoading, mutate } = useSWR<EngineSettings>(
    "/api/settings",
    fetcher
  );

  const updateSettings = async (updates: Partial<EngineSettings>) => {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Failed to update settings");
    await mutate();
    return res.json();
  };

  const resetSettings = async () => {
    const res = await fetch("/api/settings", {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to reset settings");
    await mutate();
    return res.json();
  };

  return {
    settings: data,
    isLoading,
    error,
    updateSettings,
    resetSettings,
    refresh: mutate,
  };
}
