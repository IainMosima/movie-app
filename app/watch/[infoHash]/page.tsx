"use client";

import { useEffect, useRef, useCallback, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { VideoPlayer } from "@/components/video-player";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WatchPageProps {
  params: Promise<{ infoHash: string }>;
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
  const sessionIdRef = useRef<string | null>(null);
  const hasStartedRef = useRef(false);
  const [subtitles, setSubtitles] = useState<{ label: string; src: string }[]>([]);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [probedDuration, setProbedDuration] = useState<number | null>(null);
  const [probeComplete, setProbeComplete] = useState(false);
  const [peersReady, setPeersReady] = useState(false);
  const [peers, setPeers] = useState(0);
  const [dlSpeed, setDlSpeed] = useState(0);

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

  // Poll until we have at least 1 peer, then start streaming
  useEffect(() => {
    if (peersReady) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/torrents`);
        const data = await res.json();
        const torrent = data.torrents?.find(
          (t: { infoHash: string }) => t.infoHash.toLowerCase() === infoHash.toLowerCase()
        );
        if (!torrent) return;
        setPeers(torrent.numPeers);
        setDlSpeed(torrent.downloadSpeed);
        if (torrent.numPeers >= 1) setPeersReady(true);
      } catch {}
    };

    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, [peersReady, infoHash]);

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

  const handleClose = useCallback(() => {
    router.push("/");
  }, [router]);

  // Show connecting screen until we have peers, a stream URL, and probe has completed
  if (!peersReady || !streamUrl || !probeComplete) {
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
            <Button variant="ghost" size="sm" onClick={handleClose} className="text-zinc-500">
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
      />
    </div>
  );
}
