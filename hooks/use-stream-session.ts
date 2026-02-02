"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { SessionStartResponse, TorrentInfo } from "@/types";

interface UseStreamSessionOptions {
  onError?: (error: string) => void;
}

export function useStreamSession(options: UseStreamSessionOptions = {}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{
    infoHash: string;
    sessionId: string;
    torrent: TorrentInfo;
  } | null>(null);

  const sessionRef = useRef<{ infoHash: string; sessionId: string } | null>(null);

  const startSession = useCallback(
    async (magnet: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ magnet }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to start session");
        }

        const data: SessionStartResponse = await res.json();

        setSession({
          infoHash: data.infoHash,
          sessionId: data.sessionId,
          torrent: data.torrent,
        });

        sessionRef.current = {
          infoHash: data.infoHash,
          sessionId: data.sessionId,
        };

        return data;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start session";
        setError(message);
        options.onError?.(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [options]
  );

  const endSession = useCallback(async () => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;

    try {
      await fetch("/api/session", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          infoHash: currentSession.infoHash,
          sessionId: currentSession.sessionId,
        }),
      });
    } catch (err) {
      console.error("Failed to end session:", err);
    } finally {
      setSession(null);
      sessionRef.current = null;
    }
  }, []);

  // Cleanup on unmount or page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const currentSession = sessionRef.current;
      if (currentSession) {
        // Use sendBeacon for reliable delivery on page unload
        navigator.sendBeacon(
          "/api/session",
          JSON.stringify({
            method: "DELETE",
            infoHash: currentSession.infoHash,
            sessionId: currentSession.sessionId,
          })
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // End session on component unmount
      if (sessionRef.current) {
        endSession();
      }
    };
  }, [endSession]);

  return {
    session,
    isLoading,
    error,
    startSession,
    endSession,
    streamUrl: session ? `/api/stream/${session.infoHash}` : null,
  };
}
