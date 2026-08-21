"use client";

import { useEffect, useRef, useCallback, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { VideoPlayer } from "@/components/video-player";
import { Loader2, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WatchPageProps {
  params: Promise<{ infoHash: string }>;
}

/** Something else still holding disk space while this one plays. */
interface PurgeCandidate {
  id: string;
  name: string;
  bytes: number;
  formatted: string;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

export default function WatchPage({ params }: WatchPageProps) {
  const { infoHash } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const title = searchParams.get("title") || "Unknown";
  const fileIndex = searchParams.get("file");
  // Where leaving the player returns to — the card that opened it. Only
  // same-origin relative paths are honoured, so a crafted ?from= can't
  // redirect anywhere off this app.
  const fromParam = searchParams.get("from");
  const returnTo =
    fromParam && fromParam.startsWith("/") && !fromParam.startsWith("//")
      ? fromParam
      : "/";
  const sessionIdRef = useRef<string | null>(null);
  const hasStartedRef = useRef(false);
  const [subtitles, setSubtitles] = useState<{ label: string; src: string }[]>([]);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [probedDuration, setProbedDuration] = useState<number | null>(null);
  const [probeComplete, setProbeComplete] = useState(false);
  const [peersReady, setPeersReady] = useState(false);
  const [peers, setPeers] = useState(0);
  const [dlSpeed, setDlSpeed] = useState(0);
  // Relative cache path of the episode being watched — lets the clear-on-exit
  // prompt reclaim its bytes even if the worker has since gone away.
  const [filePath, setFilePath] = useState<string | null>(null);
  const [showClearPrompt, setShowClearPrompt] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  // Other items still holding bytes. Same-folder episodes are reclaimed by the
  // server without asking; whatever comes back here needs a yes first.
  const [purgeCandidates, setPurgeCandidates] = useState<PurgeCandidate[]>([]);
  const [reclaimedNotice, setReclaimedNotice] = useState<string | null>(null);
  const [isPurging, setIsPurging] = useState(false);
  const purgeCheckedRef = useRef(false);
  const [cachedFormatted, setCachedFormatted] = useState<string | null>(null);

  // Watch progress
  const [resumeFrom, setResumeFrom] = useState(0);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const lastPositionRef = useRef<{ positionSec: number; durationSec: number } | null>(null);

  const fileIndexNum = fileIndex ? parseInt(fileIndex, 10) || 0 : 0;

  // Get or create session + resolve direct stream URL
  useEffect(() => {
    const startSession = async () => {
      if (hasStartedRef.current) return;
      hasStartedRef.current = true;

      try {
        // Get worker port for direct streaming (bypasses Next.js proxy — faster for TV)
        const portRes = await fetch("/api/worker-port");
        if (portRes.ok) {
          const { port } = await portRes.json();
          const host = window.location.hostname;
          const filePart = fileIndex ? `?file=${fileIndex}` : "";
          const isSecure = window.location.protocol === "https:";
          if (!isSecure) {
            const workerBase = `http://${host}:${port}`;
            setStreamUrl(`${workerBase}/stream/${infoHash}${filePart}`);
          }
        }
      } catch {
        // Fallback to proxy route
      }

      // If direct URL wasn't set, use proxy fallback
      setStreamUrl((prev) => {
        if (prev) return prev;
        return fileIndex
          ? `/api/stream/${infoHash}?file=${fileIndex}`
          : `/api/stream/${infoHash}`;
      });

      // Check if torrent exists and start session
      try {
        const res = await fetch(`/api/torrents`);
        const data = await res.json();
        const torrent = data.torrents?.find(
          (t: { infoHash: string }) => t.infoHash.toLowerCase() === infoHash.toLowerCase()
        );

        if (torrent) {
          const sessionRes = await fetch("/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ magnet: `magnet:?xt=urn:btih:${infoHash}` }),
          });

          if (sessionRes.ok) {
            const sessionData = await sessionRes.json();
            sessionIdRef.current = sessionData.sessionId;
          }
        }
      } catch (err) {
        console.error("Failed to verify session:", err);
      }
    };

    startSession();
  }, [infoHash, fileIndex]);

  // Load the saved position before the player mounts, so resume is applied on
  // the very first source load rather than yanking playback back mid-watch.
  useEffect(() => {
    let cancelled = false;

    const loadProgress = async () => {
      try {
        const res = await fetch(`/api/progress/${infoHash}?file=${fileIndexNum}`);
        if (res.ok) {
          const { record } = await res.json();
          if (!cancelled && record && !record.finished) {
            setResumeFrom(record.positionSec ?? 0);
          }
        }
      } catch {
        // No saved position just means starting from the top.
      } finally {
        if (!cancelled) setProgressLoaded(true);
      }
    };

    loadProgress();
    return () => {
      cancelled = true;
    };
  }, [infoHash, fileIndexNum]);

  // Report where we are. Fire-and-forget: progress tracking must never be able
  // to interrupt playback.
  const handleProgress = useCallback(
    (positionSec: number, durationSec: number) => {
      lastPositionRef.current = { positionSec, durationSec };
      fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          infoHash,
          fileIndex: fileIndexNum,
          positionSec,
          durationSec,
          title,
        }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.record) setIsFinished(Boolean(data.record.finished));
        })
        .catch(() => {});
    },
    [infoHash, fileIndexNum, title]
  );

  // Flush the last known position when the page goes away. beforeunload alone is
  // not enough — mobile Safari often skips it, which is exactly the "I closed it
  // on my phone" case this feature exists for. visibilitychange is the reliable
  // signal there.
  useEffect(() => {
    const flush = () => {
      const last = lastPositionRef.current;
      if (!last || last.positionSec <= 0) return;
      const body = JSON.stringify({
        infoHash,
        fileIndex: fileIndexNum,
        positionSec: last.positionSec,
        durationSec: last.durationSec,
        title,
      });
      try {
        navigator.sendBeacon("/api/progress", body);
      } catch {
        // Best effort only
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", handleVisibility);
      flush();
    };
  }, [infoHash, fileIndexNum, title]);

  // Poll until we have at least 1 peer, then start streaming
  useEffect(() => {
    if (peersReady) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/torrents`);
        const data = await res.json();
        const torrent = data.torrents?.find(
          (t: { infoHash: string }) => t.infoHash.toLowerCase() === infoHash.toLowerCase()
        ) as
          | {
              numPeers: number;
              downloadSpeed: number;
              files?: { path: string }[];
            }
          | undefined;
        if (!torrent) return;
        setPeers(torrent.numPeers);
        setDlSpeed(torrent.downloadSpeed);
        const file = torrent.files?.[fileIndex ? parseInt(fileIndex, 10) : 0];
        if (file?.path) setFilePath(file.path);
        if (torrent.numPeers >= 1) setPeersReady(true);
      } catch {}
    };

    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, [peersReady, infoHash, fileIndex]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionIdRef.current) {
        fetch("/api/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ infoHash, sessionId: sessionIdRef.current }),
        }).catch(console.error);
      }
    };
  }, [infoHash]);

  // Handle beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (sessionIdRef.current) {
        navigator.sendBeacon(
          "/api/session",
          JSON.stringify({ method: "DELETE", infoHash, sessionId: sessionIdRef.current })
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [infoHash]);

  // Probe for durationSec — needed by the seek bar. Retries until MKV header is on disk.
  useEffect(() => {
    if (!streamUrl) {
      setProbeComplete(true);
      return;
    }
    const probeUrl = streamUrl.replace("/stream/", "/probe/");
    let cancelled = false;
    let attempt = 0;
    const maxAttempts = 15;

    const runProbe = async () => {
      try {
        const r = await fetch(probeUrl);
        const data = r.ok ? await r.json() : null;
        if (cancelled) return;

        if (data?.durationSec && data.durationSec > 0) {
          setProbedDuration(data.durationSec);
          setProbeComplete(true);
          return;
        }

        // No duration yet — let the player start and retry in the background
        setProbeComplete(true);
        attempt += 1;
        if (attempt < maxAttempts) {
          setTimeout(runProbe, 2000);
        }
      } catch {
        if (cancelled) return;
        setProbeComplete(true);
        attempt += 1;
        if (attempt < maxAttempts) setTimeout(runProbe, 2000);
      }
    };

    runProbe();
    return () => {
      cancelled = true;
    };
  }, [streamUrl]);

  // Fetch subtitle tracks
  useEffect(() => {
    const fetchSubtitles = async () => {
      try {
        const res = await fetch(`/api/subtitle/${infoHash}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.subtitles?.length > 0) {
          setSubtitles(
            data.subtitles.map(
              (s: { name: string; index?: number; streamIndex?: number; type?: string }) =>
                s.type === "embedded"
                  ? { label: s.name, src: `/api/subtitle/${infoHash}?embedded=${s.streamIndex}` }
                  : { label: s.name.replace(/\.[^.]+$/, ""), src: `/api/subtitle/${infoHash}?file=${s.index}` }
            )
          );
        }
      } catch (err) {
        console.error("Failed to fetch subtitles:", err);
      }
    };

    const timer = setTimeout(fetchSubtitles, 2000);
    return () => clearTimeout(timer);
  }, [infoHash]);

  // Once this episode is actually playing, anything else still on disk is dead
  // weight. Runs once per mount; never blocks playback if it fails.
  useEffect(() => {
    if (!streamUrl || !peersReady || purgeCheckedRef.current) return;
    purgeCheckedRef.current = true;

    fetch("/api/purge-previous", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ infoHash }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.reclaimedBytes > 0) setReclaimedNotice(data.reclaimedFormatted);
        if (data.pending?.length) setPurgeCandidates(data.pending);
      })
      .catch(() => {});
  }, [streamUrl, peersReady, infoHash]);

  // Auto-dismiss the "reclaimed X" note so it doesn't sit over the film.
  useEffect(() => {
    if (!reclaimedNotice) return;
    const timer = setTimeout(() => setReclaimedNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [reclaimedNotice]);

  const handleConfirmPurge = useCallback(async () => {
    setIsPurging(true);
    try {
      const res = await fetch("/api/purge-previous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ infoHash, confirm: true }),
      });
      const data = res.ok ? await res.json() : null;
      if (data?.reclaimedBytes > 0) setReclaimedNotice(data.reclaimedFormatted);
    } catch {
      // Nothing was freed; the storage panel can still do it later.
    } finally {
      setIsPurging(false);
      setPurgeCandidates([]);
    }
  }, [infoHash]);

  // Closing the player is the natural "I'm done with this episode" moment, so
  // offer to reclaim its bytes right there. Nothing is deleted unless asked.
  const handleClose = useCallback(() => {
    setShowClearPrompt(true);
    if (!filePath) return;
    fetch(
      `/api/torrent/${infoHash}/file/${fileIndexNum}/cache?path=${encodeURIComponent(filePath)}`
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.cachedBytes > 0) setCachedFormatted(data.cachedFormatted);
      })
      .catch(() => {});
  }, [filePath, infoHash, fileIndexNum]);

  const handleKeep = useCallback(() => {
    router.push(returnTo);
  }, [router, returnTo]);

  const handleClearAndClose = useCallback(async () => {
    setIsClearing(true);
    try {
      const query = filePath ? `?path=${encodeURIComponent(filePath)}` : "";
      await fetch(`/api/torrent/${infoHash}/file/${fileIndexNum}/cache${query}`, {
        method: "DELETE",
      });
    } catch {
      // Fall through — the storage panel can still reclaim it later
    } finally {
      setIsClearing(false);
      router.push(returnTo);
    }
  }, [fileIndexNum, filePath, infoHash, router, returnTo]);

  // Show connecting screen until we have peers, a stream URL, the probe has
  // completed, and we know whether there's a position to resume from
  if (!peersReady || !streamUrl || !probeComplete || !progressLoaded) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-5 max-w-sm w-full px-8">
          <Loader2 className="h-8 w-8 text-white animate-spin" />
          <div className="text-center">
            <h2 className="text-base font-medium text-white mb-1">{title}</h2>
            <p className="text-sm text-zinc-500">
              {peers === 0 ? "Finding peers..." : `Connected to ${peers} peer${peers !== 1 ? "s" : ""}`}
            </p>
            {dlSpeed > 0 && (
              <p className="text-xs text-zinc-600 mt-1">{formatSpeed(dlSpeed)}</p>
            )}
          </div>
          <div className="flex gap-3">
            {streamUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(`vlc://${streamUrl}`, "_blank")}
                className="text-zinc-500"
              >
                Open in VLC
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleKeep} className="text-zinc-500">
              Go back
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black z-50">
      <VideoPlayer
        src={streamUrl!}
        title={title}
        onClose={handleClose}
        autoPlay
        subtitles={subtitles}
        fallbackDuration={probedDuration ?? undefined}
        resumeFrom={resumeFrom}
        onProgress={handleProgress}
      />

      {/* Something else is still using disk. Ask before reclaiming it. */}
      {purgeCandidates.length > 0 && !showClearPrompt && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[55] w-[calc(100%-2rem)] max-w-sm">
          <div className="bg-zinc-900/95 backdrop-blur border border-zinc-700 rounded-xl p-4 shadow-2xl">
            <div className="flex items-start gap-2.5 mb-3">
              <HardDrive className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-zinc-100 font-medium">
                  {purgeCandidates.length === 1
                    ? `"${purgeCandidates[0].name}" is still using ${purgeCandidates[0].formatted}`
                    : `${purgeCandidates.length} others are using ${purgeCandidates
                        .reduce((sum, c) => sum + c.bytes, 0) > 0
                        ? purgeCandidates.map((c) => c.formatted).join(" + ")
                        : ""}`}
                </p>
                <p className="text-[11px] text-zinc-500 mt-1">
                  Clearing keeps them in your library — they re-download on play.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleConfirmPurge}
                disabled={isPurging}
                className="h-10 flex-1 text-sm"
              >
                {isPurging && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Purge
              </Button>
              <Button
                variant="outline"
                onClick={() => setPurgeCandidates([])}
                disabled={isPurging}
                className="h-10 flex-1 border-zinc-700 text-sm"
              >
                Keep
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Same-folder episodes are reclaimed silently; just say what was freed. */}
      {reclaimedNotice && purgeCandidates.length === 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[55] px-3.5 py-2 rounded-lg bg-zinc-900/95 backdrop-blur border border-zinc-700 shadow-xl flex items-center gap-2">
          <HardDrive className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-xs text-zinc-300">
            Reclaimed {reclaimedNotice} from the previous one
          </span>
        </div>
      )}

      {showClearPrompt && (
        <div className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center px-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 sm:p-6 max-w-sm w-full shadow-2xl">
            <h2 className="text-base font-semibold text-white mb-1">
              {isFinished ? "Finished — nice one." : "Done with this one?"}
            </h2>
            <p className="text-sm text-zinc-500 mb-5">
              {isFinished
                ? cachedFormatted
                  ? `This is holding ${cachedFormatted}. Clearing frees it — it stays in your library and re-downloads if you play it again.`
                  : "Clearing frees the disk space it's using. It stays in your library and re-downloads if you play it again."
                : cachedFormatted
                  ? `You can pick up where you left off later. Clearing frees the ${cachedFormatted} it's holding, and re-downloads on next play.`
                  : "You can pick up where you left off later. Clearing frees the disk space it's using now."}
            </p>
            <div className="flex flex-col gap-2">
              <Button onClick={handleClearAndClose} disabled={isClearing} className="h-11">
                {isClearing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                {cachedFormatted ? `Clear ${cachedFormatted} & exit` : "Clear this episode & exit"}
              </Button>
              <Button
                variant="outline"
                onClick={handleKeep}
                disabled={isClearing}
                className="border-zinc-700 h-11"
              >
                Keep it &amp; exit
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowClearPrompt(false)}
                disabled={isClearing}
                className="text-zinc-500 h-11"
              >
                Back to video
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
