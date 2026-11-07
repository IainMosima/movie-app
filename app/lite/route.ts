import { NextRequest, NextResponse } from "next/server";
import {
  getAllItems,
  getFolderById,
  getFolders,
  getItemById,
  getItemsByFolder,
  updateItem,
} from "@/lib/library-store";
import { episodeCode, showName, sortByEpisode } from "@/lib/episode-order";
import { getWatchProgress, listContinue } from "@/lib/watch-store";
import { getTorrentEngine } from "@/lib/torrent-engine";
import { extractInfoHashFromMagnet } from "@/lib/torrent-cache-actions";
import { subsFor } from "@/lib/subtitle-match";
import { isFFmpegAvailable, probeEmbeddedSubtitles } from "@/lib/subtitle-extractor";
import { getDataDir } from "@/lib/data-dir";
import { join } from "path";
import { VIDEO_EXT } from "@/lib/watch-url";
import { resolveItemCategory } from "@/lib/category";
import { lgCompat, LG_TIP } from "@/lib/tv-compat";
import { lanHost } from "@/lib/lan-host";
import type { LibraryItem, TorrentFileInfo, TorrentInfo, WatchRecord } from "@/types";

/**
 * /lite — the whole app as plain server-rendered HTML for old TV browsers
 * (LG webOS 3 = Chromium 38): no React, no modern CSS, ES5-only inline script.
 * Everything below that ends up in the page must stay that way.
 */

const ENGLISH = /\b(en|eng|english)\b/i;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const lite = (params: Record<string, string | number>) =>
  "/lite?" +
  Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

function dn(magnet: string): string | null {
  const m = magnet.match(/[?&]dn=([^&]*)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {
    return m[1];
  }
}

const hashOf = (item: LibraryItem) =>
  (item.infoHash ?? extractInfoHashFromMagnet(item.magnet))?.toLowerCase() ?? null;

function badge(name: string): string {
  const r = lgCompat(name);
  return r.ok
    ? `<span class="ok">&#10003; LG</span>`
    : `<span class="bad">&#10007; LG: ${esc(r.problems.join(", "))}</span>`;
}

function mark(r: WatchRecord | undefined): string {
  if (!r) return "";
  if (r.finished) return `<span class="seen">Watched</span>`;
  if (r.durationSec > 0 && r.positionSec >= 30)
    return `<span class="seen">${Math.round((r.positionSec / r.durationSec) * 100)}%</span>`;
  return "";
}

function findRecord(records: WatchRecord[], hash: string | null, fileIndex?: number) {
  if (!hash) return undefined;
  return records.find(
    (r) => r.infoHash.toLowerCase() === hash && (fileIndex === undefined || r.fileIndex === fileIndex)
  );
}

function row(href: string, label: string, extra = ""): string {
  return `<a class="row" href="${esc(href)}"><span class="name">${esc(label)}</span>${extra}</a>`;
}

const CSS = `
body{margin:0;background:#0b0b0f;color:#e8e6ef;font-family:sans-serif;font-size:28px;line-height:1.4}
.wrap{padding:24px 48px 64px}
h1{font-size:44px;margin:0}
h2{font-size:30px;color:#b9a8ff;margin:36px 0 12px;font-weight:normal}
a{color:#e8e6ef}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.full{font-size:20px;color:#9a97a8;padding:8px 14px;border:3px solid transparent;border-radius:8px}
a.row{display:flex;align-items:center;padding:18px 24px;margin:0 0 10px;background:#1a1a22;border-radius:10px;text-decoration:none;border:3px solid transparent}
a.row:focus,a.row:hover,.full:focus,.full:hover,.bar a:focus,.bar a:hover{border-color:#a78bfa;background:#262233;outline:none}
.name{flex:1}
.ok{color:#4ade80;font-size:22px;margin-left:16px}
.bad{color:#fbbf24;font-size:22px;margin-left:16px}
.seen{color:#9a97a8;font-size:22px;margin-left:16px}
.muted{color:#9a97a8}
.bar{display:flex;align-items:center;height:72px;padding:0 16px;background:#14141b}
.bar a{padding:8px 20px;margin-right:16px;border:3px solid transparent;border-radius:8px;background:#1f1f29;text-decoration:none;white-space:nowrap}
.bar .t{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-right:16px}
.warn{background:#3a2a05;color:#fbbf24;padding:10px 24px;font-size:22px}
video{display:block;width:100%;height:calc(100vh - 72px);background:#050507}
`;

function html(title: string, body: string, opts: { refresh?: boolean; status?: number } = {}) {
  const doc = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${opts.refresh ? '<meta http-equiv="refresh" content="3">' : ""}
<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
  return new NextResponse(doc, {
    status: opts.status ?? 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const loading = (what: string) =>
  html(
    "Loading…",
    `<div class="wrap"><h1>Loading…</h1><p class="muted">Finding the files for ${esc(what)}. This page refreshes by itself.</p>${row("/lite", "Back")}</div>`,
    { refresh: true }
  );

const notFound = (what: string) =>
  html("Not found", `<div class="wrap"><h1>${esc(what)} not found</h1>${row("/lite", "Back")}</div>`, {
    status: 404,
  });

// One add per magnet at a time: the Loading page refreshes every 3s and must not
// stack a fresh 60s metadata poll on each refresh.
const adding = new Map<string, Promise<TorrentInfo | null>>();

/** The torrent with its file list, or null while metadata is still loading. */
async function loadTorrent(magnet: string, hash: string | null): Promise<TorrentInfo | null> {
  const engine = getTorrentEngine();
  if (hash) {
    const t = await engine.getTorrent(hash).catch(() => null);
    if (t?.ready && t.files.length) return t;
  }
  let p = adding.get(magnet);
  if (!p) {
    p = engine
      .addTorrent(magnet)
      .catch(() => null)
      .finally(() => adding.delete(magnet));
    adding.set(magnet, p);
  }
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 2500))]);
}

/** loadTorrent for a library item, recording its real infoHash/folder like /api/torrent/files does. */
async function loadItem(item: LibraryItem): Promise<TorrentInfo | null> {
  const t = await loadTorrent(item.magnet, hashOf(item));
  const hash = t?.infoHash?.toLowerCase();
  if (t && hash && (item.infoHash !== hash || item.cacheFolder !== t.name)) {
    try {
      updateItem(item.id, { cacheFolder: t.name, infoHash: hash });
    } catch {
      // bookkeeping only
    }
  }
  return t;
}

const videosOf = (t: TorrentInfo) =>
  sortByEpisode(
    t.files.filter((f) => VIDEO_EXT.test(f.name)),
    (f) => f.name
  );

const biggest = (files: TorrentFileInfo[]) =>
  files.reduce<TorrentFileInfo | undefined>((a, b) => (!a || b.length > a.length ? b : a), undefined);

const episodeTitle = (show: string, fileName: string) => {
  const code = episodeCode(fileName);
  return code ? `${showName(show)} · ${code}` : showName(fileName);
};

// --- Pages ---

async function homePage() {
  const records = getWatchProgress().records;
  const cont = await listContinue().catch(() => [] as WatchRecord[]);

  const contRows = cont
    .map((r) => {
      const u = r.upNext;
      if (!u) {
        return row(
          lite({ play: r.infoHash, file: r.fileIndex, title: r.title }),
          r.title,
          badge(dn(r.magnet) ?? r.title) + mark(r)
        );
      }
      const hash = extractInfoHashFromMagnet(u.magnet);
      const href = u.pickFrom
        ? lite({ item: u.pickFrom })
        : u.libraryItemId
          ? lite({ play: `item:${u.libraryItemId}` })
          : hash && u.fileIndex !== undefined
            ? lite({ play: hash, file: u.fileIndex, title: u.title })
            : null;
      return href ? row(href, `Up next: ${u.title}`, badge(dn(u.magnet) ?? u.title)) : "";
    })
    .join("");

  const folderRows = getFolders()
    .map((f) => row(lite({ folder: f.id }), f.name, `<span class="seen">${getItemsByFolder(f.id).length}</span>`))
    .join("");

  const itemRows = getAllItems()
    .filter((i) => !i.folderId)
    .map((i) => {
      const isPack = i.fileIndex === undefined && resolveItemCategory(i) === "series";
      const href = isPack ? lite({ item: i.id }) : lite({ play: `item:${i.id}` });
      return row(href, showName(i.name), badge(dn(i.magnet) ?? i.name) + mark(findRecord(records, hashOf(i), i.fileIndex)));
    })
    .join("");

  const section = (h: string, rows: string) => (rows ? `<h2>${h}</h2>${rows}` : "");
  return html(
    "Spaceflix",
    `<div class="wrap"><div class="top"><h1>Spaceflix</h1><a class="full" href="/?full=1">Full app</a></div>
${section("Continue", contRows)}${section("Folders", folderRows)}${section("Library", itemRows)}
${contRows || folderRows || itemRows ? "" : '<p class="muted">The library is empty. Add something from the full app.</p>'}</div>`
  );
}

function folderPage(id: string) {
  const folder = getFolderById(id);
  if (!folder) return notFound("Folder");
  const records = getWatchProgress().records;
  const rows = getItemsByFolder(id)
    .map((i) => {
      const code = episodeCode(i.name);
      const rest = showName(i.name);
      const label = code && rest !== code ? `${code} · ${rest}` : (code ?? rest);
      return row(
        lite({ play: `item:${i.id}` }),
        label,
        badge(dn(i.magnet) ?? i.name) + mark(findRecord(records, hashOf(i), i.fileIndex))
      );
    })
    .join("");
  return html(
    folder.name,
    `<div class="wrap"><div class="top"><h1>${esc(folder.name)}</h1><a class="full" href="/lite">Back</a></div>${rows || '<p class="muted">Empty folder.</p>'}</div>`
  );
}

async function itemPage(id: string) {
  const item = getItemById(id);
  if (!item) return notFound("Item");
  const t = await loadItem(item);
  if (!t) return loading(showName(item.name));
  const hash = t.infoHash.toLowerCase();
  const records = getWatchProgress().records;
  const rows = videosOf(t)
    .map((f) =>
      row(
        lite({ play: hash, file: f.index, title: episodeTitle(item.name, f.name) }),
        episodeCode(f.name) ?? f.name,
        badge(f.name) + mark(findRecord(records, hash, f.index))
      )
    )
    .join("");
  return html(
    showName(item.name),
    `<div class="wrap"><div class="top"><h1>${esc(showName(item.name))}</h1><a class="full" href="/lite">Back</a></div>${rows || '<p class="muted">No video files in this torrent.</p>'}</div>`
  );
}

async function playItem(id: string) {
  const item = getItemById(id);
  if (!item) return notFound("Item");
  const t = await loadItem(item);
  if (!t) return loading(showName(item.name));
  const video =
    (item.fileIndex !== undefined && t.files.find((f) => f.index === item.fileIndex)) ||
    biggest(t.files.filter((f) => VIDEO_EXT.test(f.name)));
  if (!video) return notFound("Video file");
  // Folder episodes are named "S01E04"; the show's name is the folder's.
  const show = (item.folderId && getFolderById(item.folderId)?.name) || item.name;
  const title = episodeCode(video.name)
    ? episodeTitle(show, video.name)
    : episodeCode(item.name)
      ? `${showName(show)} · ${episodeCode(item.name)}`
      : showName(item.name);
  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: lite({ play: t.infoHash.toLowerCase(), file: video.index, title }),
      "Cache-Control": "no-store",
    },
  });
}

async function playPage(req: NextRequest, hash: string, fileParam: string | null, titleParam: string | null) {
  const file = parseInt(fileParam ?? "", 10);
  const items = getAllItems();
  const item =
    items.find((i) => hashOf(i) === hash && i.fileIndex === file) ?? items.find((i) => hashOf(i) === hash);
  const t = await loadTorrent(item?.magnet ?? `magnet:?xt=urn:btih:${hash}`, hash);
  if (!t) return loading(titleParam || "this video");

  const videos = videosOf(t);
  const video = videos.find((f) => f.index === file) ?? biggest(videos);
  if (!video) return notFound("Video file");
  const title = titleParam || episodeTitle(item?.name ?? t.name, video.name);

  // Next: the next episode in this pack, else the next item in the folder.
  const at = videos.indexOf(video);
  const nextFile = videos.length > 1 ? videos[at + 1] : undefined;
  let next: string | null = null;
  if (nextFile) {
    next = lite({ play: hash, file: nextFile.index, title: episodeTitle(title, nextFile.name) });
  } else if (item?.folderId) {
    const siblings = getItemsByFolder(item.folderId);
    const sib = siblings[siblings.findIndex((i) => i.id === item.id) + 1];
    if (sib) next = lite({ play: `item:${sib.id}` });
  }
  const back = item?.folderId
    ? lite({ folder: item.folderId })
    : item && videos.length > 1
      ? lite({ item: item.id })
      : "/lite";

  // A subtitle file shipped with this episode, English first.
  const subs = subsFor(
    video,
    t.files.filter((f) => /\.(srt|vtt)$/i.test(f.name))
  );
  const sub = subs.find((s) => ENGLISH.test(s.name)) ?? subs[0];
  // Else the video's own English track. While the episode is still downloading
  // that file only covers what's on disk, so the page re-fetches it each minute.
  let subSrc = sub ? `/api/subtitle/${hash}?sub=${sub.index}` : "";
  let refreshSubs = false;
  if (!subSrc && /\.(mkv|mp4|m4v|mov|webm)$/i.test(video.name) && (await isFFmpegAvailable())) {
    const tracks = await probeEmbeddedSubtitles(join(getDataDir(), "cache", video.path)).catch(
      () => []
    );
    const emb = tracks.find((tr) => ENGLISH.test(`${tr.language} ${tr.title}`)) ?? tracks[0];
    if (emb) {
      subSrc = `/api/subtitle/${hash}?embedded=${emb.streamIndex}&file=${video.index}`;
      refreshSubs = (video.progress ?? 0) < 1;
    }
  }
  const track = subSrc
    ? `<track id="s" kind="subtitles" srclang="en" label="English" default src="${esc(subSrc)}">`
    : "";

  const compat = lgCompat(video.name);
  const warn = compat.ok
    ? ""
    : `<div class="warn">This file may not play on this TV: ${esc(compat.problems.join(", "))}. ${esc(LG_TIP)}</div>`;

  const port = await getTorrentEngine().getWorkerPort();
  const src = `http://${lanHost(req)}:${port}/stream/${hash}?file=${video.index}`;

  // Data for the inline script; "<" and line separators escaped so it can't end
  // the <script> or break an ES5 parser.
  const data = JSON.stringify({ h: hash, f: video.index, t: title, next, rs: refreshSubs ? subSrc : null })
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

  // ES5 only (Chromium 38): var/function/XMLHttpRequest, no arrows, no fetch.
  const script = `(function(){
var D=${data},v=document.getElementById("v");
function send(pos,len){var x=new XMLHttpRequest();x.open("POST","/api/progress",true);x.setRequestHeader("Content-Type","application/json");x.send(JSON.stringify({infoHash:D.h,fileIndex:D.f,positionSec:pos,durationSec:len,title:D.t}));}
function dur(){return isFinite(v.duration)?v.duration:0;}
function save(){if(v.currentTime>0)send(v.currentTime,dur());}
v.addEventListener("loadedmetadata",function(){
var x=new XMLHttpRequest();x.open("GET","/api/progress/"+D.h+"?file="+D.f,true);
x.onload=function(){try{var r=JSON.parse(x.responseText).record;if(r&&!r.finished&&r.positionSec>0)v.currentTime=r.positionSec;}catch(e){}};
x.send();
},false);
v.addEventListener("pause",save,false);
v.addEventListener("ended",function(){var d=dur()||v.currentTime;send(d,d);if(D.next)setTimeout(function(){location.href=D.next;},1500);},false);
setInterval(function(){if(!v.paused)save();},15000);
if(D.rs){setInterval(function(){var s=document.getElementById("s");if(!s)return;s.src=D.rs+"&t="+(+new Date());if(s.track)s.track.mode="showing";},60000);}
try{v.focus();}catch(e){}
})();`;

  return html(
    title,
    `<div class="bar"><a href="${esc(back)}">Back</a><span class="t">${esc(title)}</span>${next ? `<a href="${esc(next)}">Next episode</a>` : ""}</div>
${warn}<video id="v" controls autoplay preload="auto" src="${esc(src)}">${track}</video>
<script>${script}</script>`
  );
}

// GET /lite[?folder=|?item=|?play=item:<id>|?play=<hash>&file=N&title=T]
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const play = sp.get("play");
    if (play?.startsWith("item:")) return await playItem(play.slice(5));
    if (play) {
      // Goes into URLs and the page: hex or base32 hash only.
      if (!/^[a-z0-9]{32,40}$/i.test(play)) return notFound("Video");
      return await playPage(req, play.toLowerCase(), sp.get("file"), sp.get("title"));
    }
    const folder = sp.get("folder");
    if (folder) return folderPage(folder);
    const item = sp.get("item");
    if (item) return await itemPage(item);
    return await homePage();
  } catch (e) {
    console.error("/lite failed:", e);
    return html(
      "Error",
      `<div class="wrap"><h1>Something went wrong</h1><p class="muted">${esc(e instanceof Error ? e.message : String(e))}</p>${row("/lite", "Back")}</div>`,
      { status: 500 }
    );
  }
}
