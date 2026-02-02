"use client";

import { Play, Users, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, getQualityColor } from "@/lib/utils";
import type { SearchResult } from "@/types";

interface ResultsListProps {
  results: SearchResult[];
  onPlay: (result: SearchResult) => void;
  isLoading?: boolean;
}

export function ResultsList({ results, onPlay, isLoading }: ResultsListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <Card
            key={i}
            className="p-4 bg-zinc-900/50 border-zinc-800 animate-pulse"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-zinc-800 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-2/3 bg-zinc-800 rounded" />
                <div className="h-3 w-1/3 bg-zinc-800 rounded" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {results.map((result, index) => (
        <ResultCard
          key={`${result.magnet}-${index}`}
          result={result}
          onPlay={() => onPlay(result)}
        />
      ))}
    </div>
  );
}

interface ResultCardProps {
  result: SearchResult;
  onPlay: () => void;
}

function ResultCard({ result, onPlay }: ResultCardProps) {
  return (
    <Card
      className="group p-4 bg-zinc-900/50 border-zinc-800 hover:bg-zinc-800/50 hover:border-zinc-700 transition-all cursor-pointer"
      onClick={onPlay}
    >
      <div className="flex items-center gap-4">
        {/* Play button */}
        <Button
          size="icon"
          className="h-12 w-12 rounded-lg bg-zinc-800 group-hover:bg-red-600 transition-colors shrink-0"
        >
          <Play className="h-5 w-5 fill-current" />
        </Button>

        {/* Title and metadata */}
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-zinc-100 truncate group-hover:text-white">
            {result.title}
          </h3>
          <div className="flex items-center gap-4 mt-1 text-sm text-zinc-500">
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {result.seeds.toLocaleString()} seeds
            </span>
            <span className="flex items-center gap-1">
              <HardDrive className="h-3.5 w-3.5" />
              {result.size}
            </span>
          </div>
        </div>

        {/* Quality badge */}
        <Badge
          className={cn(
            "shrink-0 uppercase text-xs font-semibold",
            getQualityColor(result.quality)
          )}
        >
          {result.quality}
        </Badge>
      </div>
    </Card>
  );
}
