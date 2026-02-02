"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FilePicker } from "@/components/file-picker";
import { MagnetInput } from "@/components/magnet-input";
import { useLibrary } from "@/hooks/use-library";
import {
  Play,
  Trash2,
  Plus,
  Film,
  Loader2,
  BookmarkPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LibraryItem } from "@/types";

export default function HomePage() {
  const router = useRouter();
  const { items, isLoading: libraryLoading, addItem, deleteItem } = useLibrary();

  // File picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedMagnet, setSelectedMagnet] = useState("");
  const [selectedTitle, setSelectedTitle] = useState("");

  // Add dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMagnet, setNewMagnet] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [isLoadingPlay, setIsLoadingPlay] = useState(false);

  const handlePlayMagnet = async (magnet: string, title?: string) => {
    // Extract name from magnet if not provided
    if (!title) {
      const dnMatch = magnet.match(/dn=([^&]+)/);
      title = dnMatch
        ? decodeURIComponent(dnMatch[1].replace(/\+/g, " "))
        : "Unknown";
    }

    setIsLoadingPlay(true);

    try {
      // Fetch files to check how many videos
      const res = await fetch("/api/torrent/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to load");
      }

      const data = await res.json();
      const videoFiles = data.files.filter((f: { isVideo: boolean }) => f.isVideo);

      if (videoFiles.length === 1) {
        // Single video - play directly
        const fileIndex = data.mainVideoIndex ?? 0;
        router.push(
          `/watch/${data.infoHash}?title=${encodeURIComponent(title || data.name)}&file=${fileIndex}`
        );
      } else {
        // Multiple videos - show picker
        setSelectedMagnet(magnet);
        setSelectedTitle(title);
        setPickerOpen(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load";
      toast.error(message);
    } finally {
      setIsLoadingPlay(false);
    }
  };

  const handleSelectFile = (
    infoHash: string,
    fileIndex: number,
    fileName: string
  ) => {
    setPickerOpen(false);
    const title = selectedTitle || fileName;
    router.push(
      `/watch/${infoHash}?title=${encodeURIComponent(title)}&file=${fileIndex}`
    );
  };

  const handleAddToLibrary = async () => {
    if (!newName.trim() || !newMagnet.trim()) return;

    setIsAdding(true);
    try {
      await addItem({
        name: newName.trim(),
        magnet: newMagnet.trim(),
      });
      toast.success("Added to library");
      setNewName("");
      setNewMagnet("");
      setAddDialogOpen(false);
    } catch (err) {
      toast.error("Failed to add to library");
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteItem(id);
      toast.success(`Removed "${name}"`);
    } catch {
      toast.error("Failed to remove");
    }
  };

  // Quick add from magnet input
  const handleQuickPlay = (magnet: string) => {
    handlePlayMagnet(magnet);
  };

  return (
    <main className="min-h-screen pt-14">
      {/* Loading overlay */}
      {isLoadingPlay && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-red-500" />
            <p className="text-zinc-300">Loading...</p>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
            <span className="mr-2">🛸</span>Spaceflix
          </h1>
        </div>

        {/* Quick Play */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="text-xs text-zinc-600 uppercase tracking-wider">
              Quick Play
            </span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>
          <MagnetInput onSubmit={handleQuickPlay} />
        </div>

        {/* Library */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-zinc-300">My Library</h2>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-zinc-900 border-zinc-800">
                <DialogHeader>
                  <DialogTitle>Add to Library</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm text-zinc-400 mb-2 block">
                      Name
                    </label>
                    <Input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Movie or Show Name"
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-zinc-400 mb-2 block">
                      Magnet Link
                    </label>
                    <Input
                      value={newMagnet}
                      onChange={(e) => setNewMagnet(e.target.value)}
                      placeholder="magnet:?xt=urn:btih:..."
                      className="bg-zinc-800 border-zinc-700 font-mono text-xs"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={handleAddToLibrary}
                    disabled={
                      !newName.trim() ||
                      !newMagnet.startsWith("magnet:") ||
                      isAdding
                    }
                  >
                    {isAdding ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <BookmarkPlus className="h-4 w-4 mr-2" />
                    )}
                    Save
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {/* Loading */}
          {libraryLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          )}

          {/* Empty state */}
          {!libraryLoading && items.length === 0 && (
            <div className="text-center py-12 bg-zinc-900/30 rounded-xl border border-zinc-800">
              <Film className="h-12 w-12 text-zinc-700 mx-auto mb-4" />
              <h3 className="font-medium text-zinc-400 mb-2">
                No saved items yet
              </h3>
              <p className="text-sm text-zinc-600 mb-4">
                Add magnet links to your library to access them from any device
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddDialogOpen(true)}
                className="border-zinc-700"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add First Item
              </Button>
            </div>
          )}

          {/* Library items */}
          {!libraryLoading && items.length > 0 && (
            <div className="space-y-2">
              {items.map((item) => (
                <LibraryCard
                  key={item.id}
                  item={item}
                  onPlay={() => handlePlayMagnet(item.magnet, item.name)}
                  onDelete={() => handleDelete(item.id, item.name)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* File picker modal */}
      {selectedMagnet && (
        <FilePicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          magnet={selectedMagnet}
          title={selectedTitle}
          onSelectFile={handleSelectFile}
        />
      )}
    </main>
  );
}

function LibraryCard({
  item,
  onPlay,
  onDelete,
}: {
  item: LibraryItem;
  onPlay: () => void;
  onDelete: () => void;
}) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleting(true);
    await onDelete();
  };

  return (
    <Card
      className="group p-4 bg-zinc-900/50 border-zinc-800 hover:bg-zinc-800/50 hover:border-zinc-700 transition-all cursor-pointer"
      onClick={onPlay}
    >
      <div className="flex items-center gap-4">
        <Button
          size="icon"
          className="h-12 w-12 rounded-lg bg-zinc-800 group-hover:bg-red-600 transition-colors shrink-0"
        >
          <Play className="h-5 w-5 fill-current" />
        </Button>

        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-zinc-100 truncate group-hover:text-white">
            {item.name}
          </h3>
          <p className="text-xs text-zinc-600 mt-1">
            Added {new Date(item.addedAt).toLocaleDateString()}
          </p>
        </div>

        {item.quality && (
          <Badge className="shrink-0 bg-zinc-800 text-zinc-400">
            {item.quality}
          </Badge>
        )}

        <Button
          size="icon"
          variant="ghost"
          onClick={handleDelete}
          disabled={isDeleting}
          className="h-8 w-8 text-zinc-600 hover:text-red-400 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </Card>
  );
}
