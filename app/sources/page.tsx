"use client";

import { toast } from "sonner";
import { SourceCard } from "@/components/source-card";
import { AddSourceDialog } from "@/components/add-source-dialog";
import { useSources } from "@/hooks/use-sources";
import { Loader2, Database } from "lucide-react";

export default function SourcesPage() {
  const {
    sources,
    activeSourceId,
    isLoading,
    addSource,
    updateSource,
    deleteSource,
    setActiveSource,
  } = useSources();

  const handleAddSource = async (source: {
    name: string;
    url: string;
    queryParam: string;
  }) => {
    try {
      await addSource(source);
      toast.success("Source added successfully");
    } catch (err) {
      toast.error("Failed to add source");
      throw err;
    }
  };

  const handleUpdateSource = async (
    id: string,
    updates: { name?: string; url?: string; queryParam?: string }
  ) => {
    try {
      await updateSource(id, updates);
      toast.success("Source updated");
    } catch (err) {
      toast.error("Failed to update source");
      throw err;
    }
  };

  const handleDeleteSource = async (id: string) => {
    try {
      await deleteSource(id);
      toast.success("Source deleted");
    } catch (err) {
      toast.error("Failed to delete source");
      throw err;
    }
  };

  const handleSetActive = async (id: string) => {
    try {
      await setActiveSource(id);
      toast.success("Active source updated");
    } catch (err) {
      toast.error("Failed to set active source");
    }
  };

  return (
    <main className="min-h-screen pt-14">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Sources</h1>
            <p className="text-zinc-500 text-sm mt-1">
              Manage your torrent search API sources
            </p>
          </div>
          <AddSourceDialog onAdd={handleAddSource} />
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-zinc-500" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && sources.length === 0 && (
          <div className="text-center py-12 bg-zinc-900/30 rounded-xl border border-zinc-800">
            <Database className="h-12 w-12 text-zinc-700 mx-auto mb-4" />
            <h3 className="font-medium text-zinc-400 mb-2">No sources yet</h3>
            <p className="text-sm text-zinc-600 mb-4">
              Add a torrent search API source to start searching for content.
            </p>
            <AddSourceDialog onAdd={handleAddSource} />
          </div>
        )}

        {/* Source list */}
        {!isLoading && sources.length > 0 && (
          <div className="space-y-3">
            {sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                isActive={source.id === activeSourceId}
                onSetActive={() => handleSetActive(source.id)}
                onUpdate={(updates) => handleUpdateSource(source.id, updates)}
                onDelete={() => handleDeleteSource(source.id)}
              />
            ))}
          </div>
        )}

        {/* Info section */}
        <div className="mt-8 p-4 bg-zinc-900/30 rounded-xl border border-zinc-800">
          <h3 className="font-medium text-zinc-300 mb-2">
            Expected API Response Format
          </h3>
          <p className="text-sm text-zinc-500 mb-3">
            Your API should return JSON in this format:
          </p>
          <pre className="text-xs bg-black/50 p-3 rounded-lg overflow-x-auto text-zinc-400">
            {JSON.stringify(
              {
                results: [
                  {
                    title: "Movie Name (2024) [4K]",
                    magnet: "magnet:?xt=urn:btih:...",
                    seeds: 1500,
                    size: "8.2 GB",
                    quality: "4K",
                    type: "movie",
                  },
                ],
              },
              null,
              2
            )}
          </pre>
        </div>
      </div>
    </main>
  );
}
