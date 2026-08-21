"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Play,
  Trash2,
  Eraser,
  Loader2,
  Plus,
  HardDrive,
  Pencil,
  Check,
  X,
  MoreVertical,
  FolderOutput,
  MonitorPlay,
  ListVideo,
  Film,
  Tv,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { isValidTorrentInput } from "@/lib/torrent-utils";
import { cn } from "@/lib/utils";
import type {
  LibraryFolderWithUsage,
  LibraryItemWithUsage,
  LibraryCategory,
} from "@/types";

interface ReclaimResult {
  reclaimedFormatted?: string;
}

interface FolderDialogProps {
  open: boolean;
  onClose: () => void;
  folder: LibraryFolderWithUsage;
  items: LibraryItemWithUsage[];
  onPlay: (item: LibraryItemWithUsage) => void;
  onOpenListing: (item: LibraryItemWithUsage) => void;
  onVLC: (item: LibraryItemWithUsage) => void;
  onAddItem: (input: { name: string; magnet: string }) => Promise<unknown>;
  onClearItemCache: (id: string) => Promise<ReclaimResult>;
  onDeleteItem: (id: string) => Promise<unknown>;
  onMoveOut: (id: string) => Promise<unknown>;
  onClearFolderCache: () => Promise<ReclaimResult>;
  onRename: (name: string) => Promise<unknown>;
  onSetCategory: (category: LibraryCategory) => Promise<unknown>;
  onDeleteFolder: (opts: { deleteItems: boolean }) => Promise<unknown>;
}

export function FolderDialog({
  open,
  onClose,
  folder,
  items,
  onPlay,
  onOpenListing,
  onVLC,
  onAddItem,
  onClearItemCache,
  onDeleteItem,
  onMoveOut,
  onClearFolderCache,
  onRename,
  onSetCategory,
  onDeleteFolder,
}: FolderDialogProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMagnet, setNewMagnet] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(folder.name);

  const cachedCount = items.filter((i) => i.cachedBytes > 0).length;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const handleAdd = () =>
    run("__add__", async () => {
      try {
        await onAddItem({ name: newName.trim(), magnet: newMagnet.trim() });
        toast.success(`Added "${newName.trim()}" to ${folder.name}`);
        setNewName("");
        setNewMagnet("");
        setShowAdd(false);
      } catch {
        toast.error("Failed to add");
      }
    });

  const handleClearItem = (item: LibraryItemWithUsage) =>
    run(item.id, async () => {
      try {
        const res = await onClearItemCache(item.id);
        toast.success(`Reclaimed ${res.reclaimedFormatted ?? item.cachedFormatted}`);
      } catch {
        toast.error("Failed to clear cache");
      }
    });

  const handleDeleteItem = (item: LibraryItemWithUsage) =>
    run(item.id, async () => {
      if (!window.confirm(`Remove "${item.name}" and its cached bytes?`)) return;
      try {
        await onDeleteItem(item.id);
        toast.success(`Removed "${item.name}"`);
      } catch {
        toast.error("Failed to remove");
      }
    });

  const handleClearFolder = () =>
    run("__folder__", async () => {
      if (
        !window.confirm(
          `Clear cached bytes for all ${cachedCount} cached item(s) in "${folder.name}"? They stay in the library and re-download when played.`
        )
      )
        return;
      try {
        const res = await onClearFolderCache();
        toast.success(`Reclaimed ${res.reclaimedFormatted ?? folder.cachedFormatted}`);
      } catch {
        toast.error("Failed to clear folder cache");
      }
    });

  const handleDeleteFolder = () =>
    run("__deleteFolder__", async () => {
      const alsoItems = window.confirm(
        `Delete folder "${folder.name}".\n\nOK = also delete its ${items.length} item(s) and their cached bytes.\nCancel = keep the items (they move back to the main library).`
      );
      try {
        await onDeleteFolder({ deleteItems: alsoItems });
        toast.success(
          alsoItems ? `Deleted "${folder.name}" and its items` : `Deleted "${folder.name}"`
        );
        onClose();
      } catch {
        toast.error("Failed to delete folder");
      }
    });

  const handleRename = () =>
    run("__rename__", async () => {
      const name = draftName.trim();
      if (!name || name === folder.name) {
        setRenaming(false);
        return;
      }
      try {
        await onRename(name);
        setRenaming(false);
      } catch {
        toast.error("Failed to rename");
      }
    });

  const toggleCategory = () =>
    run("__category__", async () => {
      const next: LibraryCategory = folder.category === "series" ? "movie" : "series";
      try {
        await onSetCategory(next);
      } catch {
        toast.error("Failed to change category");
      }
    });

  const CategoryIcon = folder.category === "series" ? Tv : Film;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-[calc(100%-1.5rem)] sm:max-w-2xl h-[88vh] sm:h-[85vh] flex flex-col p-4 sm:p-6">
        <DialogHeader>
          {renaming ? (
            <div className="flex items-center gap-2 pr-8">
              <Input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                autoFocus
                className="bg-zinc-800 border-zinc-700 h-10 text-base sm:text-sm"
              />
              <Button size="icon" className="h-10 w-10 shrink-0" onClick={handleRename}>
                <Check className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 shrink-0"
                onClick={() => {
                  setDraftName(folder.name);
                  setRenaming(false);
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <DialogTitle className="pr-8 flex items-center gap-2 text-left">
              <span className="truncate">{folder.name}</span>
              <button
                onClick={() => {
                  setDraftName(folder.name);
                  setRenaming(true);
                }}
                className="text-zinc-600 hover:text-zinc-300 transition-colors shrink-0 p-1"
                aria-label="Rename folder"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </DialogTitle>
          )}
        </DialogHeader>

        {/* Summary + reclaim */}
        <div className="pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-2 flex-wrap text-xs text-zinc-500">
            <button
              onClick={toggleCategory}
              disabled={busy !== null}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-1 transition-colors",
                folder.category === "series"
                  ? "border-sky-900/60 bg-sky-950/40 text-sky-300"
                  : "border-purple-900/60 bg-purple-950/40 text-purple-300"
              )}
              title="Tap to switch category"
            >
              <CategoryIcon className="h-3 w-3" />
              {folder.category === "series" ? "Series" : "Movies"}
            </button>
            <span className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5" />
              {items.length} item{items.length !== 1 ? "s" : ""} •{" "}
              {folder.cachedFormatted} on disk
            </span>
          </div>
          {folder.cachedBytes > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleClearFolder}
              disabled={busy !== null}
              className="w-full mt-3 h-11 border-amber-900/60 text-amber-300 hover:bg-amber-950/40 hover:text-amber-200"
            >
              {busy === "__folder__" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Eraser className="h-4 w-4 mr-2" />
              )}
              <span className="truncate">
                Clear all cached in this folder ({folder.cachedFormatted})
              </span>
            </Button>
          )}
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto -mr-2 pr-2 py-2">
          {items.length === 0 ? (
            <p className="text-sm text-zinc-600 text-center py-10 px-4">
              Nothing here yet — add episodes one magnet at a time below.
            </p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => {
                const isBusy = busy === item.id;
                const cached = item.cachedBytes > 0;
                return (
                  <div
                    key={item.id}
                    className="group flex items-center gap-2 sm:gap-3 rounded-xl bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700 p-2.5 sm:p-3 transition-colors"
                  >
                    <Button
                      size="icon"
                      className="h-11 w-11 rounded-lg bg-zinc-800 group-hover:bg-purple-600 transition-colors shrink-0"
                      onClick={() => onPlay(item)}
                      aria-label={`Play ${item.name}`}
                    >
                      <Play className="h-4 w-4 fill-current" />
                    </Button>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{item.name}</p>
                      <p className="text-[11px] text-zinc-600 mt-0.5">
                        {cached ? (
                          <span className="text-amber-500/80">
                            {item.cachedFormatted} on disk
                          </span>
                        ) : (
                          "not cached"
                        )}
                      </p>
                    </div>

                    {cached && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleClearItem(item)}
                        disabled={busy !== null}
                        className="h-10 w-10 text-zinc-500 hover:text-amber-400 shrink-0"
                        aria-label="Clear cached bytes"
                        title="Clear cached bytes (stays in library)"
                      >
                        {isBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Eraser className="h-4 w-4" />
                        )}
                      </Button>
                    )}

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={busy !== null}
                          className="h-10 w-10 text-zinc-500 hover:text-zinc-200 shrink-0"
                          aria-label="More actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="w-52 bg-zinc-900 border-zinc-800"
                      >
                        <DropdownMenuItem onSelect={() => onOpenListing(item)}>
                          <ListVideo className="h-4 w-4" />
                          Browse files
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onVLC(item)}>
                          <MonitorPlay className="h-4 w-4" />
                          Get VLC stream URL
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-zinc-800" />
                        <DropdownMenuItem onSelect={() => onMoveOut(item.id)}>
                          <FolderOutput className="h-4 w-4" />
                          Move out of folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-zinc-800" />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => handleDeleteItem(item)}
                        >
                          <Trash2 className="h-4 w-4" />
                          Remove from library
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Add torrent to this folder */}
        <div className="pt-3 border-t border-zinc-800 space-y-3">
          {showAdd ? (
            <>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Episode or title name"
                className="bg-zinc-800 border-zinc-700 h-11 text-base sm:text-sm"
              />
              <Input
                value={newMagnet}
                onChange={(e) => setNewMagnet(e.target.value)}
                placeholder="Paste magnet link or .torrent URL"
                className="bg-zinc-800 border-zinc-700 font-mono text-xs h-11"
              />
              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                <Button
                  variant="ghost"
                  onClick={() => setShowAdd(false)}
                  className="text-zinc-500 h-11"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleAdd}
                  disabled={
                    !newName.trim() || !isValidTorrentInput(newMagnet) || busy !== null
                  }
                  className="h-11"
                >
                  {busy === "__add__" ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  Add to folder
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAdd(true)}
                className="border-zinc-700 h-10 min-w-0"
              >
                <Plus className="h-4 w-4 mr-1.5 shrink-0" />
                <span className="truncate">Add torrent</span>
              </Button>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDeleteFolder}
                  disabled={busy !== null}
                  className="text-zinc-600 hover:text-red-400 h-10"
                >
                  Delete folder
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                  className="text-zinc-400 h-10"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
