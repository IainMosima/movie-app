export function extractInfoHashFromMagnet(magnet: string): string | null {
  const m = magnet.match(/[?&]xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  if (m) return m[1].toLowerCase();
  return null;
}

export async function clearFileFromWorker(infoHash: string, fileIndex: number): Promise<void> {
  try {
    const portRes = await fetch("http://localhost:8181/api/worker-port");
    if (!portRes.ok) return;
    const { port } = await portRes.json();
    await fetch(`http://localhost:${port}/torrent/${infoHash}/file?index=${fileIndex}`, { method: "DELETE" });
  } catch {}
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
