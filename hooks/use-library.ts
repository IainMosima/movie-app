"use client";

import { useState, useEffect, useCallback } from "react";
import type { LibraryListResponse, LibraryCategory } from "@/types";

interface ReclaimResult {
  reclaimedBytes?: number;
  reclaimedFormatted?: string;
}

export function useLibrary() {
  const [data, setData] = useState<LibraryListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/library");
      if (!res.ok) throw new Error("Failed to fetch library");
      const json: LibraryListResponse = await res.json();
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

  // --- Items ---

  const addItem = async (item: {
    name: string;
    magnet: string;
    quality?: string;
    size?: string;
    folderId?: string | null;
    category?: LibraryCategory;
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
    updates: {
      name?: string;
      quality?: string;
      size?: string;
      folderId?: string | null;
      category?: LibraryCategory;
    }
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

  const moveItem = (id: string, folderId: string | null) => updateItem(id, { folderId });

  const setItemCategory = (id: string, category: LibraryCategory) =>
    updateItem(id, { category });

  const deleteItem = async (id: string) => {
    const res = await fetch(`/api/library/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete item");
    await mutate();
  };

  const clearItemCache = async (id: string): Promise<ReclaimResult> => {
    const res = await fetch(`/api/library/${id}/cache`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to clear cache");
    const json = await res.json();
    await mutate();
    return json;
  };

  // --- Folders ---

  const createFolder = async (name: string, category?: LibraryCategory) => {
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category }),
    });
    if (!res.ok) throw new Error("Failed to create folder");
    const json = await res.json();
    await mutate();
    return json;
  };

  const updateFolder = async (
    id: string,
    updates: { name?: string; category?: LibraryCategory }
  ) => {
    const res = await fetch(`/api/folders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Failed to update folder");
    await mutate();
    return res.json();
  };

  const renameFolder = (id: string, name: string) => updateFolder(id, { name });

  const setFolderCategory = (id: string, category: LibraryCategory) =>
    updateFolder(id, { category });

  const deleteFolder = async (
    id: string,
    { deleteItems = false }: { deleteItems?: boolean } = {}
  ): Promise<ReclaimResult> => {
    const res = await fetch(`/api/folders/${id}${deleteItems ? "?deleteItems=1" : ""}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("Failed to delete folder");
    const json = await res.json();
    await mutate();
    return json;
  };

  const clearFolderCache = async (id: string): Promise<ReclaimResult> => {
    const res = await fetch(`/api/folders/${id}/cache`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to clear folder cache");
    const json = await res.json();
    await mutate();
    return json;
  };

  const reorderFolder = async (id: string, orderedIds: string[]) => {
    const res = await fetch(`/api/folders/${id}/order`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds }),
    });
    if (!res.ok) throw new Error("Failed to save order");
    await mutate();
  };

  const resetFolderOrder = async (id: string) => {
    const res = await fetch(`/api/folders/${id}/order`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to reset order");
    await mutate();
  };

  return {
    items: data?.items || [],
    folders: data?.folders || [],
    isLoading,
    error,
    addItem,
    updateItem,
    moveItem,
    deleteItem,
    clearItemCache,
    setItemCategory,
    createFolder,
    renameFolder,
    setFolderCategory,
    deleteFolder,
    clearFolderCache,
    reorderFolder,
    resetFolderOrder,
    refresh: mutate,
  };
}
