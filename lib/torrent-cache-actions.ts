export function extractInfoHashFromMagnet(magnet: string): string | null {
  const m = magnet.match(/[?&]xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  if (m) return m[1].toLowerCase();
  return null;
}

/**
 * Ask the worker to purge one file's bytes (it also flips the piece bitfield so
 * the file re-downloads cleanly if re-selected). Returns false when the worker
 * isn't running or the torrent isn't active, so callers can fall back to
 * deleting the file straight off disk.
 */
export async function clearFileFromWorker(
  infoHash: string,
  fileIndex: number
): Promise<boolean> {
  try {
    const portRes = await fetch("http://localhost:8181/api/worker-port");
    if (!portRes.ok) return false;
    const { port } = await portRes.json();
    const res = await fetch(
      `http://localhost:${port}/torrent/${infoHash}/file?index=${fileIndex}`,
      { method: "DELETE" }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteFromWorker(infoHash: string, itemName?: string): Promise<void> {
  try {
    const portRes = await fetch("http://localhost:8181/api/worker-port");
    if (!portRes.ok) return;
    const { port } = await portRes.json();
    const nameParam = itemName ? `?name=${encodeURIComponent(itemName)}` : "";
    await fetch(`http://localhost:${port}/torrent/${infoHash}${nameParam}`, { method: "DELETE" });
  } catch {
    // Worker may not be running — files already gone or will be cleaned up
  }
}
