/** Playlist link VLC opens directly (M3U with subtitles). Client-safe. */
export function vlcLink(origin: string, infoHash: string, fileIndex?: number, title?: string): string {
  const q = new URLSearchParams();
  if (fileIndex !== undefined) q.set("file", String(fileIndex));
  if (title) q.set("title", title);
  const qs = q.toString();
  return `${origin}/api/vlc/${infoHash}${qs ? `?${qs}` : ""}`;
}
