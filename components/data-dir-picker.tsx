"use client";

import { useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Folder, ArrowUp, Loader2, Check } from "lucide-react";
import { useDataDir } from "@/hooks/use-data-dir";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BrowseEntry } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function DataDirPicker() {
  const { report, isLoading, browse, switchTo } = useDataDir();
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [browseError, setBrowseError] = useState<string | null>(null);

  const loadPath = async (path?: string) => {
    setBrowsing(true);
    setBrowseError(null);
    try {
      const res = await browse(path);
      setCurrentPath(res.path);
      setParentPath(res.parent);
      setEntries(res.entries);
      if (res.error) setBrowseError(res.error);
    } catch {
      setBrowseError("Failed to browse folder");
    } finally {
      setBrowsing(false);
    }
  };

  const handleOpen = () => {
    setOpen(true);
    loadPath(report?.activeDir);
  };

  const handleSwitch = async () => {
    if (!currentPath) return;
    if (
      !window.confirm(
        `Switch data directory to "${currentPath}"?\n\nThis restarts the torrent engine and interrupts any active downloads/streams.`
      )
    ) {
      return;
    }
    setSwitching(true);
    try {
      await switchTo(currentPath);
      toast.success("Data directory switched");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to switch");
    } finally {
      setSwitching(false);
    }
  };

  const disk = report;
  const freePct =
    disk && disk.totalBytes > 0 ? Math.round((disk.freeBytes / disk.totalBytes) * 100) : null;

  return (
    <Card className="p-6 bg-zinc-900/50 border-zinc-800">
      <h2 className="font-semibold mb-4">Data Directory</h2>

      {isLoading && !report ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-zinc-500 mb-1">Active directory</p>
            <p className="text-sm text-zinc-200 font-mono break-all">
              {report?.activeDir}
            </p>
          </div>

          {disk && disk.totalBytes > 0 && (
            <div>
              <div className="flex justify-between text-xs text-zinc-500 mb-1">
                <span>
                  {formatBytes(disk.freeBytes)} free{freePct !== null ? ` (${freePct}%)` : ""}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${Math.min(100, Math.max(2, freePct ?? 0))}%` }}
                />
              </div>
            </div>
          )}

          <Button
            size="sm"
            variant="outline"
            onClick={handleOpen}
            className="border-zinc-700"
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            Change Folder
          </Button>
          <p className="text-xs text-zinc-600">
            Browsing is limited to whatever directory is mounted/available to the app.
            Switching restarts the torrent engine.
          </p>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-zinc-900 border-zinc-800 max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose Data Directory</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-xs text-zinc-500 font-mono break-all bg-zinc-800/50 rounded px-2 py-1.5">
              {currentPath || "…"}
            </p>

            {browseError && (
              <p className="text-xs text-red-400">{browseError}</p>
            )}

            <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-800 divide-y divide-zinc-800">
              {parentPath && (
                <button
                  onClick={() => loadPath(parentPath)}
                  disabled={browsing}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800/60 transition-colors"
                >
                  <ArrowUp className="h-4 w-4" />
                  ..
                </button>
              )}
              {browsing ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-600" />
                </div>
              ) : entries.length === 0 ? (
                <p className="text-xs text-zinc-600 px-3 py-4 text-center">
                  No subfolders here
                </p>
              ) : (
                entries.map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => loadPath(entry.path)}
                    disabled={browsing}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800/60 transition-colors truncate"
                  >
                    <Folder className="h-4 w-4 shrink-0 text-zinc-500" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                className="border-zinc-700"
                onClick={() => setOpen(false)}
                disabled={switching}
              >
                Cancel
              </Button>
              <Button onClick={handleSwitch} disabled={switching || !currentPath}>
                {switching ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Check className="h-4 w-4 mr-2" />
                )}
                Select This Folder
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
