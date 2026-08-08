"use client";

import { Folder, ChevronRight, Film, Tv } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LibraryFolderWithUsage } from "@/types";

export function FolderCard({
  folder,
  onOpen,
}: {
  folder: LibraryFolderWithUsage;
  onOpen: () => void;
}) {
  const isSeries = folder.category === "series";
  const CategoryIcon = isSeries ? Tv : Film;

  return (
    <Card
      className="group p-3 sm:p-4 bg-zinc-900/50 border-zinc-800 hover:bg-zinc-800/50 hover:border-zinc-700 transition-all cursor-pointer"
      onClick={onOpen}
    >
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-lg bg-zinc-800 group-hover:bg-purple-600/80 flex items-center justify-center shrink-0 transition-colors">
          <Folder className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-zinc-100 truncate group-hover:text-white">
            {folder.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-zinc-600">
            <CategoryIcon
              className={`h-3 w-3 shrink-0 ${isSeries ? "text-sky-500/70" : "text-purple-500/70"}`}
            />
            <span className="truncate">
              {folder.itemCount} item{folder.itemCount !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {folder.cachedBytes > 0 && (
          <Badge className="shrink-0 bg-amber-900/30 text-amber-300/90 text-[10px] sm:text-xs px-1.5">
            {folder.cachedFormatted}
          </Badge>
        )}

        <ChevronRight className="h-5 w-5 text-zinc-700 group-hover:text-zinc-400 shrink-0 transition-colors" />
      </div>
    </Card>
  );
}
