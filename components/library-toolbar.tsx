"use client";

import {
  Search,
  X,
  Film,
  Tv,
  LayoutGrid,
  CircleDashed,
  CirclePlay,
  CircleCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LibraryCategory } from "@/types";

export type CategoryFilter = "all" | LibraryCategory;

const FILTERS: { value: CategoryFilter; label: string; icon: typeof Film }[] = [
  { value: "all", label: "All", icon: LayoutGrid },
  { value: "movie", label: "Movies", icon: Film },
  { value: "series", label: "Series", icon: Tv },
];

export type StatusFilter = "any" | "unwatched" | "watching" | "watched";

const STATUS_FILTERS: {
  value: Exclude<StatusFilter, "any">;
  label: string;
  icon: typeof Film;
}[] = [
  { value: "unwatched", label: "Unwatched", icon: CircleDashed },
  { value: "watching", label: "Watching", icon: CirclePlay },
  { value: "watched", label: "Watched", icon: CircleCheck },
];

function Chip({
  active,
  onClick,
  icon: Icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Film;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "shrink-0 h-9 px-3 rounded-full border text-sm flex items-center gap-1.5 transition-colors",
        active
          ? "bg-purple-600 border-purple-500 text-white"
          : "bg-zinc-900/70 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span
        className={cn(
          "text-[11px] tabular-nums",
          active ? "text-purple-200" : "text-zinc-600"
        )}
      >
        {count}
      </span>
    </button>
  );
}

export function LibraryToolbar({
  query,
  onQueryChange,
  filter,
  onFilterChange,
  counts,
  status,
  onStatusChange,
  statusCounts,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  filter: CategoryFilter;
  onFilterChange: (f: CategoryFilter) => void;
  counts: Record<CategoryFilter, number>;
  status: StatusFilter;
  onStatusChange: (s: StatusFilter) => void;
  statusCounts: Record<Exclude<StatusFilter, "any">, number>;
}) {
  return (
    <div className="space-y-2 mb-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600 pointer-events-none" />
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search your library…"
          aria-label="Search library"
          className="w-full h-11 rounded-lg bg-zinc-900/70 border border-zinc-800 pl-9 pr-10 text-base sm:text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-purple-600/70 transition-colors [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            onClick={() => onQueryChange("")}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 flex items-center justify-center text-zinc-600 hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Category chips — scroll sideways rather than wrap on narrow screens */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map(({ value, label, icon }) => (
          <Chip
            key={value}
            active={filter === value}
            onClick={() => onFilterChange(value)}
            icon={icon}
            label={label}
            count={counts[value]}
          />
        ))}

        <span className="shrink-0 h-5 w-px bg-zinc-800 mx-1" aria-hidden />

        {STATUS_FILTERS.map(({ value, label, icon }) => (
          <Chip
            key={value}
            active={status === value}
            // Tapping the active one again clears it.
            onClick={() => onStatusChange(status === value ? "any" : value)}
            icon={icon}
            label={label}
            count={statusCounts[value]}
          />
        ))}
      </div>
    </div>
  );
}
