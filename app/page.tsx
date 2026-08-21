"use client";

import { useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ContinueWatching } from "@/components/continue-watching";
import { FilePicker } from "@/components/file-picker";
import { FolderCard } from "@/components/folder-card";
import { FolderDialog } from "@/components/folder-dialog";
import { LibraryCard } from "@/components/library-card";
import { LibraryToolbar, type CategoryFilter } from "@/components/library-toolbar";
import { MagnetInput } from "@/components/magnet-input";
import { StoragePanel } from "@/components/storage-panel";
import { useLibrary } from "@/hooks/use-library";
import { useWatchProgress } from "@/hooks/use-watch-progress";
import {
  Plus,
  Film,
  Tv,
  Loader2,
  BookmarkPlus,
  FolderPlus,
  SearchX,
} from "lucide-react";
import { isValidTorrentInput, extractTitleFromInput } from "@/lib/torrent-utils";
import { detectCategory } from "@/lib/category";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LibraryItemWithUsage, LibraryCategory, WatchRecord } from "@/types";

/** Movies / Series segmented picker used in both create dialogs. */
function CategoryPicker({
  value,
  onChange,
}: {
  value: LibraryCategory;
  onChange: (c: LibraryCategory) => void;
}) {
  const options: { value: LibraryCategory; label: string; icon: typeof Film }[] = [
    { value: "movie", label: "Movie", icon: Film },
    { value: "series", label: "Series", icon: Tv },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            "h-11 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors",
            value === v
              ? "bg-purple-600 border-purple-500 text-white"
              : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200"
          )}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Player URL. `from` is where Close and the browser's back button return to —
 * the card you opened, not a bare home page.
 */
function watchUrl(
  infoHash: string,
  title: string,
  fileIndex: number,
  from: string
) {
  return (
    `/watch/${infoHash}?title=${encodeURIComponent(title)}` +
    `&file=${fileIndex}&from=${encodeURIComponent(from)}`
  );
}

function LibraryView() {
  const router = useRouter();
  const {
    items,
    folders,
    isLoading: libraryLoading,
    addItem,
    deleteItem,
    clearItemCache,
    moveItem,
    setItemCategory,
    createFolder,
    renameFolder,
    setFolderCategory,
    deleteFolder,
    clearFolderCache,
  } = useLibrary();

  const { records: watchRecords, forget: forgetWatchRecord } = useWatchProgress();

  // Which card is open lives in the URL (?folder=, ?listing=) rather than in
  // component state. That way returning from the player — by our own Close
  // button or the browser's back gesture — restores the card you opened.
  const searchParams = useSearchParams();
  const folderParam = searchParams.get("folder");
  const listingParam = searchParams.get("listing");

  // A magnet pasted into the quick-add bar isn't a library item, so it has no
  // id to address it by in the URL. Those open the picker through this slot.
  const [transientPicker, setTransientPicker] = useState<{
    magnet: string;
    title: string;
  } | null>(null);

  // Add dialog state
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMagnet, setNewMagnet] = useState("");
  const [newItemFolderId, setNewItemFolderId] = useState<string>("");
  const [newItemCategory, setNewItemCategory] = useState<LibraryCategory | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Folder state
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderCategory, setNewFolderCategory] = useState<LibraryCategory | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Browse state
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");

  const [isLoadingPlay, setIsLoadingPlay] = useState(false);
  const [vlcUrl, setVlcUrl] = useState<string | null>(null);
  const [vlcCopied, setVlcCopied] = useState(false);
  // When VLC mode is active, file picker uses this callback instead of navigating
  const [vlcPickerCallback, setVlcPickerCallback] = useState<((fileIndex: number) => void) | null>(null);

  const openFolder = folders.find((f) => f.id === folderParam) ?? null;

  const listingItem = items.find((i) => i.id === listingParam) ?? null;
  const pickerMagnet = listingItem?.magnet ?? transientPicker?.magnet ?? "";
  const pickerTitle = listingItem?.name ?? transientPicker?.title ?? "";
  const pickerOpen = Boolean(listingItem || transientPicker);

  /** The home URL with card params patched; a null value clears one. */
  const homeUrl = (next: { folder?: string | null; listing?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  // Opening pushes, so back closes the card. Closing replaces, so back doesn't
  // reopen what you just dismissed.
  const openFolderCard = (id: string) =>
    router.push(homeUrl({ folder: id }), { scroll: false });

  const closeFolderCard = () =>
    router.replace(homeUrl({ folder: null, listing: null }), { scroll: false });

  const closePicker = () => {
    setTransientPicker(null);
    router.replace(homeUrl({ listing: null }), { scroll: false });
  };

  // Category is auto-detected from what you type until you override it.
  const effectiveNewItemCategory = newItemCategory ?? detectCategory(newName, newMagnet);
  const effectiveNewFolderCategory = newFolderCategory ?? detectCategory(newFolderName);

  // --- Search + category filtering -----------------------------------------

  const matches = (name: string) =>
    name.toLowerCase().includes(query.trim().toLowerCase());

  // Count the rows actually listed: folders, plus items not filed into one.
  const counts = useMemo(() => {
    const rows = [
      ...folders.map((f) => f.category),
      ...items.filter((i) => !i.folderId).map((i) => i.category),
    ];
    const movie = rows.filter((c) => c === "movie").length;
    return {
      all: rows.length,
      movie,
      series: rows.length - movie,
    } as Record<CategoryFilter, number>;
  }, [items, folders]);

  const visibleFolders = folders.filter(
    (f) =>
      (filter === "all" || f.category === filter) &&
      // A folder also matches when something inside it matches the search.
      (matches(f.name) ||
        items.some((i) => i.folderId === f.id && matches(i.name)))
  );

  const visibleLooseItems = items.filter(
    (i) => !i.folderId && (filter === "all" || i.category === filter) && matches(i.name)
  );

  const isFiltering = query.trim().length > 0 || filter !== "all";
  const nothingMatched =
    !libraryLoading &&
    isFiltering &&
    visibleFolders.length === 0 &&
    visibleLooseItems.length === 0;
  const libraryEmpty = !libraryLoading && items.length === 0 && folders.length === 0;

  const handlePlayMagnet = async (
    magnet: string,
    title?: string,
    options: { forcePicker?: boolean; itemId?: string } = {}
  ) => {
    // Extract name from magnet/URL if not provided
    if (!title) {
      title = extractTitleFromInput(magnet);
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

      if (!options.forcePicker && videoFiles.length === 1) {
        // Single video — play it, remembering the card we came from.
        const fileIndex = data.mainVideoIndex ?? 0;
        router.push(
          watchUrl(data.infoHash, title || data.name, fileIndex, homeUrl({}))
        );
      } else if (options.itemId) {
        // Season pack in the library: the picker itself becomes part of the URL.
        router.push(homeUrl({ listing: options.itemId }), { scroll: false });
      } else {
        // A pasted magnet has no library id to put in the URL.
        setTransientPicker({ magnet, title: title ?? "" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load";
      toast.error(message);
    } finally {
      setIsLoadingPlay(false);
    }
  };

  const handleOpenListing = (item: LibraryItemWithUsage) =>
    handlePlayMagnet(item.magnet, item.name, {
      forcePicker: true,
      itemId: item.id,
    });

  // Resuming has to re-add the torrent before navigating: the watch page waits
  // on /api/torrents and would sit on "Finding peers…" forever for a torrent the
  // worker no longer holds. Goes straight to the saved file — never the picker.
  const handleResume = async (record: WatchRecord) => {
    setIsLoadingPlay(true);
    try {
      const res = await fetch("/api/torrent/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet: record.magnet }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to load");
      }
      const data = await res.json();

      router.push(
        watchUrl(data.infoHash, record.title, record.fileIndex, homeUrl({}))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resume");
    } finally {
      setIsLoadingPlay(false);
    }
  };

  const handleVLC = async (magnet: string, title?: string) => {
    if (!title) title = extractTitleFromInput(magnet);
    setIsLoadingPlay(true);
    try {
      const [filesRes, portRes] = await Promise.all([
        fetch("/api/torrent/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ magnet }),
        }),
        fetch("/api/worker-port"),
      ]);
      if (!filesRes.ok) throw new Error("Failed to load torrent");
      const data = await filesRes.json();
      const { port } = await portRes.json();
      const host = window.location.hostname;
      const buildUrl = (fileIndex: number) =>
        `http://${host}:${port}/stream/${data.infoHash}?file=${fileIndex}`;
      const videoFiles = data.files.filter((f: { isVideo: boolean }) => f.isVideo);

      if (videoFiles.length <= 1) {
        setVlcUrl(buildUrl(data.mainVideoIndex ?? 0));
      } else {
        // Multi-file: open picker, then show URL for chosen file
        setVlcPickerCallback(() => (fileIndex: number) => {
          setVlcUrl(buildUrl(fileIndex));
          setVlcPickerCallback(null);
        });
        setTransientPicker({ magnet, title: title ?? "" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setIsLoadingPlay(false);
    }
  };

  const handleSelectFile = (
    infoHash: string,
    fileIndex: number,
    fileName: string
  ) => {
    // VLC mode: show URL popup instead of navigating
    if (vlcPickerCallback) {
      closePicker();
      vlcPickerCallback(fileIndex);
      return;
    }

    // Persist chosen episode index to the library item
    const libItem = items.find((i: LibraryItemWithUsage) => i.magnet === pickerMagnet);
    if (libItem) {
      fetch(`/api/library/${libItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIndex }),
      }).catch(() => {});
    }

    // The picker stays in the URL on purpose: back from the player reopens it.
    const title = pickerTitle || fileName;
    router.push(watchUrl(infoHash, title, fileIndex, homeUrl({})));
  };

  const handleAddToLibrary = async () => {
    if (!newName.trim() || !newMagnet.trim()) return;

    setIsAdding(true);
    try {
      await addItem({
        name: newName.trim(),
        magnet: newMagnet.trim(),
        folderId: newItemFolderId || null,
        category: effectiveNewItemCategory,
      });
      const folderName = folders.find((f) => f.id === newItemFolderId)?.name;
      toast.success(folderName ? `Added to "${folderName}"` : "Added to library");
      setNewName("");
      setNewMagnet("");
      setNewItemCategory(null);
      setAddDialogOpen(false);
    } catch {
      toast.error("Failed to add to library");
    } finally {
      setIsAdding(false);
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;

    setIsCreatingFolder(true);
    try {
      const folder = await createFolder(name, effectiveNewFolderCategory);
      toast.success(`Created folder "${name}"`);
      setNewFolderName("");
      setNewFolderCategory(null);
      setNewFolderOpen(false);
      if (folder?.id) openFolderCard(folder.id);
    } catch {
      toast.error("Failed to create folder");
    } finally {
      setIsCreatingFolder(false);
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

  const handleClearCache = async (id: string, name: string) => {
    try {
      const res = await clearItemCache(id);
      toast.success(
        res.reclaimedFormatted && res.reclaimedBytes
          ? `Reclaimed ${res.reclaimedFormatted} from "${name}"`
          : `Cache cleared for "${name}"`
      );
    } catch {
      toast.error("Failed to clear cache");
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
            <Loader2 className="h-12 w-12 animate-spin text-purple-500" />
            <p className="text-zinc-300">Loading...</p>
          </div>
        </div>
      )}

      {/* VLC stream URL popup */}
      {vlcUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center px-4" onClick={() => setVlcUrl(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 sm:p-6 max-w-lg w-full shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Stream URL</h2>
              <button onClick={() => { setVlcUrl(null); setVlcCopied(false); }} className="text-zinc-500 hover:text-white transition-colors text-lg leading-none h-9 w-9">✕</button>
            </div>
            <p className="text-xs text-zinc-500 mb-3">Paste this into VLC → Media → Open Network Stream</p>
            <div
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-3 font-mono text-xs text-zinc-300 break-all cursor-pointer hover:border-zinc-500 transition-colors mb-4"
              onClick={() => {
                navigator.clipboard.writeText(vlcUrl);
                setVlcCopied(true);
                setTimeout(() => setVlcCopied(false), 2000);
              }}
              title="Click to copy"
            >
              {vlcUrl}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button
                className="flex-1 h-11"
                onClick={() => {
                  navigator.clipboard.writeText(vlcUrl);
                  setVlcCopied(true);
                  setTimeout(() => setVlcCopied(false), 2000);
                }}
              >
                {vlcCopied ? "Copied!" : "Copy URL"}
              </Button>
              <Button variant="outline" className="border-zinc-700 h-11" onClick={() => { setVlcUrl(null); setVlcCopied(false); }}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto px-4 py-6 sm:py-8">
        {/* Header */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">
            <span className="mr-2">🛸</span>Spaceflix
          </h1>
        </div>

        {/* Quick Play */}
        <div className="mb-6 sm:mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px flex-1 bg-zinc-800" />
            <span className="text-xs text-zinc-600 uppercase tracking-wider">
              Quick Play
            </span>
            <div className="h-px flex-1 bg-zinc-800" />
          </div>
          <MagnetInput onSubmit={handleQuickPlay} />
        </div>

        {/* Continue Watching — hides itself when nothing is in progress */}
        {watchRecords.length > 0 && (
          <div className="mb-6 sm:mb-8">
            <ContinueWatching
              records={watchRecords}
              onResume={handleResume}
              onForget={forgetWatchRecord}
            />
          </div>
        )}

        {/* Storage */}
        <div className="mb-6 sm:mb-8">
          <StoragePanel />
        </div>

        {/* Library */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-semibold text-zinc-300 shrink-0">My Library</h2>
            <div className="flex items-center gap-2">
              <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5 h-10 border-zinc-700">
                    <FolderPlus className="h-4 w-4" />
                    <span className="hidden sm:inline">New Folder</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-zinc-900 border-zinc-800 p-5 sm:p-6">
                  <DialogHeader>
                    <DialogTitle>New Folder</DialogTitle>
                  </DialogHeader>
                  <div className="py-2 space-y-4">
                    <div>
                      <label className="text-sm text-zinc-400 mb-2 block">
                        Folder name
                      </label>
                      <Input
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                        placeholder="e.g. Invincible S4, or Alien Collection"
                        className="bg-zinc-800 border-zinc-700 h-11 text-base sm:text-sm"
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-sm text-zinc-400 mb-2 block">
                        Category
                      </label>
                      <CategoryPicker
                        value={effectiveNewFolderCategory}
                        onChange={setNewFolderCategory}
                      />
                    </div>
                    <p className="text-xs text-zinc-600">
                      Hold a series or a movie set together — add one magnet per
                      episode, and clear each one&apos;s cache when you&apos;re done with it.
                    </p>
                  </div>
                  <Button
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || isCreatingFolder}
                    className="h-11 w-full sm:w-auto sm:ml-auto"
                  >
                    {isCreatingFolder ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <FolderPlus className="h-4 w-4 mr-2" />
                    )}
                    Create
                  </Button>
                </DialogContent>
              </Dialog>

              <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-1.5 h-10">
                    <Plus className="h-4 w-4" />
                    Add
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-zinc-900 border-zinc-800 p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Add to Library</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div>
                      <label className="text-sm text-zinc-400 mb-2 block">
                        Name
                      </label>
                      <Input
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Movie or Show Name"
                        className="bg-zinc-800 border-zinc-700 h-11 text-base sm:text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-zinc-400 mb-2 block">
                        Magnet Link
                      </label>
                      <Input
                        value={newMagnet}
                        onChange={(e) => setNewMagnet(e.target.value)}
                        placeholder="Input URL..."
                        className="bg-zinc-800 border-zinc-700 font-mono text-xs h-11"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-zinc-400 mb-2 block">
                        Category
                      </label>
                      <CategoryPicker
                        value={effectiveNewItemCategory}
                        onChange={setNewItemCategory}
                      />
                    </div>
                    {folders.length > 0 && (
                      <div>
                        <label className="text-sm text-zinc-400 mb-2 block">
                          Folder
                        </label>
                        <select
                          value={newItemFolderId}
                          onChange={(e) => setNewItemFolderId(e.target.value)}
                          className="w-full h-11 rounded-md bg-zinc-800 border border-zinc-700 px-3 text-base sm:text-sm text-zinc-200"
                        >
                          <option value="">No folder</option>
                          {folders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <Button
                    onClick={handleAddToLibrary}
                    disabled={
                      !newName.trim() ||
                      !isValidTorrentInput(newMagnet) ||
                      isAdding
                    }
                    className="h-11 w-full sm:w-auto sm:ml-auto"
                  >
                    {isAdding ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <BookmarkPlus className="h-4 w-4 mr-2" />
                    )}
                    Save
                  </Button>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Search + category filters */}
          {!libraryEmpty && (
            <LibraryToolbar
              query={query}
              onQueryChange={setQuery}
              filter={filter}
              onFilterChange={setFilter}
              counts={counts}
            />
          )}

          {/* Loading */}
          {libraryLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
            </div>
          )}

          {/* Folders */}
          {visibleFolders.length > 0 && (
            <div className="space-y-2 mb-3">
              {visibleFolders.map((folder) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  onOpen={() => openFolderCard(folder.id)}
                />
              ))}
            </div>
          )}

          {/* Loose library items (anything not filed into a folder) */}
          {visibleLooseItems.length > 0 && (
            <div className="space-y-2">
              {visibleLooseItems.map((item) => (
                <LibraryCard
                  key={item.id}
                  item={item}
                  folders={folders}
                  onPlay={() =>
                    handlePlayMagnet(item.magnet, item.name, { itemId: item.id })
                  }
                  onOpen={() => handleOpenListing(item)}
                  onDelete={() => handleDelete(item.id, item.name)}
                  onClearCache={() => handleClearCache(item.id, item.name)}
                  onVLC={() => handleVLC(item.magnet, item.name)}
                  onMoveToFolder={(folderId) => moveItem(item.id, folderId)}
                  onSetCategory={(category) => setItemCategory(item.id, category)}
                />
              ))}
            </div>
          )}

          {/* Nothing matched the current search/filter */}
          {nothingMatched && (
            <div className="text-center py-12 bg-zinc-900/30 rounded-xl border border-zinc-800">
              <SearchX className="h-10 w-10 text-zinc-700 mx-auto mb-3" />
              <h3 className="font-medium text-zinc-400 mb-1">No matches</h3>
              <p className="text-sm text-zinc-600 mb-4 px-4">
                Nothing here for{" "}
                {query.trim() ? `“${query.trim()}”` : "this category"}.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
                className="border-zinc-700 h-10"
              >
                Clear filters
              </Button>
            </div>
          )}

          {/* Empty library */}
          {libraryEmpty && (
            <div className="text-center py-12 bg-zinc-900/30 rounded-xl border border-zinc-800">
              <Film className="h-12 w-12 text-zinc-700 mx-auto mb-4" />
              <h3 className="font-medium text-zinc-400 mb-2">
                No saved items yet
              </h3>
              <p className="text-sm text-zinc-600 mb-4 px-4">
                Add magnet links to your library to access them from any device
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center px-4">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddDialogOpen(true)}
                  className="border-zinc-700 h-10"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add First Item
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setNewFolderOpen(true)}
                  className="border-zinc-700 h-10"
                >
                  <FolderPlus className="h-4 w-4 mr-1.5" />
                  Create a Folder
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* File picker modal */}
      {pickerMagnet && (
        <FilePicker
          open={pickerOpen}
          onClose={closePicker}
          magnet={pickerMagnet}
          title={pickerTitle}
          onSelectFile={handleSelectFile}
        />
      )}

      {/* Folder modal */}
      {openFolder && (
        <FolderDialog
          open
          onClose={closeFolderCard}
          folder={openFolder}
          items={items.filter((i) => i.folderId === openFolder.id)}
          onPlay={(item) =>
            handlePlayMagnet(item.magnet, item.name, { itemId: item.id })
          }
          onOpenListing={(item) => handleOpenListing(item)}
          onVLC={(item) => handleVLC(item.magnet, item.name)}
          onAddItem={(input) => addItem({ ...input, folderId: openFolder.id })}
          onClearItemCache={(id) => clearItemCache(id)}
          onDeleteItem={(id) => deleteItem(id)}
          onMoveOut={(id) => moveItem(id, null)}
          onClearFolderCache={() => clearFolderCache(openFolder.id)}
          onRename={(name) => renameFolder(openFolder.id, name)}
          onSetCategory={(category) => setFolderCategory(openFolder.id, category)}
          onDeleteFolder={(opts) => deleteFolder(openFolder.id, opts)}
        />
      )}
    </main>
  );
}

// useSearchParams needs a Suspense boundary for this route to prerender.
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <LibraryView />
    </Suspense>
  );
}
