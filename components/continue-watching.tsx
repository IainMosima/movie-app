"use client";

import { Play, X } from "lucide-react";
import { progressPct, timeLeft } from "@/hooks/use-watch-progress";
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
    return {
      name: showName(up.title),
      code: null,
      meta: code ? `Up next · ${code}` : "Up next · choose an episode",
      pct: null,
      label: `Play ${up.title}`,
    };
  }
  return {
    name: showName(record.title),
    code: episodeCode(record.title),
    meta: timeLeft(record),
    pct: Math.max(2, progressPct(record)),
    label: `Resume ${record.title}`,
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
}: {
  records: WatchRecord[];
  onResume: (record: WatchRecord) => void;
  onPlayNext: (upNext: UpNext) => void;
  onForget: (record: WatchRecord) => void;
}) {
  if (records.length === 0) return null;

  const [hero, ...rest] = records;
  const open = (record: WatchRecord) =>
    record.upNext ? onPlayNext(record.upNext) : onResume(record);
  const h = describe(hero);

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-zinc-400 uppercase tracking-wider">
        Continue
      </h2>

      {/* Now watching: the one obvious action */}
      <div className="relative overflow-hidden rounded-2xl">
        <button
          onClick={() => open(hero)}
          aria-label={h.label}
          className={`group w-full min-h-[132px] flex items-center gap-5 py-5 pl-6 sm:pl-7 pr-16 text-left rounded-2xl bg-zinc-900/70 hover:bg-zinc-800/80 transition-colors motion-reduce:transition-none ${FOCUS}`}
        >
          <span className="h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-full bg-purple-600 group-hover:bg-purple-500 flex items-center justify-center transition-colors motion-reduce:transition-none">
            <Play className="h-7 w-7 sm:h-8 sm:w-8 fill-current ml-1" />
          </span>
          <span className="min-w-0">
            <span className="block text-xl font-semibold text-zinc-100 truncate">{h.name}</span>
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
        <ForgetButton record={hero} onForget={onForget} size="lg" />
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
                  onClick={() => open(record)}
                  aria-label={d.label}
                  className={`w-full min-h-[72px] py-3 pl-4 pr-11 text-left rounded-xl bg-zinc-900/50 hover:bg-zinc-800/70 transition-colors motion-reduce:transition-none ${FOCUS}`}
                >
                  <span className="block text-sm text-zinc-200 truncate">{d.name}</span>
                  <span className="mt-0.5 block text-xs text-zinc-500 truncate">
                    {d.code ? `${d.code} · ${d.meta}` : d.meta}
                  </span>
                </button>
                <ForgetButton record={record} onForget={onForget} size="sm" />
                {d.pct !== null && <ProgressLine pct={d.pct} />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
