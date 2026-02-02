"use client";

import { Search, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

export function SearchBar({
  value,
  onChange,
  onClear,
  isLoading = false,
  placeholder = "Search movies and shows...",
  className,
  autoFocus = true,
}: SearchBarProps) {
  return (
    <div className={cn("relative w-full max-w-2xl", className)}>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-500" />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="h-14 pl-12 pr-12 text-lg bg-zinc-900/50 border-zinc-800 rounded-xl focus-visible:ring-zinc-700 placeholder:text-zinc-600"
        />
        {isLoading ? (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-zinc-500 animate-spin" />
        ) : value ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 text-zinc-500 hover:text-zinc-300"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
