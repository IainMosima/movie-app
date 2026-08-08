"use client";

import { useState } from "react";
import {
  Play,
  Trash2,
  Loader2,
  Eraser,
  MoreVertical,
  ListVideo,
  MonitorPlay,
  FolderInput,
  Film,
  Tv,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type {
  LibraryItemWithUsage,
  LibraryFolderWithUsage,
  LibraryCategory,
} from "@/types";

export function LibraryCard({
  item,
  folders,
  onPlay,
  onOpen,
  onDelete,
  onClearCache,
  onVLC,
  onMoveToFolder,
  onSetCategory,
}: {
  item: LibraryItemWithUsage;
  folders: LibraryFolderWithUsage[];
  onPlay: () => void;
  onOpen: () => void;
  onDelete: () => void;
  onClearCache: () => void;
  onVLC: () => void;
  onMoveToFolder: (folderId: string | null) => void;
  onSetCategory: (category: LibraryCategory) => void;
}) {
  const [isClearing, setIsClearing] = useState(false);

  const handleClearCache = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsClearing(true);
    await onClearCache();
    setIsClearing(false);
  };

  const isSeries = item.category === "series";

  return (
    <Card
      className="group p-3 sm:p-4 bg-zinc-900/50 border-zinc-800 hover:bg-zinc-800/50 hover:border-zinc-700 transition-all cursor-pointer"
      onClick={onOpen}
    >
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          className="h-11 w-11 rounded-lg bg-zinc-800 group-hover:bg-purple-600 transition-colors shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          aria-label={`Play ${item.name}`}
        >
          <Play className="h-5 w-5 fill-current" />
        </Button>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-zinc-100 truncate group-hover:text-white">
            {item.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 text-[11px] text-zinc-600">
            {isSeries ? (
              <Tv className="h-3 w-3 shrink-0 text-sky-500/70" />
            ) : (
              <Film className="h-3 w-3 shrink-0 text-purple-500/70" />
            )}
            <span className="truncate">
              {item.cachedBytes > 0 ? (
                <span className="text-amber-500/80">{item.cachedFormatted} on disk</span>
              ) : (
                new Date(item.addedAt).toLocaleDateString()
              )}
            </span>
            {item.quality && (
              <Badge className="hidden sm:inline-flex shrink-0 bg-zinc-800 text-zinc-400 px-1.5 py-0 text-[10px]">
                {item.quality}
              </Badge>
            )}
          </div>
        </div>

        {item.cachedBytes > 0 && (
          <Button
            size="icon"
            variant="ghost"
            onClick={handleClearCache}
            disabled={isClearing}
            className="h-10 w-10 text-zinc-500 hover:text-amber-400 shrink-0"
            aria-label="Clear cached bytes"
            title={`Clear ${item.cachedFormatted} of cached bytes`}
          >
            {isClearing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Eraser className="h-4 w-4" />
            )}
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              size="icon"
              variant="ghost"
              className="h-10 w-10 text-zinc-500 hover:text-zinc-200 shrink-0"
              aria-label="More actions"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-56 bg-zinc-900 border-zinc-800"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenuItem onSelect={() => onOpen()}>
              <ListVideo className="h-4 w-4" />
              Browse files
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onVLC()}>
              <MonitorPlay className="h-4 w-4" />
              Get VLC stream URL
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-zinc-800" />
            <DropdownMenuLabel className="text-zinc-500 text-xs">
              Category
            </DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={() => onSetCategory("movie")}
              disabled={item.category === "movie"}
            >
              <Film className="h-4 w-4" />
              Mark as Movie
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onSetCategory("series")}
              disabled={item.category === "series"}
            >
              <Tv className="h-4 w-4" />
              Mark as Series
            </DropdownMenuItem>

            {folders.length > 0 && (
              <>
                <DropdownMenuSeparator className="bg-zinc-800" />
                <DropdownMenuLabel className="text-zinc-500 text-xs">
                  Move to folder
                </DropdownMenuLabel>
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onSelect={() => onMoveToFolder(f.id)}
                    disabled={item.folderId === f.id}
                  >
                    <FolderInput className="h-4 w-4" />
                    <span className="truncate">{f.name}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}

            <DropdownMenuSeparator className="bg-zinc-800" />
            {item.cachedBytes > 0 && (
              <DropdownMenuItem onSelect={() => onClearCache()}>
                <Eraser className="h-4 w-4" />
                Clear cache ({item.cachedFormatted})
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete()}>
              <Trash2 className="h-4 w-4" />
              Remove from library
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  );
}
