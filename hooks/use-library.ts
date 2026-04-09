"use client";

import { useState, useEffect, useCallback } from "react";
import type { LibraryItem, LibraryData } from "@/types";

export function useLibrary() {
  const [data, setData] = useState<LibraryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/library");
      if (!res.ok) throw new Error("Failed to fetch library");
      const json: LibraryData = await res.json();
      setData(json);
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

  const mutate = useCallback(() => load(), [load]);

  const addItem = async (item: {
    name: string;
    magnet: string;
    quality?: string;
    size?: string;
  }) => {
    const res = await fetch("/api/library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to add item");
    }
    await mutate();
    return res.json();
  };

  const updateItem = async (
    id: string,
    updates: { name?: string; quality?: string; size?: string }
  ) => {
    const res = await fetch(`/api/library/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Failed to update item");
    await mutate();
    return res.json();
  };

  const deleteItem = async (id: string) => {
    const res = await fetch(`/api/library/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete item");
    await mutate();
  };

  return {
    items: data?.items || [],
    isLoading,
    error,
    addItem,
    updateItem,
    deleteItem,
    refresh: mutate,
  };
}
