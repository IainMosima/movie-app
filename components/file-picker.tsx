"use client";

import { useState, useEffect, useRef } from "react";
import {
  Film,
  FileText,
  File,
  Play,
  Loader2,
  HardDrive,
  Star,
  Users,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface TorrentFile {
  index: number;
  name: string;
  path: string;
  size: number;
  sizeFormatted: string;
  isVideo: boolean;
  extension: string;
}

interface TorrentStatus {
  status: "not_found" | "connecting" | "ready";
  name?: string;
  peers?: number;
  ready?: boolean;
  files?: number;
}

interface FilePickerProps {
  open: boolean;
  onClose: () => void;
  magnet: string;
  title: string;
  onSelectFile: (infoHash: string, fileIndex: number, fileName: string) => void;
}

export function FilePicker({
  open,
  onClose,
  magnet,
  title,
  onSelectFile,
}: FilePickerProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [torrentName, setTorrentName] = useState("");
  const [infoHash, setInfoHash] = useState("");
  const [files, setFiles] = useState<TorrentFile[]>([]);
  const [mainVideoIndex, setMainVideoIndex] = useState<number | null>(null);

  // Status polling
  const [status, setStatus] = useState<TorrentStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState("Starting...");
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (open && magnet) {
      fetchFiles();
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, [open, magnet]);

  const pollStatus = () => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/torrent/status?magnet=${encodeURIComponent(magnet)}`
        );
        if (res.ok) {
          const data: TorrentStatus = await res.json();
          setStatus(data);

          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);

          if (data.status === "connecting") {
            if (data.peers && data.peers > 0) {
              setStatusMessage(
                `Connected to ${data.peers} peer${data.peers > 1 ? "s" : ""}... (${elapsed}s)`
              );
            } else {
              setStatusMessage(`Searching for peers... (${elapsed}s)`);
            }
          } else if (data.status === "ready") {
            setStatusMessage("Loading file list...");
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 1000);
  };

  const fetchFiles = async () => {
    setIsLoading(true);
    setError(null);
    setFiles([]);
    setStatus(null);
    setStatusMessage("Connecting to peers...");
    startTimeRef.current = Date.now();

    // Start status polling
    pollStatus();

    try {
      const res = await fetch("/api/torrent/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet }),
      });

      // Stop polling
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch files");
      }

      const data = await res.json();
      setTorrentName(data.name);
      setInfoHash(data.infoHash);
      setFiles(data.files);
      setMainVideoIndex(data.mainVideoIndex);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch files");
    } finally {
      setIsLoading(false);
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    }
  };

  const handlePlay = (fileIndex: number) => {
    if (infoHash) {
      const file = files[fileIndex];
      onSelectFile(infoHash, fileIndex, file?.name || "video");
    }
  };

  const getFileIcon = (file: TorrentFile) => {
    if (file.isVideo) return Film;
    if (
      file.extension === "srt" ||
      file.extension === "sub" ||
      file.extension === "ass"
    )
      return FileText;
    return File;
  };

  const videoFiles = files.filter((f) => f.isVideo);
  const otherFiles = files.filter((f) => !f.isVideo);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-zinc-900 border-zinc-800 max-w-2xl max-h-[85vh] h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="pr-8 truncate">{title}</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="relative">
              <Loader2 className="h-10 w-10 animate-spin text-red-500" />
              {status?.peers !== undefined && status.peers > 0 && (
                <div className="absolute -top-1 -right-1 bg-green-500 text-white text-[10px] rounded-full h-5 w-5 flex items-center justify-center font-bold">
                  {status.peers}
                </div>
              )}
            </div>

            <div className="text-center">
              <p className="text-sm text-zinc-300 mb-1">{statusMessage}</p>
              <p className="text-xs text-zinc-600">
                This can take up to a minute for rare torrents
              </p>
            </div>

            {/* Connection indicator */}
            <div className="flex items-center gap-4 mt-2 text-xs text-zinc-500">
              <span className="flex items-center gap-1">
                <Wifi
                  className={cn(
                    "h-3.5 w-3.5",
                    status?.peers && status.peers > 0
                      ? "text-green-500"
                      : "text-zinc-600"
                  )}
                />
                {status?.peers || 0} peers
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="mt-4 text-zinc-500"
            >
              Cancel
            </Button>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <p className="text-red-400">{error}</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onClose}
                className="border-zinc-700"
              >
                Cancel
              </Button>
              <Button variant="outline" onClick={fetchFiles} className="border-zinc-700">
                Try Again
              </Button>
            </div>
          </div>
        )}

        {!isLoading && !error && files.length > 0 && (
          <>
            {/* Torrent name */}
            <div className="px-1 pb-2 border-b border-zinc-800">
              <p className="text-sm text-zinc-400 truncate">
                <HardDrive className="h-3.5 w-3.5 inline mr-1.5" />
                {torrentName}
              </p>
              <p className="text-xs text-zinc-600 mt-1">
                {files.length} file{files.length !== 1 ? "s" : ""} •{" "}
                {videoFiles.length} video{videoFiles.length !== 1 ? "s" : ""}
              </p>
            </div>

            <div className="flex-1 -mx-6 px-6 overflow-y-auto scrollbar-visible" style={{ scrollbarWidth: 'auto', scrollbarColor: '#dc2626 #27272a' }}>
              <div className="space-y-4 py-2 pr-2">
                {/* Video files */}
                {videoFiles.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-zinc-500 mb-3 uppercase tracking-wider">
                      Video Files
                    </h3>
                    <div className="space-y-2">
                      {videoFiles.map((file) => {
                        const Icon = getFileIcon(file);
                        const isMain = file.index === mainVideoIndex;

                        return (
                          <button
                            key={file.index}
                            onClick={() => handlePlay(file.index)}
                            className="group w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all hover:bg-red-600/20 border-2 border-transparent hover:border-red-600 hover:scale-[1.01] focus:bg-red-600/20 focus:border-red-600 focus:outline-none"
                          >
                            <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0 bg-zinc-800 group-hover:bg-red-600 transition-colors">
                              <Icon className="h-6 w-6" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-base text-zinc-200 truncate font-medium">
                                {file.name}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm text-zinc-500">
                                  {file.sizeFormatted}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-xs uppercase border-zinc-700"
                                >
                                  {file.extension}
                                </Badge>
                                {isMain && (
                                  <span className="flex items-center gap-1 text-xs text-amber-500">
                                    <Star className="h-3.5 w-3.5 fill-current" />
                                    Main
                                  </span>
                                )}
                              </div>
                            </div>
                            <Play className="h-6 w-6 text-zinc-600 group-hover:text-red-400 shrink-0 transition-colors" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Other files */}
                {otherFiles.length > 0 && (
                  <div>
                    <h3 className="text-xs font-medium text-zinc-500 mb-2 uppercase tracking-wider">
                      Other Files
                    </h3>
                    <div className="space-y-1">
                      {otherFiles.map((file) => {
                        const Icon = getFileIcon(file);
                        return (
                          <div
                            key={file.index}
                            className="flex items-center gap-3 p-2 rounded-lg text-zinc-500"
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="text-xs truncate flex-1">
                              {file.name}
                            </span>
                            <span className="text-xs shrink-0">
                              {file.sizeFormatted}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end pt-4 border-t border-zinc-800">
              <Button variant="ghost" onClick={onClose} size="lg" className="px-6">
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
