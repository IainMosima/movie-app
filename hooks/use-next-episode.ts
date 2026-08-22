"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { parseEpisode, sortByEpisode, sortFolderItems } from "@/lib/episode-order";
import { watchUrl, VIDEO_EXT } from "@/lib/watch-url";
import type { LibraryItemWithUsage } from "@/types";

/**
 * "Next episode" means two different things depending on how the series was
 * added, and both shapes exist in a normal library:
 *
 *   - a season pack — one torrent, many files: next is the next FILE
 *   - a folder of per-episode magnets: next is the next ITEM, a whole
 *     different torrent that has to be resolved before we can navigate
 *
 * Either way the ordering has to come from parsed episode numbers. Torrent file
 * order is not episode order (a pack in the library lists E06, E02, E07, E01…),
 * so advancing by file index would skip episodes.
 */
type NextTarget =
  | { kind: "file"; fileIndex: number; name: string; length: number }
  | { kind: "item"; item: LibraryItemWithUsage };

interface TorrentFile {
  index: number;
  name: string;
  length: number;
}

/** Short label for the button — "S03E05" when parseable, else a trimmed name. */
function labelFor(name: string): string {
  const parsed = parseEpisode(name);
  if (parsed) {
    return `S${String(parsed.season).padStart(2, "0")}E${String(parsed.episode).padStart(2, "0")}`;
  }
  const stem = name.replace(/\.[^.]+$/, "");
  return stem.length > 18 ? `${stem.slice(0, 18)}…` : stem;
}

export function useNextEpisode(
  infoHash: string,
  fileIndex: number,
  returnTo: string
) {
  const router = useRouter();
  const [target, setTarget] = useState<NextTarget | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      // 1. Season pack: is there a later file inside this same torrent?
      try {
        const res = await fetch("/api/torrents");
        if (res.ok) {
          const json = await res.json();
          const torrents = Array.isArray(json) ? json : (json.torrents ?? []);
          const torrent = torrents.find(
            (t: { infoHash?: string }) =>
              t.infoHash?.toLowerCase() === infoHash.toLowerCase()
          );
          const videos: TorrentFile[] = (torrent?.files ?? []).filter(
            (f: TorrentFile) => VIDEO_EXT.test(f.name)
          );

          if (videos.length > 1) {
            const ordered = sortByEpisode(videos, (f) => f.name);
            const at = ordered.findIndex((f) => f.index === fileIndex);
            if (at !== -1 && at + 1 < ordered.length) {
              const next = ordered[at + 1];
              if (!cancelled) {
                setTarget({
                  kind: "file",
                  fileIndex: next.index,
                  name: next.name,
                  length: next.length ?? 0,
                });
              }
              return;
            }
            // Last episode of the pack — nothing follows.
            if (!cancelled) setTarget(null);
            return;
          }
        }
      } catch {
        // Fall through to the library lookup.
      }

      // 2. Folder of separate magnets: the next sibling item.
      try {
        const res = await fetch("/api/library");
        if (!res.ok) return;
        const { items } = (await res.json()) as { items: LibraryItemWithUsage[] };

        const current = items.find(
          (i) =>
            i.infoHash?.toLowerCase() === infoHash.toLowerCase() ||
            i.magnet.toLowerCase().includes(infoHash.toLowerCase())
        );
        if (!current?.folderId) {
          if (!cancelled) setTarget(null);
          return;
        }

        const siblings = sortFolderItems(
          items.filter((i) => i.folderId === current.folderId)
        );
        const at = siblings.findIndex((i) => i.id === current.id);
        const next = at !== -1 ? siblings[at + 1] : undefined;
        if (!cancelled) setTarget(next ? { kind: "item", item: next } : null);
      } catch {
        if (!cancelled) setTarget(null);
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [infoHash, fileIndex]);

  const goNext = useCallback(async () => {
    if (!target) return;

    if (target.kind === "file") {
      router.replace(
        watchUrl(infoHash, labelFor(target.name), target.fileIndex, returnTo)
      );
      return;
    }

    // A separate torrent has to be added before the player can stream it —
    // the same step handleResume takes on the home page.
    setIsLoading(true);
    try {
      const res = await fetch("/api/torrent/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet: target.item.magnet }),
      });
      if (!res.ok) throw new Error("Failed to load next episode");
      const data = await res.json();
      router.replace(
        watchUrl(
          data.infoHash,
          target.item.name,
          target.item.fileIndex ?? data.mainVideoIndex ?? 0,
          returnTo
        )
      );
    } catch {
      setIsLoading(false);
    }
  }, [target, infoHash, returnTo, router]);

  return {
    nextLabel: target
      ? labelFor(target.kind === "file" ? target.name : target.item.name)
      : undefined,
    /** The file index of the next episode inside this torrent, if it's a pack. */
    nextFileIndex: target?.kind === "file" ? target.fileIndex : undefined,
    /** Its size on disk, so the caller can check there's room before pulling it. */
    nextFileSize: target?.kind === "file" ? target.length : undefined,
    goNext: target ? goNext : undefined,
    isLoading,
  };
}
