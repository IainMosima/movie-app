import "server-only";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { LibraryItem, LibraryData } from "@/types";

const DATA_PATH = join(process.cwd(), "data", "library.json");

function ensureDataFile(): void {
  if (!existsSync(DATA_PATH)) {
    const initial: LibraryData = { items: [] };
    writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
  }
}

export function getLibrary(): LibraryData {
  ensureDataFile();
  const data = readFileSync(DATA_PATH, "utf-8");
  return JSON.parse(data) as LibraryData;
}

function saveLibrary(data: LibraryData): void {
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

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
    return existing;
  }

  const newItem: LibraryItem = {
    ...item,
    id: `lib_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    addedAt: Date.now(),
  };

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

  data.items[index] = { ...data.items[index], ...updates };
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
  saveLibrary({ items: [] });
}
