/**
 * Episode ordering.
 *
 * Neither of the obvious approaches works on real data:
 *
 *   - Torrent file order isn't episode order. A season pack in the library
 *     right now lists E06, E02, E07, E01, E03, E08, E04, E05 — so "next
 *     episode" by file index would skip an episode.
 *   - Alphabetical isn't either. Items get named by hand, so one folder holds
 *     "Silo.S03E08", "silo s03e06", "Silo S03E05" — mixed case and mixed
 *     separators. Sorting those as strings compares the "." against the " "
 *     long before it reaches the episode number, and even a numeric-aware
 *     collator gets it wrong for the same reason.
 *
 * So pull the season and episode numbers out and sort on those, and keep the
 * string collator only as the fallback for names that carry no episode at all.
 */

export interface EpisodeNumber {
  season: number;
  episode: number;
}

// Capture-group counterparts of the detection patterns in lib/category.ts.
// Ordered most-specific first: "3x04" would otherwise be missed by an S/E match
// and "Season 3" alone must not beat a full "S03E04" appearing later in a name.
const EPISODE_PATTERNS: RegExp[] = [
  /\bs(\d{1,2})[\s._-]*e(\d{1,3})\b/i, // S03E04, S3.E4, s03 e04
  /\b(\d{1,2})x(\d{2,3})\b/, // 3x04
  /\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b/i, // Season 3 Episode 4
];

// Episode number with no season attached — "Episode 7", "- 07 -". Treated as
// season 1 so it still orders sensibly against S01Exx siblings.
const EPISODE_ONLY = /\bepisode[\s._-]*(\d{1,3})\b/i;

/** Season/episode numbers from a release or item name, or null if absent. */
export function parseEpisode(name: string): EpisodeNumber | null {
  if (!name) return null;

  for (const pattern of EPISODE_PATTERNS) {
    const match = name.match(pattern);
    if (match) {
      return { season: Number(match[1]), episode: Number(match[2]) };
    }
  }

  const episodeOnly = name.match(EPISODE_ONLY);
  if (episodeOnly) {
    return { season: 1, episode: Number(episodeOnly[1]) };
  }

  return null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Standard "S01E01" code for a name, or null when no episode parses. */
export function episodeCode(name: string): string | null {
  const parsed = parseEpisode(name);
  return parsed ? `S${pad2(parsed.season)}E${pad2(parsed.episode)}` : null;
}

/**
 * Natural string comparison — the one sort in the codebase that already got
 * E2-before-E10 right (it was inlined in the file picker). `numeric` handles
 * unpadded numbers, `base` sensitivity ignores case and accents.
 */
export const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Order two names as episodes. Anything with a parseable episode sorts ahead of
 * anything without, so a stray "extras.mkv" lands at the end of a season rather
 * than in the middle of it.
 */
export function compareEpisodes(a: string, b: string): number {
  const left = parseEpisode(a);
  const right = parseEpisode(b);

  if (left && right) {
    if (left.season !== right.season) return left.season - right.season;
    if (left.episode !== right.episode) return left.episode - right.episode;
    // Same episode, different releases — fall through to the name.
    return naturalCollator.compare(a, b);
  }

  if (left) return -1;
  if (right) return 1;

  return naturalCollator.compare(a, b);
}

/** Copy of `items` in episode order. Never mutates the input. */
export function sortByEpisode<T>(items: T[], getName: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareEpisodes(getName(a), getName(b)));
}

/**
 * A folder's contents in display order.
 *
 * A manual arrangement wins, but only when *every* item carries a sortOrder.
 * A half-arranged folder would otherwise interleave unpositioned episodes
 * unpredictably, which reads as a bug rather than a partial preference.
 *
 * Shared by the server store and the folder dialog so both agree — the home
 * page hands the dialog a plain filtered array, bypassing the store entirely.
 */
export function sortFolderItems<
  T extends { name: string; sortOrder?: number },
>(items: T[]): T[] {
  const allPositioned =
    items.length > 0 && items.every((i) => typeof i.sortOrder === "number");

  if (allPositioned) {
    return [...items].sort((a, b) => a.sortOrder! - b.sortOrder!);
  }

  return sortByEpisode(items, (i) => i.name);
}

// First token that ends a show's name in a release title: season/episode,
// "Season 2", a year, a resolution or a source tag.
const RELEASE_JUNK =
  /\b(s\d{1,2}(e\d{1,3})?|\d{1,2}x\d{2,3}|season|(19|20)\d{2}|\d{3,4}p|web[- ]?(dl|rip)|bluray|brrip|hdtv|x26[45]|h ?26[45])\b/i;

/**
 * Readable show name from a release or record title:
 * "IT.Welcome.To.Derry.S01E04.1080p" → "IT Welcome To Derry". Anything after a
 * " · " is the episode part of our own titles and goes too. Never returns empty:
 * a name that is all junk comes back as given.
 */
export function showName(title: string): string {
  const spaced = title.split(" · ")[0].replace(/[._]+/g, " ").trim();
  // Search from the second character so a title that starts with a year
  // ("2001 A Space Odyssey") keeps it.
  const cut = spaced.slice(1).search(RELEASE_JUNK);
  const name = (cut < 0 ? spaced : spaced.slice(0, cut + 1))
    .replace(/[\s\-([]+$/, "")
    .trim();
  return name || title.trim();
}
