import { NextRequest, NextResponse } from "next/server";
import { networkInterfaces } from "os";
import { getTorrentEngine } from "@/lib/torrent-engine";
import { pickVideo, subsFor } from "@/lib/subtitle-match";
import { episodeCode } from "@/lib/episode-order";

const ENGLISH = /\b(en|eng|english)\b/i;

/** An address other devices on the Wi-Fi can reach — never "localhost". */
function lanHost(req: NextRequest): string {
  const host = (req.headers.get("host") ?? "").split(":")[0];
  if (host && !/^(localhost|127\.|\[?::1)/.test(host)) return host;
  for (const addrs of Object.values(networkInterfaces())) {
    const v4 = addrs?.find((a) => a.family === "IPv4" && !a.internal);
    if (v4) return v4.address;
  }
  return host || "localhost";
}

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
  const [torrent, workerPort] = await Promise.all([
    engine.getTorrent(infoHash),
    engine.getWorkerPort(),
  ]);
  if (!torrent) return NextResponse.json({ error: "Torrent not found" }, { status: 404 });

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
