"use client";

import { useEffect, useRef, useCallback, useState, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { VideoPlayer } from "@/components/video-player";

interface WatchPageProps {
  params: Promise<{ infoHash: string }>;
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

  // Get or create session
  useEffect(() => {
    const startSession = async () => {
      if (hasStartedRef.current) return;
      hasStartedRef.current = true;

      // Check if torrent exists (session already started from home page)
      try {
        const res = await fetch(`/api/torrents`);
        const data = await res.json();
        const torrent = data.torrents?.find(
          (t: { infoHash: string }) => t.infoHash.toLowerCase() === infoHash.toLowerCase()
        );

        if (torrent) {
          // Torrent exists, just track session for cleanup
          const sessionRes = await fetch("/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              magnet: `magnet:?xt=urn:btih:${infoHash}`,
            }),
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
  }, [infoHash]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionIdRef.current) {
        // Fire and forget cleanup
        fetch("/api/session", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            infoHash,
            sessionId: sessionIdRef.current,
          }),
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
          JSON.stringify({
            method: "DELETE",
            infoHash,
            sessionId: sessionIdRef.current,
          })
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [infoHash]);

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
                  ? {
                      label: s.name,
                      src: `/api/subtitle/${infoHash}?embedded=${s.streamIndex}`,
                    }
                  : {
                      label: s.name.replace(/\.[^.]+$/, ""),
                      src: `/api/subtitle/${infoHash}?file=${s.index}`,
                    }
            )
          );
        }
      } catch (err) {
        console.error("Failed to fetch subtitles:", err);
      }
    };

    // Small delay to let torrent connect and discover files
    const timer = setTimeout(fetchSubtitles, 2000);
    return () => clearTimeout(timer);
  }, [infoHash]);

  const handleClose = useCallback(() => {
    // Go back to home - localStorage will handle reopening the episode picker
    router.push("/");
  }, [router]);

  // Build stream URL with optional file index
  const streamUrl = fileIndex
    ? `/api/stream/${infoHash}?file=${fileIndex}`
    : `/api/stream/${infoHash}`;

  return (
    <div className="fixed inset-0 bg-black z-50">
      {/* Video Player */}
      <VideoPlayer
        src={streamUrl}
        title={title}
        onClose={handleClose}
        autoPlay
        subtitles={subtitles}
      />
    </div>
  );
}
