import type { LibraryCategory, LibraryItem, LibraryFolder } from "@/types";

// Release naming that means "this is an episode / a season", not a film.
// Matched against the item name AND the raw magnet, since the magnet's dn=
// carries the full release name (e.g. dn=Invincible.2021.S04E07.1080p.WEB...).
const SERIES_PATTERNS: RegExp[] = [
  /\bs\d{1,2}[\s._-]?e\d{1,3}\b/i, // S04E07, S4.E7
  /\bseason[\s._-]*\d{1,2}\b/i, // Season 4
  /\bcomplete[\s._-]*(series|season)\b/i, // Complete Series
  /\b\d{1,2}x\d{2}\b/, // 4x07
  /\bs\d{2}\b/i, // S04 (season pack)
  /\bepisode[\s._-]*\d{1,3}\b/i, // Episode 7
];

/** Best guess at a category from any text we have about a title. */
export function detectCategory(
  ...parts: (string | null | undefined)[]
): LibraryCategory {
  const haystack = parts.filter(Boolean).join(" ");
  return SERIES_PATTERNS.some((re) => re.test(haystack)) ? "series" : "movie";
}

/** An explicit choice always wins; otherwise fall back to detection. */
export function resolveItemCategory(item: LibraryItem): LibraryCategory {
  return item.category ?? detectCategory(item.name, item.magnet);
}

/**
 * A folder's category: explicit choice, else whatever most of its contents
 * are, else a guess from the folder's own name (an empty "Alien Collection"
 * should still land under Movies).
 */
export function resolveFolderCategory(
  folder: LibraryFolder,
  items: LibraryItem[]
): LibraryCategory {
  if (folder.category) return folder.category;

  let series = 0;
  let movie = 0;
  for (const item of items) {
    if (resolveItemCategory(item) === "series") series++;
    else movie++;
  }
  if (series || movie) return series >= movie ? "series" : "movie";

  return detectCategory(folder.name);
}
