"use client";

import { useState } from "react";
import { Link2, Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface MagnetInputProps {
  onSubmit: (magnet: string) => void;
  isLoading?: boolean;
  className?: string;
}

export function MagnetInput({ onSubmit, isLoading, className }: MagnetInputProps) {
  const [magnet, setMagnet] = useState("");

  const isValid = magnet.trim().startsWith("magnet:?");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isValid && !isLoading) {
      onSubmit(magnet.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className={cn("w-full", className)}>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            type="text"
            value={magnet}
            onChange={(e) => setMagnet(e.target.value)}
            placeholder="Paste magnet link here..."
            className="pl-10 bg-zinc-900/50 border-zinc-800 focus-visible:ring-zinc-700"
            disabled={isLoading}
          />
        </div>
        <Button
          type="submit"
          disabled={!isValid || isLoading}
          className="bg-red-600 hover:bg-red-700 shrink-0"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Play className="h-4 w-4 mr-1 fill-current" />
              Play
            </>
          )}
        </Button>
      </div>
      {magnet && !isValid && (
        <p className="text-xs text-red-400 mt-1.5 ml-1">
          Must start with "magnet:?"
        </p>
      )}
    </form>
  );
}
