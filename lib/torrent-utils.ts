/** Returns true if input is a magnet URI or an HTTP(S) .torrent URL */
export function isValidTorrentInput(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.startsWith("magnet:?")) return true;
  try {
    const url = new URL(trimmed);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.pathname.toLowerCase().endsWith(".torrent")
    );
  } catch {
    return false;
  }
}

/** Extract a human-readable title from a magnet URI or .torrent URL */
export function extractTitleFromInput(input: string): string {
  // Try magnet dn= parameter first
  const dnMatch = input.match(/dn=([^&]+)/);
  if (dnMatch) return decodeURIComponent(dnMatch[1].replace(/\+/g, " "));

  // Try URL filename
  try {
    const url = new URL(input);
    const filename = decodeURIComponent(url.pathname.split("/").pop() || "");
    return filename.replace(/\.torrent$/i, "") || "Unknown";
  } catch {
    return "Unknown";
  }
}

/** Extract infoHash from magnet URI, returns null for .torrent URLs */
export function extractInfoHash(input: string): string | null {
  const match = input.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  return match ? match[1].toLowerCase() : null;
}
