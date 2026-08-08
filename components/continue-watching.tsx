"use client";

import { Play, X, History } from "lucide-react";
import { formatDuration } from "@/lib/utils";
import type { WatchRecord } from "@/types";

function timeLeft(record: WatchRecord): string {
  if (!record.durationSec || record.durationSec <= record.positionSec) {
    return `${formatDuration(record.positionSec)} in`;
  }
  const remaining = Math.round((record.durationSec - record.positionSec) / 60);
  if (remaining < 1) return "almost done";
  if (remaining < 60) return `${remaining} min left`;
  const hours = Math.floor(remaining / 60);
  const mins = remaining % 60;
  return mins ? `${hours}h ${mins}m left` : `${hours}h left`;
}

export function ContinueWatching({
  records,
  onResume,
  onForget,
}: {
  records: WatchRecord[];
  onResume: (record: WatchRecord) => void;
  onForget: (record: WatchRecord) => void;
}) {
  if (records.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-zinc-500" />
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          Continue Watching
        </h2>
      </div>

      {/* Scrolls sideways on a phone, wraps into a row on wider screens */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {records.map((record) => {
          const pct = record.durationSec
            ? Math.min(100, Math.round((record.positionSec / record.durationSec) * 100))
            : 0;

          return (
            <div
              key={`${record.infoHash}:${record.fileIndex}`}
              className="group relative shrink-0 w-56 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 transition-colors overflow-hidden"
            >
              <button
                onClick={() => onResume(record)}
                className="w-full text-left p-3 pr-9"
                aria-label={`Resume ${record.title}`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="h-10 w-10 rounded-lg bg-zinc-800 group-hover:bg-purple-600 flex items-center justify-center shrink-0 transition-colors">
                    <Play className="h-4 w-4 fill-current" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-200 truncate">{record.title}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      {formatDuration(record.positionSec)} · {timeLeft(record)}
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => onForget(record)}
                className="absolute top-2 right-2 h-7 w-7 flex items-center justify-center rounded-md text-zinc-600 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                aria-label={`Remove ${record.title} from Continue Watching`}
                title="Forget this"
              >
                <X className="h-3.5 w-3.5" />
              </button>

              <div className="h-1 bg-zinc-800">
                <div
                  className="h-full bg-purple-600"
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
