"use client";

import { useState } from "react";
import { toast } from "sonner";
import { HardDrive, AlertTriangle, Trash2, Loader2, RefreshCw } from "lucide-react";
import { useStorage } from "@/hooks/use-storage";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StorageEntry } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

const KIND_BADGE: Record<StorageEntry["kind"], { label: string; className: string }> = {
  matched: { label: "In library", className: "bg-emerald-900/40 text-emerald-300" },
  orphan: { label: "Orphan", className: "bg-red-900/40 text-red-300" },
  subtitles: { label: "Subtitles", className: "bg-zinc-800 text-zinc-400" },
  transcode: { label: "Transcode", className: "bg-zinc-800 text-zinc-400" },
};

export function StoragePanel() {
  const { report, isLoading, orphanCount, deleteOrphan, deleteAllOrphans, refresh } = useStorage();
  const [busy, setBusy] = useState<string | null>(null);

  const handleDeleteOne = async (entry: StorageEntry) => {
    if (!window.confirm(`Delete "${entry.name}" (${entry.sizeFormatted}) from disk?`)) return;
    setBusy(entry.name);
    try {
      const res = await deleteOrphan(entry.name);
      toast.success(`Reclaimed ${res.reclaimedFormatted ?? entry.sizeFormatted}`);
    } catch {
      toast.error("Failed to delete");
    } finally {
      setBusy(null);
    }
  };

  const handleReclaimAll = async () => {
    if (!window.confirm(`Delete all ${orphanCount} orphaned cache folder(s) from disk?`)) return;
    setBusy("__all__");
    try {
      const res = await deleteAllOrphans();
      toast.success(`Reclaimed ${res.reclaimedFormatted ?? "space"}`);
    } catch {
      toast.error("Failed to reclaim orphans");
    } finally {
      setBusy(null);
    }
  };

  const disk = report?.disk;
  const freePct =
    disk && disk.totalBytes > 0 ? Math.round((disk.freeBytes / disk.totalBytes) * 100) : null;

  return (
    <Card className="p-4 bg-zinc-900/50 border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-zinc-300">
          <HardDrive className="h-4 w-4" />
          <span className="text-sm font-semibold">Storage</span>
        </div>
        <button
          onClick={() => refresh()}
          className="text-zinc-600 hover:text-zinc-300 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Disk space line */}
      {disk && disk.totalBytes > 0 && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-zinc-500 mb-1">
            <span>
              {formatBytes(disk.freeBytes)} free{freePct !== null ? ` (${freePct}%)` : ""}
            </span>
            <span>
              Cache footprint: {report?.cacheTotalFormatted ?? "0 B"}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className={`h-full ${disk.belowFloor ? "bg-red-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, Math.max(2, freePct ?? 0))}%` }}
            />
          </div>
        </div>
      )}

      {/* Below-floor warning */}
      {disk?.belowFloor && (
        <div className="flex items-start gap-2 mb-3 rounded-lg border border-red-900/50 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Below the {formatBytes(disk.floorBytes)} safety floor — stream-only mode recommended.
            Free space before downloading.
          </span>
        </div>
      )}

      {/* Reclaim all orphans */}
      {orphanCount > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleReclaimAll}
          disabled={busy !== null}
          className="w-full mb-3 border-red-900/60 text-red-300 hover:bg-red-950/40 hover:text-red-200"
        >
          {busy === "__all__" ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Trash2 className="h-4 w-4 mr-2" />
          )}
          Reclaim all {orphanCount} orphan{orphanCount > 1 ? "s" : ""}
        </Button>
      )}

      {/* Entries */}
      {isLoading && !report ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        </div>
      ) : report && report.entries.length > 0 ? (
        <div className="space-y-1.5">
          {report.entries
            .slice()
            .sort((a, b) => b.sizeBytes - a.sizeBytes)
            .map((entry) => {
              const badge = KIND_BADGE[entry.kind];
              return (
                <div
                  key={entry.name}
                  className="flex items-center gap-3 rounded-lg bg-zinc-900/60 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-zinc-300 truncate" title={entry.name}>
                      {entry.name}
                    </p>
                    <p className="text-[11px] text-zinc-600">{entry.sizeFormatted}</p>
                  </div>
                  <Badge className={`shrink-0 ${badge.className}`}>{badge.label}</Badge>
                  {entry.kind === "orphan" && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDeleteOne(entry)}
                      disabled={busy !== null}
                      className="h-7 w-7 text-zinc-600 hover:text-red-400 shrink-0"
                      title="Delete from disk"
                    >
                      {busy === entry.name ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
        </div>
      ) : (
        <p className="text-xs text-zinc-600 py-2 text-center">Cache is empty — nothing on disk.</p>
      )}
    </Card>
  );
}
