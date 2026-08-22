/** Extensions the worker treats as playable video (torrent-worker.mjs:232). */
export const VIDEO_EXT = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv)$/i;

/**
 * Player URL. `from` is where Close and the browser's back button return to —
 * the card you opened, not a bare home page.
 */
export function watchUrl(
  infoHash: string,
  title: string,
  fileIndex: number,
  from: string
) {
  return (
    `/watch/${infoHash}?title=${encodeURIComponent(title)}` +
    `&file=${fileIndex}&from=${encodeURIComponent(from)}`
  );
}
