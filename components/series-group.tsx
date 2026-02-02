"use client";

import { Play, Users, HardDrive, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn, getQualityColor } from "@/lib/utils";
import type { SearchResult } from "@/types";

interface SeriesGroupProps {
  series: Record<
    string,
    {
      name: string;
      seasons: Record<number, SearchResult[]>;
    }
  >;
  onPlay: (result: SearchResult) => void;
}

export function SeriesGroup({ series, onPlay }: SeriesGroupProps) {
  const seriesNames = Object.keys(series);

  if (seriesNames.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-zinc-300">Series</h2>
      <Accordion type="multiple" className="space-y-2">
        {seriesNames.map((seriesName) => {
          const seriesData = series[seriesName];
          const seasonNumbers = Object.keys(seriesData.seasons)
            .map(Number)
            .sort((a, b) => a - b);
          const totalEpisodes = seasonNumbers.reduce(
            (sum, season) => sum + seriesData.seasons[season].length,
            0
          );

          return (
            <AccordionItem
              key={seriesName}
              value={seriesName}
              className="bg-zinc-900/50 border-zinc-800 rounded-lg overflow-hidden"
            >
              <AccordionTrigger className="px-4 py-3 hover:bg-zinc-800/50 hover:no-underline">
                <div className="flex items-center gap-3 text-left">
                  <div className="h-10 w-10 bg-zinc-800 rounded-lg flex items-center justify-center shrink-0">
                    <span className="text-lg font-bold text-zinc-400">
                      {seriesName.charAt(0)}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-medium text-zinc-100">{seriesName}</h3>
                    <p className="text-sm text-zinc-500">
                      {seasonNumbers.length} season
                      {seasonNumbers.length !== 1 ? "s" : ""}, {totalEpisodes}{" "}
                      episode{totalEpisodes !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <div className="space-y-4 pt-2">
                  {seasonNumbers.map((season) => (
                    <SeasonSection
                      key={season}
                      season={season}
                      episodes={seriesData.seasons[season]}
                      onPlay={onPlay}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

interface SeasonSectionProps {
  season: number;
  episodes: SearchResult[];
  onPlay: (result: SearchResult) => void;
}

function SeasonSection({ season, episodes, onPlay }: SeasonSectionProps) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-zinc-400 px-2">
        Season {season}
      </h4>
      <div className="space-y-1">
        {episodes.map((episode, index) => (
          <button
            key={`${episode.magnet}-${index}`}
            onClick={() => onPlay(episode)}
            className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-800/70 transition-colors text-left group"
          >
            <div className="h-8 w-8 bg-zinc-800 group-hover:bg-red-600 rounded-md flex items-center justify-center shrink-0 transition-colors">
              <Play className="h-3.5 w-3.5 fill-current" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-200 truncate">
                E{episode.episode?.toString().padStart(2, "0")} -{" "}
                {episode.title}
              </p>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {episode.seeds}
                </span>
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  {episode.size}
                </span>
              </div>
            </div>
            <Badge
              className={cn(
                "shrink-0 uppercase text-[10px] font-semibold",
                getQualityColor(episode.quality)
              )}
            >
              {episode.quality}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
