import "server-only";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { Source, SourcesData } from "@/types";

const DATA_PATH = join(process.cwd(), "data", "sources.json");

function ensureDataFile(): void {
  if (!existsSync(DATA_PATH)) {
    const initial: SourcesData = {
      activeSourceId: null,
      sources: [],
    };
    writeFileSync(DATA_PATH, JSON.stringify(initial, null, 2));
  }
}

export function getSources(): SourcesData {
  ensureDataFile();
  const data = readFileSync(DATA_PATH, "utf-8");
  return JSON.parse(data) as SourcesData;
}

function saveSources(data: SourcesData): void {
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

export function getAllSources(): Source[] {
  return getSources().sources;
}

export function getActiveSource(): Source | null {
  const data = getSources();
  if (!data.activeSourceId) return null;
  return data.sources.find((s) => s.id === data.activeSourceId) || null;
}

export function getSourceById(id: string): Source | null {
  const data = getSources();
  return data.sources.find((s) => s.id === id) || null;
}

export function addSource(source: Omit<Source, "id">): Source {
  const data = getSources();
  const newSource: Source = {
    ...source,
    id: `src_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  };
  data.sources.push(newSource);

  // If this is the first source, make it active
  if (data.sources.length === 1) {
    data.activeSourceId = newSource.id;
  }

  saveSources(data);
  return newSource;
}

export function updateSource(
  id: string,
  updates: Partial<Omit<Source, "id">>
): Source | null {
  const data = getSources();
  const index = data.sources.findIndex((s) => s.id === id);
  if (index === -1) return null;

  data.sources[index] = { ...data.sources[index], ...updates };
  saveSources(data);
  return data.sources[index];
}

export function deleteSource(id: string): boolean {
  const data = getSources();
  const index = data.sources.findIndex((s) => s.id === id);
  if (index === -1) return false;

  data.sources.splice(index, 1);

  // If we deleted the active source, clear activeSourceId or set to first available
  if (data.activeSourceId === id) {
    data.activeSourceId = data.sources.length > 0 ? data.sources[0].id : null;
  }

  saveSources(data);
  return true;
}

export function setActiveSource(id: string): boolean {
  const data = getSources();
  const source = data.sources.find((s) => s.id === id);
  if (!source) return false;

  data.activeSourceId = id;
  saveSources(data);
  return true;
}

export function getActiveSourceId(): string | null {
  return getSources().activeSourceId;
}
