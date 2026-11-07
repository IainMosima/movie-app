import { NextRequest, NextResponse } from "next/server";
import { getTorrentEngine } from "@/lib/torrent-engine";
import { pickVideo, subsFor } from "@/lib/subtitle-match";
import { episodeCode } from "@/lib/episode-order";
import { lanHost } from "@/lib/lan-host";
import { getAllItems } from "@/lib/library-store";
import { extractInfoHashFromMagnet } from "@/lib/torrent-cache-actions";

const ADD_TIMEOUT_MS = 25_000;
const ENGLISH = /\b(en|eng|english)\b/i;

/**
 * Everything an external player needs for one video.
 * `?format=json` → URLs for the app's VLC dialog; default → an M3U playlist VLC
 * opens directly, with English subtitles switched on.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ infoHash: string }> }
) {
  const { infoHash } = await params;
  const sp = req.nextUrl.searchParams;
  const rawTitle = sp.get("title") || "Video";

  const engine = getTorrentEngine();
  const [found, workerPort] = await Promise.all([
    engine.getTorrent(infoHash),
    engine.getWorkerPort(),
  ]);
  let torrent = found;
  // A copied link can be opened in VLC long after (or before) the torrent was
  // loaded in the app — load it now so the link always works.
  if (!torrent) {
    const hash = infoHash.toLowerCase();
    const item = getAllItems().find(
      (i) => (i.infoHash ?? extractInfoHashFromMagnet(i.magnet))?.toLowerCase() === hash
    );
    try {
      torrent = await Promise.race([
        engine.addTorrent(item?.magnet ?? `magnet:?xt=urn:btih:${hash}`),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), ADD_TIMEOUT_MS)
        ),
      ]);
    } catch {
      return NextResponse.json({ error: "Still loading, try again" }, { status: 503 });
    }
  }

  const video = pickVideo(torrent.files, sp.get("file"));
  if (!video) return NextResponse.json({ error: "No video file" }, { status: 404 });

  // "Derry" → "Derry · S01E04" so VLC shows which episode is playing.
  const code = episodeCode(video.name);
  const title =
    code && !rawTitle.includes(code) ? `${rawTitle} · ${code}` : rawTitle;
  const host = lanHost(req);
  const appBase = `http://${host}:${req.nextUrl.port || "8181"}`;
  const streamUrl = `http://${host}:${workerPort}/stream/${infoHash}?file=${video.index}`;
  const q = `file=${video.index}&title=${encodeURIComponent(rawTitle)}`;
  const playlistUrl = `${appBase}/api/vlc/${infoHash}?${q}`;

  // Subtitle file shipped with this episode (English first).
  const subs = subsFor(
    video,
    torrent.files.filter((f) => /\.(srt|vtt)$/i.test(f.name))
  );
  const external = subs.find((s) => ENGLISH.test(s.name)) ?? subs[0];
  const subUrl = external ? `${appBase}/api/vlc/${infoHash}/sub-${external.index}.vtt` : null;

  // Built-in tracks travel inside the stream itself; VLC plays them directly.
  // (Not extracted here: a file cut from a half-downloaded episode is mostly
  // empty and would override VLC's own, complete track.)

  if (sp.get("format") === "json") {
    return NextResponse.json({
      streamUrl,
      playlistUrl,
      subUrl,
      title,
      fileIndex: video.index,
    });
  }

  const lines = ["#EXTM3U", "#EXTVLCOPT:sub-language=eng,en,English"];
  if (subUrl) lines.push(`#EXTVLCOPT:input-slave=${subUrl}`);
  lines.push(`#EXTINF:-1,${title.replace(/[\r\n]/g, " ")}`, streamUrl, "");
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "audio/x-mpegurl; charset=utf-8",
      "Content-Disposition": `inline; filename="${title.replace(/[^\w .-]/g, "_")}.m3u"`,
      "Cache-Control": "no-store",
    },
  });
}
