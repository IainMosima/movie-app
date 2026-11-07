#!/usr/bin/env node
// Rename every item in a series folder to its standard "S01E01" code.
// Same rule as applyEpisodeName in lib/library-store.ts; regexes duplicated
// from lib/episode-order.ts and lib/category.ts (plain node can't import TS).
//
//   node scripts/normalize-episodes.mjs           dry run
//   node scripts/normalize-episodes.mjs --write   backup + write
//   node scripts/normalize-episodes.mjs --check   self-test
import { readFileSync, writeFileSync, copyFileSync } from "fs";
import assert from "assert/strict";

const EPISODE_PATTERNS = [
  /\bs(\d{1,2})[\s._-]*e(\d{1,3})\b/i,
  /\b(\d{1,2})x(\d{2,3})\b/,
  /\bseason[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})\b/i,
];
const EPISODE_ONLY = /\bepisode[\s._-]*(\d{1,3})\b/i;
const SERIES_PATTERNS = [
  /\bs\d{1,2}[\s._-]?e\d{1,3}\b/i,
  /\bseason[\s._-]*\d{1,2}\b/i,
  /\bcomplete[\s._-]*(series|season)\b/i,
  /\b\d{1,2}x\d{2}\b/,
  /\bs\d{2}\b/i,
  /\bepisode[\s._-]*\d{1,3}\b/i,
];

function parseEpisode(name) {
  if (!name) return null;
  for (const re of EPISODE_PATTERNS) {
    const m = name.match(re);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  }
  const m = name.match(EPISODE_ONLY);
  return m ? { season: 1, episode: Number(m[1]) } : null;
}

const pad2 = (n) => String(n).padStart(2, "0");
const code = (e) => (e ? `S${pad2(e.season)}E${pad2(e.episode)}` : null);
const isSeries = (...parts) =>
  SERIES_PATTERNS.some((re) => re.test(parts.filter(Boolean).join(" ")));

function folderIsSeries(folder, items) {
  if (folder.category) return folder.category === "series";
  const series = items.filter((i) => i.category ? i.category === "series" : isSeries(i.name, i.magnet)).length;
  return items.length ? series >= items.length - series : isSeries(folder.name);
}

/** Mutates data; returns [{ folder, from, to }]. Items handled in order, so
 *  each unparseable one numbers after the codes already settled. */
function normalize(data) {
  const changes = [];
  for (const folder of data.folders ?? []) {
    const items = data.items.filter((i) => i.folderId === folder.id);
    if (!folderIsSeries(folder, items)) continue;
    for (const item of items) {
      const dn = new URLSearchParams((item.magnet ?? "").split("?")[1] ?? "").get("dn");
      let to = code(parseEpisode(item.name)) ?? code(parseEpisode(dn ?? ""));
      if (!to) {
        let last = null;
        for (const i of items) {
          const e = i === item ? null : parseEpisode(i.name);
          if (e && (!last || e.season > last.season || (e.season === last.season && e.episode > last.episode))) last = e;
        }
        to = code({ season: last?.season ?? 1, episode: (last?.episode ?? 0) + 1 });
      }
      if (to !== item.name) {
        changes.push({ folder: folder.name, from: item.name, to });
        item.name = to;
      }
    }
  }
  return changes;
}

const args = process.argv.slice(2);

if (args.includes("--check")) {
  const lib = (cat, names) => ({
    folders: [{ id: "f", name: "Show", ...(cat ? { category: cat } : {}) }],
    items: names.map((name, n) => ({ id: `i${n}`, name, magnet: `magnet:?xt=urn:btih:${n}`, folderId: "f" })),
  });
  let d = lib("series", ["Get Jiro S01E02"]);
  normalize(d);
  assert.equal(d.items[0].name, "S01E02");
  d = lib("series", ["S01E01", "S01E02", "S01E03", "random title"]);
  normalize(d);
  assert.equal(d.items[3].name, "S01E04");
  d = lib("movie", ["Alien S01E02", "whatever"]);
  assert.deepEqual(normalize(d), []);
  d = lib(undefined, ["The.Matrix.1999.1080p"]);
  assert.deepEqual(normalize(d), []);
  console.log("check ok");
  process.exit(0);
}

const path = new URL("../data/library.json", import.meta.url);
const data = JSON.parse(readFileSync(path, "utf-8"));
const changes = normalize(data);
for (const c of changes) console.log(`${c.folder}: ${c.from} → ${c.to}`);
console.log(`${changes.length} rename(s)${args.includes("--write") ? "" : " (dry run, pass --write to apply)"}`);

if (args.includes("--write") && changes.length) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  copyFileSync(path, new URL(`../data/library.backup-${stamp}.json`, import.meta.url));
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`wrote data/library.json (backup data/library.backup-${stamp}.json)`);
}
