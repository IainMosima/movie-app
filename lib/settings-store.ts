import "server-only";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { EngineSettings } from "@/types";

const SETTINGS_PATH = join(process.cwd(), "data", "settings.json");

const DEFAULT_SETTINGS: EngineSettings = {
  downloadLimit: -1,
  uploadLimit: -1,
  maxConnections: 55,
  cleanupDelaySeconds: 30,
  prebufferSeconds: 30,
};

function ensureSettingsFile(): void {
  if (!existsSync(SETTINGS_PATH)) {
    writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  }
}

export function getSettings(): EngineSettings {
  ensureSettingsFile();
  const data = readFileSync(SETTINGS_PATH, "utf-8");
  return { ...DEFAULT_SETTINGS, ...JSON.parse(data) } as EngineSettings;
}

export function updateSettings(
  updates: Partial<EngineSettings>
): EngineSettings {
  const current = getSettings();
  const updated = { ...current, ...updates };
  writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2));
  return updated;
}

export function resetSettings(): EngineSettings {
  writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  return DEFAULT_SETTINGS;
}
