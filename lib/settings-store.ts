import "server-only";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/data-dir";
import type { EngineSettings } from "@/types";

function getSettingsPath(): string {
  return join(getDataDir(), "settings.json");
}

const DEFAULT_SETTINGS: EngineSettings = {
  downloadLimit: -1,
  uploadLimit: -1,
  maxConnections: 55,
  cleanupDelaySeconds: 30,
  prebufferSeconds: 90, // wait up to 90s for the initial safety buffer
  bufferSizeMB: 200, // cache ~200MB so TVs can coast through peer stalls
  prebufferMode: "strict",
  autoPurgePrevious: false, // never reclaim without asking unless turned on
};

function ensureSettingsFile(path: string): void {
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  }
}

export function getSettings(): EngineSettings {
  const path = getSettingsPath();
  ensureSettingsFile(path);
  const data = readFileSync(path, "utf-8");
  const parsed = JSON.parse(data) as Partial<EngineSettings>;
  const merged = { ...DEFAULT_SETTINGS, ...parsed } as EngineSettings;
  // Persist new defaults if missing in stored settings
  if (JSON.stringify(parsed) !== JSON.stringify(merged)) {
    writeFileSync(path, JSON.stringify(merged, null, 2));
  }
  return merged;
}

export function updateSettings(
  updates: Partial<EngineSettings>
): EngineSettings {
  const current = getSettings();
  const updated = { ...current, ...updates };
  writeFileSync(getSettingsPath(), JSON.stringify(updated, null, 2));
  return updated;
}

export function resetSettings(): EngineSettings {
  writeFileSync(getSettingsPath(), JSON.stringify(DEFAULT_SETTINGS, null, 2));
  return DEFAULT_SETTINGS;
}
