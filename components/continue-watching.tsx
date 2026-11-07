"use client";

import { MonitorPlay, Play, X } from "lucide-react";
import { progressPct, timeLeft } from "@/hooks/use-watch-progress";
import { useVlcCopy } from "@/hooks/use-vlc-copy";
import { extractInfoHashFromMagnet } from "@/lib/torrent-cache-actions";
import { episodeCode, showName } from "@/lib/episode-order";
import type { WatchRecord } from "@/types";

export type UpNext = NonNullable<WatchRecord["upNext"]>;

// Visible focus for a TV remote; inset so the tile's rounded clip can't hide it.
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-400";

/** Display parts for a tile: readable name, episode code, the line under it. */
function describe(record: WatchRecord) {
  const up = record.upNext;
  if (up) {
    const code = up.pickFrom ? null : episodeCode(up.title);
    const name = showName(up.title);
    const full = code ? `${name} · ${code}` : up.title;
    return {
      name,
      code,
      meta: code ? "Up next" : "Up next · choose an episode",
      pct: null,
      full,
      label: `Play ${full}`,
    };
  }
  // Stored titles can be raw ("IT.Welcome.To.Derry · S01E07"); tidy for display only.
  const name = showName(record.title);
  const code = episodeCode(record.title);
  const full = code ? `${name} · ${code}` : name;
  return {
    name,
    code,
    meta: timeLeft(record),
    pct: Math.max(2, progressPct(record)),
    full,
    label: `Resume ${full}`,
  };
}

function ForgetButton({
  record,
  onForget,
  size,
}: {
  record: WatchRecord;
  onForget: (record: WatchRecord) => void;
  size: "lg" | "sm";
}) {
  return (
    <button
      onClick={() => onForget(record)}
      className={`absolute top-2 right-2 flex items-center justify-center rounded-lg text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors motion-reduce:transition-none ${FOCUS} ${
        size === "lg" ? "h-10 w-10" : "h-8 w-8"
      }`}
      aria-label={`Remove ${showName(record.title)} from Continue`}
      title="Forget this"
    >
      <X className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} />
    </button>
  );
}

/** What a tile's VLC link plays; null when there's nothing to copy yet. */
function vlcTarget(record: WatchRecord, full: string) {
  const up = record.upNext;
  if (!up) return { hash: record.infoHash, fileIndex: record.fileIndex, title: full };
  // "Choose an episode" tiles have no single file to hand VLC.
  if (up.pickFrom) return null;
  const hash = extractInfoHashFromMagnet(up.magnet);
  // No fileIndex → the server picks the main video.
  return hash ? { hash, fileIndex: up.fileIndex, title: full } : null;
}

function VlcButton({
  record,
  full,
  copyVlc,
  className,
}: {
  record: WatchRecord;
  full: string;
  copyVlc: ReturnType<typeof useVlcCopy>;
  className: string;
}) {
  const t = vlcTarget(record, full);
  if (!t) return null;
  return (
    <button
      // Synchronous: phones only allow the clipboard write inside the tap.
      onClick={(e) => {
        e.stopPropagation();
        copyVlc(t.hash, t.fileIndex, t.title);
      }}
      className={`absolute h-10 w-10 flex items-center justify-center rounded-lg text-zinc-600 hover:text-purple-300 hover:bg-zinc-800 transition-colors motion-reduce:transition-none ${FOCUS} ${className}`}
      aria-label="Copy VLC link"
      title="Copy VLC link"
    >
      <MonitorPlay className="h-4 w-4" />
    </button>
  );
}

function ProgressLine({ pct, thick }: { pct: number; thick?: boolean }) {
  return (
    <div className={`absolute inset-x-0 bottom-0 bg-zinc-800 ${thick ? "h-[3px]" : "h-0.5"}`}>
      <div className="h-full bg-purple-600" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ContinueWatching({
  records,
  onResume,
  onPlayNext,
  onForget,
  onOpenShow,
}: {
  records: WatchRecord[];
  onResume: (record: WatchRecord) => void;
  onPlayNext: (upNext: UpNext) => void;
  onForget: (record: WatchRecord) => void;
  /** Card body: open the show (folder / episode list). Play button resumes. */
  onOpenShow?: (record: WatchRecord) => void;
}) {
  const copyVlc = useVlcCopy();
  if (records.length === 0) return null;

  const [hero, ...rest] = records;
  const play = (record: WatchRecord) =>
    record.upNext ? onPlayNext(record.upNext) : onResume(record);
  const openShow = (record: WatchRecord) => (onOpenShow ? onOpenShow(record) : play(record));
  const h = describe(hero);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
        Continue
      </h2>

      {/* Now watching: the one obvious action */}
      <div className="relative overflow-hidden rounded-2xl">
        <button
          onClick={() => openShow(hero)}
          aria-label={`Open ${h.full}`}
          title={`Open ${h.full}`}
          className={`w-full min-h-[132px] flex items-center py-5 pl-28 sm:pl-[8.5rem] pr-16 text-left rounded-2xl bg-zinc-900/70 hover:bg-zinc-800/80 cursor-pointer transition-colors motion-reduce:transition-none ${FOCUS}`}
        >
          <span className="min-w-0">
            <span className="block text-xl font-semibold text-zinc-100 line-clamp-2">{h.name}</span>
            <span className="mt-1.5 flex items-center gap-2 text-sm text-zinc-400">
              {h.code && (
                <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-xs font-medium text-zinc-300 tabular-nums">
                  {h.code}
                </span>
              )}
              <span className="truncate">{h.meta}</span>
            </span>
          </span>
        </button>
        {/* Play sits on top of the card: resumes right where you stopped. */}
        <button
          onClick={() => play(hero)}
          aria-label={h.label}
          title={hero.upNext ? `Play ${h.full}` : `Resume ${h.full}`}
          className={`absolute left-6 sm:left-7 top-1/2 -translate-y-1/2 h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-purple-600 hover:bg-purple-500 active:scale-95 flex items-center justify-center cursor-pointer transition-[background-color,transform] motion-reduce:transition-none ${FOCUS}`}
        >
          <Play className="h-7 w-7 sm:h-8 sm:w-8 fill-current ml-1" />
        </button>
        <ForgetButton record={hero} onForget={onForget} size="lg" />
        <VlcButton record={hero} full={h.full} copyVlc={copyVlc} className="bottom-2 right-2" />
        {h.pct !== null && <ProgressLine pct={h.pct} thick />}
      </div>

      {/* The rest, quietly. Scrolls sideways on a phone. */}
      {rest.length > 0 && (
        <div className="mt-3 flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {rest.map((record) => {
            const d = describe(record);
            return (
              <div
                key={`${record.infoHash}:${record.fileIndex}`}
                className="relative shrink-0 w-60 overflow-hidden rounded-xl"
              >
                <button
                  onClick={() => openShow(record)}
                  aria-label={`Open ${d.full}`}
                  title={`Open ${d.full}`}
                  className={`w-full min-h-[72px] py-3 pl-[3.75rem] pr-[5.5rem] text-left rounded-xl bg-zinc-900/50 hover:bg-zinc-800/70 cursor-pointer transition-colors motion-reduce:transition-none ${FOCUS}`}
                >
                  <span className="block text-sm text-zinc-200 line-clamp-2">{d.name}</span>
                  <span className="mt-0.5 block text-xs text-zinc-500 truncate">
                    {d.code ? `${d.code} · ${d.meta}` : d.meta}
                  </span>
                </button>
                <button
                  onClick={() => play(record)}
                  aria-label={d.label}
                  title={`Resume ${d.full}`}
                  className={`absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-purple-600 hover:bg-purple-500 active:scale-95 flex items-center justify-center cursor-pointer transition-[background-color,transform] motion-reduce:transition-none ${FOCUS}`}
                >
                  <Play className="h-4 w-4 fill-current ml-0.5" />
                </button>
                <ForgetButton record={record} onForget={onForget} size="sm" />
                <VlcButton record={record} full={d.full} copyVlc={copyVlc} className="top-1 right-10" />
                {d.pct !== null && <ProgressLine pct={d.pct} />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
