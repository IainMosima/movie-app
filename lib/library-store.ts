import "server-only";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/data-dir";
import {
  episodeCode,
  parseEpisode,
  sortFolderItems,
  type EpisodeNumber,
} from "@/lib/episode-order";
import { resolveFolderCategory } from "@/lib/category";
import type {
  LibraryItem,
  LibraryFolder,
  LibraryData,
  LibraryCategory,
} from "@/types";

function getLibraryPath(): string {
  return join(getDataDir(), "library.json");
}

function ensureDataFile(path: string): void {
  if (!existsSync(path)) {
    const initial: LibraryData = { items: [], folders: [] };
    writeFileSync(path, JSON.stringify(initial, null, 2));
  }
}

export function getLibrary(): LibraryData {
  const path = getLibraryPath();
  ensureDataFile(path);
  const data = readFileSync(path, "utf-8");
  const parsed = JSON.parse(data) as Partial<LibraryData>;
  // Libraries written before folders existed have no `folders` key.
  return { items: parsed.items ?? [], folders: parsed.folders ?? [] };
}

function saveLibrary(data: LibraryData): void {
  writeFileSync(getLibraryPath(), JSON.stringify(data, null, 2));
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Items in a series folder are named by their standard code ("S01E01"): from
 * the given name, else the magnet's dn=, else one past the folder's highest
 * episode. Movie folders are left alone.
 */
function applyEpisodeName(data: LibraryData, item: LibraryItem): void {
  const folder = data.folders.find((f) => f.id === item.folderId);
  if (!folder) return;
  const siblings = data.items.filter(
    (i) => i.folderId === folder.id && i.id !== item.id
  );
  if (resolveFolderCategory(folder, [...siblings, item]) !== "series") return;

  const dn = new URLSearchParams(item.magnet.split("?")[1] ?? "").get("dn");
  let code = episodeCode(item.name) ?? episodeCode(dn ?? "");
  if (!code) {
    const last = siblings
      .map((i) => parseEpisode(i.name))
      .reduce<EpisodeNumber | null>(
        (max, e) =>
          e && (!max || e.season > max.season || (e.season === max.season && e.episode > max.episode))
            ? e
            : max,
        null
      );
    code = episodeCode(`S${last?.season ?? 1}E${(last?.episode ?? 0) + 1}`);
  }
  if (code) item.name = code;
}

// --- Items ---

export function getAllItems(): LibraryItem[] {
  return getLibrary().items;
}

export function getItemById(id: string): LibraryItem | null {
  const data = getLibrary();
  return data.items.find((item) => item.id === id) || null;
}

export function addItem(item: Omit<LibraryItem, "id" | "addedAt">): LibraryItem {
  const data = getLibrary();

  // Check for duplicate magnet
  const existing = data.items.find((i) => i.magnet === item.magnet);
  if (existing) {
    // Re-adding a known magnet into a folder should move it there rather than
    // silently doing nothing.
    if (item.folderId !== undefined && item.folderId !== existing.folderId) {
      existing.folderId = item.folderId;
      applyEpisodeName(data, existing);
      saveLibrary(data);
    }
    return existing;
  }

  const newItem: LibraryItem = {
    ...item,
    id: newId("lib"),
    addedAt: Date.now(),
  };

  applyEpisodeName(data, newItem);
  // Add to beginning (newest first)
  data.items.unshift(newItem);
  saveLibrary(data);
  return newItem;
}

export function updateItem(
  id: string,
  updates: Partial<Omit<LibraryItem, "id" | "addedAt">>
): LibraryItem | null {
  const data = getLibrary();
  const index = data.items.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const moved = updates.folderId && updates.folderId !== data.items[index].folderId;
  data.items[index] = { ...data.items[index], ...updates };
  if (moved) applyEpisodeName(data, data.items[index]);
  saveLibrary(data);
  return data.items[index];
}

export function deleteItem(id: string): boolean {
  const data = getLibrary();
  const index = data.items.findIndex((item) => item.id === id);
  if (index === -1) return false;

  data.items.splice(index, 1);
  saveLibrary(data);
  return true;
}

export function clearLibrary(): void {
  saveLibrary({ items: [], folders: [] });
}

// --- Folders ---

export function getFolders(): LibraryFolder[] {
  return getLibrary().folders;
}

export function getFolderById(id: string): LibraryFolder | null {
  return getLibrary().folders.find((f) => f.id === id) || null;
}

/**
 * A folder's contents in the order they should be shown: a manual arrangement
 * when one has been made, otherwise by episode.
 *
 * The manual order only applies when *every* item carries a sortOrder —
 * a half-arranged folder would otherwise interleave unpositioned episodes
 * unpredictably, which reads as a bug rather than as a partial preference.
 */
export function getItemsByFolder(folderId: string): LibraryItem[] {
  const items = getLibrary().items.filter((item) => item.folderId === folderId);
  return sortFolderItems(items);
}

/**
 * Pin a folder's items to an explicit order. Ids not in the folder are ignored;
 * anything the caller omitted keeps its place at the end, so a partial list
 * can never silently drop an episode out of the arrangement.
 */
export function reorderFolderItems(
  folderId: string,
  orderedIds: string[]
): LibraryItem[] {
  const data = getLibrary();
  const inFolder = data.items.filter((i) => i.folderId === folderId);

  const ranked = orderedIds.filter((id) => inFolder.some((i) => i.id === id));
  const remainder = inFolder
    .filter((i) => !ranked.includes(i.id))
    .map((i) => i.id);
  const finalOrder = [...ranked, ...remainder];

  for (const item of data.items) {
    const position = finalOrder.indexOf(item.id);
    if (position !== -1) item.sortOrder = position;
  }

  saveLibrary(data);
  return getItemsByFolder(folderId);
}

/** Drop the manual arrangement so the folder falls back to episode order. */
export function clearFolderItemOrder(folderId: string): LibraryItem[] {
  const data = getLibrary();
  for (const item of data.items) {
    if (item.folderId === folderId) delete item.sortOrder;
  }
  saveLibrary(data);
  return getItemsByFolder(folderId);
}

export function addFolder(
  name: string,
  category?: LibraryCategory
): LibraryFolder {
  const data = getLibrary();

  const existing = data.folders.find(
    (f) => f.name.trim().toLowerCase() === name.trim().toLowerCase()
  );
  if (existing) return existing;

  const folder: LibraryFolder = {
    id: newId("fld"),
    name: name.trim(),
    createdAt: Date.now(),
    ...(category ? { category } : {}),
  };
  data.folders.unshift(folder);
  saveLibrary(data);
  return folder;
}

export function updateFolder(
  id: string,
  updates: { name?: string; category?: LibraryCategory }
): LibraryFolder | null {
  const data = getLibrary();
  const folder = data.folders.find((f) => f.id === id);
  if (!folder) return null;

  if (updates.name !== undefined) folder.name = updates.name.trim();
  if (updates.category !== undefined) folder.category = updates.category;
  saveLibrary(data);
  return folder;
}

/**
 * Remove a folder. By default its items survive as loose top-level items —
 * removing a grouping never removes media. Pass { deleteItems: true } to drop
 * the items too; callers are responsible for clearing their cached bytes
 * first (see deleteCacheForLibraryItem in lib/storage-store.ts).
 */
export function deleteFolder(
  id: string,
  { deleteItems = false }: { deleteItems?: boolean } = {}
): boolean {
  const data = getLibrary();
  const index = data.folders.findIndex((f) => f.id === id);
  if (index === -1) return false;

  if (deleteItems) {
    data.items = data.items.filter((item) => item.folderId !== id);
  } else {
    for (const item of data.items) {
      if (item.folderId === id) item.folderId = null;
    }
  }

  data.folders.splice(index, 1);
  saveLibrary(data);
  return true;
}
