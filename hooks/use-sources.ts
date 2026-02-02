"use client";

import useSWR from "swr";
import type { Source, SourcesData } from "@/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useSources() {
  const { data, error, isLoading, mutate } = useSWR<SourcesData>(
    "/api/sources",
    fetcher
  );

  const addSource = async (source: Omit<Source, "id">) => {
    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(source),
    });
    if (!res.ok) throw new Error("Failed to add source");
    await mutate();
    return res.json();
  };

  const updateSource = async (id: string, updates: Partial<Omit<Source, "id">>) => {
    const res = await fetch(`/api/sources/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Failed to update source");
    await mutate();
    return res.json();
  };

  const deleteSource = async (id: string) => {
    const res = await fetch(`/api/sources/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete source");
    await mutate();
  };

  const setActiveSource = async (id: string) => {
    const res = await fetch("/api/sources/active", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) throw new Error("Failed to set active source");
    await mutate();
  };

  return {
    sources: data?.sources || [],
    activeSourceId: data?.activeSourceId || null,
    activeSource: data?.sources.find((s) => s.id === data?.activeSourceId) || null,
    isLoading,
    error,
    addSource,
    updateSource,
    deleteSource,
    setActiveSource,
    refresh: mutate,
  };
}
