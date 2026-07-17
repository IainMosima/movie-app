import "server-only";
import { resolve, join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

// Root the in-app folder picker browses/switches within. In Docker this is the
// fixed internal mount point (baked into the image); locally it defaults to the
// project directory, matching today's ./data convention.
export function getMediaRoot(): string {
  return resolve(process.env.MEDIA_ROOT || process.cwd());
}

function pointerPath(): string {
  return join(getMediaRoot(), ".active-data-dir");
}

// Resolution order: runtime pointer (set via the Settings picker) > DATA_DIR env
// (explicit/script override) > ./data next to the project (today's exact default).
export function getDataDir(): string {
  const p = pointerPath();
  if (existsSync(p)) {
    const stored = readFileSync(p, "utf-8").trim();
    if (stored) return resolve(stored);
  }
  const envDir = process.env.DATA_DIR;
  return envDir ? resolve(envDir) : resolve(process.cwd(), "data");
}

export function setDataDir(newPath: string): string {
  const abs = resolve(newPath);
  mkdirSync(abs, { recursive: true });
  writeFileSync(pointerPath(), abs);
  return abs;
}
