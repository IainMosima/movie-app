"use client";

import useSWR from "swr";
import type { LibraryItem, LibraryData } from "@/types";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useLibrary() {
  const { data, error, isLoading, mutate } = useSWR<LibraryData>(
    "/api/library",
    fetcher
  );

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
