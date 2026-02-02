"use client";

import { useEffect, useRef, useCallback, use } from "react";
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

  const handleClose = useCallback(() => {
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
      />
    </div>
  );
}
