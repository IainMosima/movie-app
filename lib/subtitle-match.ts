import type { TorrentFileInfo } from "@/types";

const VIDEO = /\.(mkv|mp4|m4v|mov|webm|avi)$/i;
const EPISODE = /s(\d{1,2})[ ._-]?e(\d{1,3})/i;

/** The video being watched: the requested file, or the biggest video (a movie). */
export function pickVideo(files: TorrentFileInfo[], fileParam: string | null) {
  const asked = fileParam !== null ? files[parseInt(fileParam, 10)] : undefined;
  if (asked && VIDEO.test(asked.name)) return asked;
  return files
    .filter((f) => VIDEO.test(f.name))
    .reduce<TorrentFileInfo | undefined>((a, b) => (!a || b.length > a.length ? b : a), undefined);
}

function episodeKey(path: string): string | null {
  const m = path.match(EPISODE);
  return m ? `${parseInt(m[1], 10)}x${parseInt(m[2], 10)}` : null;
}

/**
 * Subtitle files belonging to this video. A season pack ships every episode's
 * subs; keep the ones naming the same SxxEyy (in the file or folder name) or
 * sharing the video's name. Nothing matches → it's a movie, offer them all.
 */
export function subsFor(video: TorrentFileInfo | undefined, subs: TorrentFileInfo[]) {
  if (!video) return subs;
  const ep = episodeKey(video.path);
  const stem = video.name.replace(/\.[^.]+$/, "").toLowerCase();
  const mine = subs.filter(
    (s) => (ep && episodeKey(s.path) === ep) || s.name.toLowerCase().startsWith(stem)
  );
  if (mine.length > 0) return mine;
  // Other episodes' subs exist but none for this one — don't show the wrong ones.
  return ep && subs.some((s) => episodeKey(s.path)) ? [] : subs;
}
