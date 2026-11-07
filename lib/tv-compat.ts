/**
 * Will this release play in a 2017 LG webOS TV browser (Chromium 38)?
 * Judged from the release/file name only — no conversion is ever done. That
 * browser reliably plays H.264 8-bit ≤1080p with AAC/MP3 audio in MP4.
 */

const RULES: Array<[RegExp, string]> = [
  [/\b(x\.?265|h\.?265|hevc)\b/i, "x265 video"],
  [/\b10[ .-]?bit\b/i, "10-bit"],
  [/\b(hdr(10)?(\+|plus)?|dv|dovi|dolby[ .-]?vision)\b/i, "HDR / Dolby Vision"],
  [/\bav1\b/i, "AV1 video"],
  [/\b(2160p|4k|uhd)\b/i, "4K"],
  [/\.mkv$/i, "MKV file"],
  [/\b(atmos|truehd|dts(-?hd)?|e-?ac-?3|ac-?3|ddp|ddp?[ .]?[257][ .][01])\b|\bdd\+/i, "Dolby/DTS audio"],
];

export const LG_TIP = "Look for: x264 (H.264) · 1080p or 720p · AAC audio · MP4";

export function lgCompat(name: string): { ok: boolean; problems: string[] } {
  // Dots and underscores are word separators in release names.
  const text = name.replace(/[._]/g, " ").replace(/ (mkv|mp4|avi)$/i, ".$1");
  const problems = RULES.filter(([re]) => re.test(text)).map(([, label]) => label);
  return { ok: problems.length === 0, problems };
}
