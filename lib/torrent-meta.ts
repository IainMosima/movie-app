import "server-only";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "@/lib/data-dir";

/**
 * A torrent's file list, kept on disk so "what's the next episode" still works
 * after a restart, when the worker no longer has the pack loaded. Filled lazily:
 * any pack opened once is remembered.
 */
export interface TorrentMeta {
  name: string;
  files: { index: number; name: string; length: number }[];
}

// The hash reaches here from request bodies too; keep it a plain filename.
function metaPath(hash: string): string {
  if (!/^[a-z0-9]+$/i.test(hash)) throw new Error(`Bad infoHash: ${hash}`);
  return join(getDataDir(), "meta", `${hash.toLowerCase()}.json`);
}

/** Write the meta if it changed. Bookkeeping only: never throws. */
export function saveMeta(hash: string, meta: TorrentMeta): void {
  try {
    if (!meta.files.length) return;
    const json = JSON.stringify({
      name: meta.name,
      files: meta.files.map(({ index, name, length }) => ({ index, name, length })),
    });
    const path = metaPath(hash);
    if (existsSync(path) && readFileSync(path, "utf-8") === json) return;
    mkdirSync(join(getDataDir(), "meta"), { recursive: true });
    writeFileSync(path, json);
  } catch (e) {
    console.error("Failed to save torrent meta:", e);
  }
}

export function loadMeta(hash: string): TorrentMeta | null {
  try {
    const path = metaPath(hash);
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as TorrentMeta;
    return Array.isArray(parsed?.files) ? parsed : null;
  } catch {
    return null;
  }
}
