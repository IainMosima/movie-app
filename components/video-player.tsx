"use client";

/* eslint-disable react-hooks/refs */
import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  Loader2,
  Subtitles,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatDuration } from "@/lib/utils";

interface VideoPlayerProps {
  src: string;
  fallbackSrc?: string;
  title?: string;
  onClose?: () => void;
  autoPlay?: boolean;
  subtitles?: { label: string; src: string }[];
  strictPrebuffering?: boolean;
  strictBufferSizeMB?: number;
  /** Fallback duration in seconds when video.duration is Infinity/NaN (MKV streams) */
  fallbackDuration?: number;
  /** Seconds to pick up from. Seeds the same resume path used by stream recovery. */
  resumeFrom?: number;
  /** Throttled playback position reporter (~every 10s) for watch progress. */
  onProgress?: (positionSec: number, durationSec: number) => void;
}

const PROGRESS_REPORT_INTERVAL_MS = 10_000;
const RESUME_NOTICE_MS = 8_000;

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const STALL_RECOVERY_MS = 45_000;

export function VideoPlayer({
  src,
  fallbackSrc,
  title,
  onClose,
  autoPlay = true,
  subtitles = [],
  strictPrebuffering = false,
  strictBufferSizeMB,
  fallbackDuration,
  resumeFrom,
  onProgress,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const stalledTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [buffered, setBuffered] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPiP, setIsPiP] = useState(false);
  const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number | null>(null);
  const [activeCueText, setActiveCueText] = useState<string | null>(null);
  const parsedCuesRef = useRef<Map<number, { start: number; end: number; text: string }[]>>(new Map());
  const [skipIndicator, setSkipIndicator] = useState<{ side: "left" | "right"; show: boolean; seconds: number }>({ side: "left", show: false, seconds: 10 });
  const lastTapRef = useRef<{ time: number; side: "left" | "right" | null }>({ time: 0, side: null });
  const [lastActionTime, setLastActionTime] = useState(0);
  const [prefersAlwaysOnControls, setPrefersAlwaysOnControls] = useState(false);
  const isTvPlaybackRef = useRef(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [mutedByAutoplay, setMutedByAutoplay] = useState(false);
  const [playbackSrc, setPlaybackSrc] = useState(src);
  const [isUsingFallbackStream, setIsUsingFallbackStream] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [srcRevision, setSrcRevision] = useState(0);
  const pendingResumeTimeRef = useRef<number | null>(null);
  const resumeAppliedRef = useRef(false);
  const [resumedFromSec, setResumedFromSec] = useState<number | null>(null);
  const lastProgressReportRef = useRef(0);
  // Held in a ref so a new callback identity from the parent doesn't tear down
  // and re-attach every media listener on each render.
  const onProgressRef = useRef(onProgress);
  const recoveryAttemptsRef = useRef(0);
  const lastRecoveryAtRef = useRef(0);
  const [isInitialStrictBuffering, setIsInitialStrictBuffering] = useState<boolean>(
    strictPrebuffering
  );

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    setPlaybackSrc(src);
    setIsUsingFallbackStream(false);
    setSrcRevision(0);
    pendingResumeTimeRef.current = null;
    resumeAppliedRef.current = false;
    setResumedFromSec(null);
    setBuffered(0);
  }, [src]);

  // Seed the resume seek once per source; the loadedmetadata/canplay/loadeddata
  // listeners further down perform the actual seek. Guarded so a late-arriving
  // resumeFrom can never yank playback backwards mid-watch.
  useEffect(() => {
    if (!resumeFrom || resumeFrom <= 0 || resumeAppliedRef.current) return;
    resumeAppliedRef.current = true;
    pendingResumeTimeRef.current = resumeFrom;
    setResumedFromSec(resumeFrom);
  }, [resumeFrom, playbackSrc]);

  // The "resumed from…" chip is a brief offer, not a permanent overlay.
  useEffect(() => {
    if (resumedFromSec === null) return;
    const timer = setTimeout(() => setResumedFromSec(null), RESUME_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [resumedFromSec]);

  useEffect(() => {
    setIsInitialStrictBuffering(strictPrebuffering);
  }, [strictPrebuffering, playbackSrc]);

  // Apply fallback duration immediately when it's provided (before durationchange fires)
  useEffect(() => {
    if (fallbackDuration && fallbackDuration > 0) setDuration(fallbackDuration);
  }, [fallbackDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.load();
    setStreamError(null);
    setIsBuffering(true);
    setBuffered(0);
    setCurrentTime(0);
    if (autoPlay) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Autoplay with sound blocked by browser — retry muted
          video.muted = true;
          setIsMuted(true);
          setMutedByAutoplay(true);
          video.play().catch(() => {});
        });
      }
    }
  }, [playbackSrc, autoPlay]);

  useEffect(() => {
    if (!fallbackNotice) return;
    const timer = setTimeout(() => setFallbackNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [fallbackNotice]);

  const resolvedSrc = useMemo(() => {
    if (!playbackSrc) return "";
    if (srcRevision === 0) return playbackSrc;
    const separator = playbackSrc.includes("?") ? "&" : "?";
    return `${playbackSrc}${separator}v=${srcRevision}`;
  }, [playbackSrc, srcRevision]);

  const trySwitchToFallback = useCallback(
    (noticeMessage?: string) => {
      if (
        !fallbackSrc ||
        (isUsingFallbackStream && playbackSrc === fallbackSrc)
      ) {
        return false;
      }
      setIsUsingFallbackStream(true);
      setPlaybackSrc(fallbackSrc);
      setFallbackNotice(
        noticeMessage || "Direct stream unreachable. Using fallback route."
      );
      pendingResumeTimeRef.current = null;
      return true;
    },
    [fallbackSrc, isUsingFallbackStream, playbackSrc]
  );

  const fallbackDurationRef = useRef(fallbackDuration);
  useEffect(() => { fallbackDurationRef.current = fallbackDuration; }, [fallbackDuration]);

  const recoverStream = useCallback(
    (message: string) => {
      const video = videoRef.current;
      if (!video) return false;

      // Throttle: don't trigger multiple recoveries within 3 seconds
      const now = Date.now();
      if (now - lastRecoveryAtRef.current < 3000) return false;
      lastRecoveryAtRef.current = now;

      recoveryAttemptsRef.current += 1;
      setIsBuffering(true);
      setStreamError(null);

      const resumeTime = video.currentTime || 0;
      pendingResumeTimeRef.current = resumeTime;

      if (trySwitchToFallback(message)) {
        return true;
      }

      setFallbackNotice(message);
      setSrcRevision((rev) => rev + 1);
      return true;
    },
    [trySwitchToFallback]
  );

  // Show controls on mouse move
  const handleMouseMove = useCallback(() => {
    if (prefersAlwaysOnControls) return;
    setShowControls(true);

    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }

    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  }, [isPlaying, prefersAlwaysOnControls]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check for actual TV by user agent only (not screen size)
    const isActualTV = () => {
      const ua = navigator.userAgent.toLowerCase();
      return (
        ua.includes("tv") ||
        ua.includes("vidaa") ||
        ua.includes("hisense") ||
        ua.includes("tizen") ||
        ua.includes("webos") ||
        ua.includes("smart-tv") ||
        ua.includes("smarttv") ||
        ua.includes("netcast") ||
        ua.includes("viera") ||
        ua.includes("nettv") ||
        ua.includes("appletv") ||
        ua.includes("roku") ||
        ua.includes("firetv") ||
        ua.includes("googletv")
      );
    };

    const update = () => {
      const tv = isActualTV();
      isTvPlaybackRef.current = tv;
      setPrefersAlwaysOnControls(tv);
    };
    update();

    // No need for media query listener since we only check user agent
  }, []);

  useEffect(() => {
    if (prefersAlwaysOnControls) {
      setShowControls(true);
    }
  }, [prefersAlwaysOnControls]);

  // Auto-focus container on mount for TV remote to work immediately
  useEffect(() => {
    if (!containerRef.current) return;
    // Always focus on mount, especially important for TV
    containerRef.current.focus();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    if (prefersAlwaysOnControls) {
      containerRef.current.focus();
    }
  }, [prefersAlwaysOnControls]);

  // Video event handlers
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const effectiveDuration = () =>
      fallbackDuration ||
      (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);

    const reportProgress = (force = false) => {
      const report = onProgressRef.current;
      const t = video.currentTime;
      if (!report || !Number.isFinite(t) || t <= 0) return;
      const now = Date.now();
      if (!force && now - lastProgressReportRef.current < PROGRESS_REPORT_INTERVAL_MS) {
        return;
      }
      lastProgressReportRef.current = now;
      report(t, effectiveDuration());
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => {
      setIsPlaying(false);
      // Pausing is a likely prelude to walking away — save the exact spot rather
      // than whatever the 10s tick last captured.
      reportProgress(true);
    };
    const handleTimeUpdate = () => {
      const t = video.currentTime;
      setCurrentTime(Number.isFinite(t) ? t : 0);
      reportProgress();
    };
    const handleDurationChange = () => {
      // fallbackDuration is authoritative when set — video.duration for fragmented MP4
      // reports only the currently-muxed window, not the full movie length.
      if (fallbackDuration && fallbackDuration > 0) {
        setDuration(fallbackDuration);
        return;
      }
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const handleWaiting = () => setIsBuffering(true);
    const handlePlaying = () => {
      setIsBuffering(false);
      recoveryAttemptsRef.current = 0;
      setIsInitialStrictBuffering(false);
    };
    const handleCanPlay = () => setIsBuffering(false);
    const handleProgress = () => {
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1);
        setBuffered(bufferedEnd);
      }
    };
    const handleVolumeChange = () => {
      setVolume(video.volume);
      setIsMuted(video.muted);
    };
    const handleError = () => {
      if (!video.error) return;
      if (recoveryAttemptsRef.current < 3) {
        recoverStream("Connection lost. Retrying stream...");
        return;
      }
      if (video.error.code === 2 || video.error.code === 4) {
        setStreamError("Stream unavailable. No peers found for this torrent.");
      } else {
        setStreamError("Playback error occurred.");
      }
      setIsBuffering(false);
    };
    const handleStalled = () => {
      setIsBuffering(true);

      if (isTvPlaybackRef.current) {
        setFallbackNotice("Buffering — waiting for more torrent pieces...");
        return;
      }

      if (stalledTimeoutRef.current) clearTimeout(stalledTimeoutRef.current);
      stalledTimeoutRef.current = setTimeout(() => {
        if (recoveryAttemptsRef.current < 3) {
          recoverStream("Stream stalled. Attempting to resume...");
        } else {
          setStreamError("Stream stalled. No data is being received.");
          setIsBuffering(false);
        }
      }, STALL_RECOVERY_MS);
    };
    const handleStalledRecovery = () => {
      if (stalledTimeoutRef.current) {
        clearTimeout(stalledTimeoutRef.current);
        stalledTimeoutRef.current = null;
      }
      if (streamError) setStreamError(null);
      if (!video.paused && video.currentTime > 0) {
        setIsInitialStrictBuffering(false);
      }
    };
    const handleUnexpectedEnd = () => {
      const total = effectiveDuration();
      const now = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      // Within 2s of real end — let it finish naturally, and bank the position
      // so it registers as watched.
      if (total && total - now <= 2) {
        reportProgress(true);
        return;
      }
      if (isTvPlaybackRef.current && isInitialStrictBuffering) return;
      if (recoveryAttemptsRef.current < 3) {
        recoverStream("Stream paused. Resuming...");
      }
    };

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("progress", handleProgress);
    video.addEventListener("volumechange", handleVolumeChange);
    video.addEventListener("error", handleError);
    video.addEventListener("stalled", handleStalled);
    video.addEventListener("progress", handleStalledRecovery);
    video.addEventListener("ended", handleUnexpectedEnd);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("durationchange", handleDurationChange);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("progress", handleProgress);
      video.removeEventListener("volumechange", handleVolumeChange);
      video.removeEventListener("error", handleError);
      video.removeEventListener("stalled", handleStalled);
      video.removeEventListener("progress", handleStalledRecovery);
      video.removeEventListener("ended", handleUnexpectedEnd);
      if (stalledTimeoutRef.current) clearTimeout(stalledTimeoutRef.current);
    };
  }, [recoverStream, streamError, isInitialStrictBuffering, fallbackDuration]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleResumeSeek = () => {
      if (pendingResumeTimeRef.current === null) return;
      const resumeTime = pendingResumeTimeRef.current;
      pendingResumeTimeRef.current = null;
      const maxDuration = video.duration;
      const target =
        maxDuration && Number.isFinite(maxDuration)
          ? Math.min(resumeTime, Math.max(maxDuration - 0.75, 0))
          : resumeTime;
      try {
        if (!Number.isNaN(target)) {
          video.currentTime = target;
        }
        if (video.paused && autoPlay) {
          video.play().catch(() => {});
        }
      } catch (err) {
        console.error("Failed to resume playback:", err);
      }
    };

    video.addEventListener("loadedmetadata", handleResumeSeek);
    video.addEventListener("canplay", handleResumeSeek);
    video.addEventListener("loadeddata", handleResumeSeek);

    return () => {
      video.removeEventListener("loadedmetadata", handleResumeSeek);
      video.removeEventListener("canplay", handleResumeSeek);
      video.removeEventListener("loadeddata", handleResumeSeek);
    };
  }, [autoPlay]);

  // Fullscreen change handler (with vendor prefixes for VIDAA/WebKit)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const doc = document as Document & {
        webkitFullscreenElement?: Element;
        mozFullScreenElement?: Element;
        msFullscreenElement?: Element;
      };
      const isFs = !!(
        doc.fullscreenElement ||
        doc.webkitFullscreenElement ||
        doc.mozFullScreenElement ||
        doc.msFullscreenElement
      );
      setIsFullscreen(isFs);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    };
  }, []);

  // Parse VTT content into cue objects
  const parseVTT = useCallback((vttText: string): { start: number; end: number; text: string }[] => {
    const cues: { start: number; end: number; text: string }[] = [];
    const blocks = vttText.replace(/\r\n/g, "\n").split("\n\n");

    const parseTime = (ts: string): number => {
      const parts = ts.trim().split(":");
      if (parts.length === 3) {
        const [h, m, rest] = parts;
        const [s, ms] = rest.split(".");
        return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms || "0") / 1000;
      } else if (parts.length === 2) {
        const [m, rest] = parts;
        const [s, ms] = rest.split(".");
        return parseInt(m) * 60 + parseInt(s) + parseInt(ms || "0") / 1000;
      }
      return 0;
    };

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/(\d{1,2}:[\d:.]+)\s*-->\s*(\d{1,2}:[\d:.]+)/);
        if (match) {
          const start = parseTime(match[1]);
          const end = parseTime(match[2]);
          const text = lines.slice(i + 1).join("\n").replace(/<[^>]+>/g, "").trim();
          if (text) cues.push({ start, end, text });
          break;
        }
      }
    }
    return cues;
  }, []);

  // Fetch and parse subtitle files when subtitles prop changes
  useEffect(() => {
    if (subtitles.length === 0) return;
    parsedCuesRef.current.clear();

    subtitles.forEach((sub, i) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      fetch(sub.src, { signal: controller.signal })
        .then((res) => res.text())
        .then((text) => {
          clearTimeout(timeout);
          parsedCuesRef.current.set(i, parseVTT(text));
        })
        .catch(() => {
          clearTimeout(timeout);
        });
    });
  }, [subtitles, parseVTT]);

  // Update active cue text based on video time
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateCue = () => {
      if (activeSubtitleIndex === null) {
        setActiveCueText(null);
        return;
      }
      const cues = parsedCuesRef.current.get(activeSubtitleIndex);
      if (!cues) { setActiveCueText(null); return; }
      const t = video.currentTime;
      const active = cues.find((c) => t >= c.start && t <= c.end);
      setActiveCueText(active ? active.text : null);
    };

    video.addEventListener("timeupdate", updateCue);
    return () => video.removeEventListener("timeupdate", updateCue);
  }, [activeSubtitleIndex]);

  const setActiveSubtitle = useCallback((index: number | null) => {
    setActiveSubtitleIndex(index);
    if (index === null) setActiveCueText(null);
  }, []);

  const cycleSubtitles = useCallback(() => {
    setActiveSubtitleIndex((prev) => {
      const next = prev === null ? 0 : prev + 1 >= subtitles.length ? null : prev + 1;
      if (next === null) setActiveCueText(null);
      return next;
    });
  }, [subtitles.length]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMutedByAutoplay(false);
  }

  async function toggleFullscreen() {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return;

    const doc = document as Document & {
      webkitFullscreenElement?: Element;
      mozFullScreenElement?: Element;
      msFullscreenElement?: Element;
      webkitExitFullscreen?: () => Promise<void>;
      mozCancelFullScreen?: () => Promise<void>;
      msExitFullscreen?: () => Promise<void>;
    };

    const isCurrentlyFullscreen = !!(
      doc.fullscreenElement ||
      doc.webkitFullscreenElement ||
      doc.mozFullScreenElement ||
      doc.msFullscreenElement
    );

    try {
      if (isCurrentlyFullscreen) {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          await doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
        setIsFullscreen(false);
      } else {
        const elem = container as HTMLElement & {
          webkitRequestFullscreen?: () => Promise<void>;
          mozRequestFullScreen?: () => Promise<void>;
          msRequestFullscreen?: () => Promise<void>;
        };
        const videoElem = video as HTMLVideoElement & {
          webkitRequestFullscreen?: () => Promise<void>;
          webkitEnterFullscreen?: () => Promise<void>;
          mozRequestFullScreen?: () => Promise<void>;
          msRequestFullscreen?: () => Promise<void>;
        };

        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
          await elem.webkitRequestFullscreen();
        } else if (elem.mozRequestFullScreen) {
          await elem.mozRequestFullScreen();
        } else if (elem.msRequestFullscreen) {
          await elem.msRequestFullscreen();
        } else if (videoElem?.webkitEnterFullscreen) {
          await videoElem.webkitEnterFullscreen();
        } else if (videoElem?.webkitRequestFullscreen) {
          await videoElem.webkitRequestFullscreen();
        } else {
          console.warn("Fullscreen not supported on this device");
          return;
        }
        setIsFullscreen(true);
      }
    } catch (err) {
      console.error("Fullscreen error:", err);
    }
  }

  async function togglePiP() {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch (err) {
      console.error("PiP error:", err);
    }
  }

  function skip(seconds: number) {
    const video = videoRef.current;
    if (!video) return;

    setSkipIndicator({
      side: seconds < 0 ? "left" : "right",
      show: true,
      seconds: Math.abs(seconds)
    });
    setTimeout(() => setSkipIndicator((prev) => ({ ...prev, show: false })), 800);

    try {
      const effectiveDuration = Number.isFinite(video.duration) ? video.duration : (duration || Infinity);
      const newTime = Math.max(0, Math.min(video.currentTime + seconds, effectiveDuration - 1));
      video.currentTime = newTime;
      if ("fastSeek" in video && typeof video.fastSeek === "function") {
        (video as HTMLVideoElement & { fastSeek: (time: number) => void }).fastSeek(newTime);
      }
    } catch (err) {
      console.error("Seek error:", err);
    }
  }

  function adjustVolume(delta: number) {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(video.volume + delta, 1));
    if (video.muted && delta > 0) {
      video.muted = false;
    }
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if typing in input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const key = e.key?.toLowerCase() || "";
    const keyCode = e.keyCode || e.which || 0;

    // Smart TV Remote KeyCodes (HbbTV/VIDAA/Tizen/webOS standard)
    // Back: 461, Play: 415, Pause: 411/19, Stop: 413
    // Rewind: 412, FastForward: 417, PlayPause: 503/10252
    // Navigation: 37(Left), 38(Up), 39(Right), 40(Down), 13(OK/Enter)

    // Handle by keyCode first (more reliable on Smart TVs)
    switch (keyCode) {
      // Navigation
      case 37: // Left arrow
        e.preventDefault();
        skip(-10);
        return;
      case 39: // Right arrow
        e.preventDefault();
        skip(10);
        return;
      case 38: // Up arrow
        e.preventDefault();
        adjustVolume(0.1);
        return;
      case 40: // Down arrow
        e.preventDefault();
        adjustVolume(-0.1);
        return;
      case 13: // OK/Enter
        e.preventDefault();
        togglePlay();
        return;
      case 32: // Space
        e.preventDefault();
        togglePlay();
        return;

      // TV Remote specific keys
      case 461: // Back (HbbTV/VIDAA standard)
      case 10009: // Back (Tizen)
      case 8: // Backspace
      case 27: // Escape
        e.preventDefault();
        if (isFullscreen) {
          toggleFullscreen();
        } else if (onClose) {
          onClose();
        }
        return;

      // Media controls
      case 415: // Play
        e.preventDefault();
        if (video.paused) video.play();
        return;
      case 19: // Pause (some TVs)
      case 411: // Pause (HbbTV)
        e.preventDefault();
        if (!video.paused) video.pause();
        return;
      case 413: // Stop
        e.preventDefault();
        video.pause();
        video.currentTime = 0;
        return;
      case 412: // Rewind
        e.preventDefault();
        skip(-10);
        return;
      case 417: // Fast Forward
        e.preventDefault();
        skip(10);
        return;
      case 503: // Play/Pause (HbbTV)
      case 10252: // Play/Pause (Tizen)
        e.preventDefault();
        togglePlay();
        return;

      // Color buttons (can be used for extra features)
      case 403: // Red - skip back 30s
        e.preventDefault();
        skip(-30);
        return;
      case 404: // Green - skip forward 30s
        e.preventDefault();
        skip(30);
        return;
      case 405: // Yellow - toggle mute
        e.preventDefault();
        toggleMute();
        return;
      case 406: // Blue - toggle fullscreen
        e.preventDefault();
        toggleFullscreen();
        return;
    }

    // Fallback to key names for desktop browsers
    switch (key) {
      case " ":
      case "k":
        e.preventDefault();
        togglePlay();
        break;
      case "f":
        e.preventDefault();
        toggleFullscreen();
        break;
      case "m":
        e.preventDefault();
        toggleMute();
        break;
      case "j":
        e.preventDefault();
        skip(-10);
        break;
      case "l":
        e.preventDefault();
        skip(10);
        break;
      case "c":
        e.preventDefault();
        cycleSubtitles();
        break;
      case "p":
        e.preventDefault();
        togglePiP();
        break;
      case "mediaplaypause":
        e.preventDefault();
        togglePlay();
        break;
      case "mediarewind":
      case "mediatrackprevious":
        e.preventDefault();
        skip(-10);
        break;
      case "mediafastforward":
      case "mediatracknext":
        e.preventDefault();
        skip(10);
        break;
    }
  }, [isFullscreen, onClose, cycleSubtitles]);

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video) return;

    const effectiveDuration = Number.isFinite(video.duration) ? video.duration : (duration || 0);
    const newTime = Math.max(0, Math.min(time, effectiveDuration - 1));

    try {
      video.currentTime = newTime;
      if ('fastSeek' in video && typeof video.fastSeek === 'function') {
        (video as HTMLVideoElement & { fastSeek: (time: number) => void }).fastSeek(newTime);
      }
    } catch (err) {
      console.error('Seek error:', err);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekTo(ratio * duration);
  };

  const handleSkipBackward = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    skip(-10);
  };

  const handleSkipForward = (e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    skip(10);
  };

  // TV remote helper - triggers action on Enter/Space/OK button
  const handleTVKeyDown = (action: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Select" || e.key === "Ok") {
      e.preventDefault();
      e.stopPropagation();
      action();
    }
  };

  const runGuardedAction = useCallback((action: () => void) => {
    const now = Date.now();
    if (now - lastActionTime < 300) return;
    setLastActionTime(now);
    action();
  }, [lastActionTime]);

  // TV pointer helper - handles all possible click events from TV remotes
  // Uses a time guard to prevent double-firing (e.g. D-pad OK fires both keydown + synthesized click)
  const handleTVClick = (action: () => void) => {
    return {
      onClick: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); runGuardedAction(action); },
      onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); },
      onMouseUp: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); runGuardedAction(action); },
      onTouchEnd: (e: React.TouchEvent) => { e.preventDefault(); e.stopPropagation(); runGuardedAction(action); },
      onKeyDown: handleTVKeyDown(() => runGuardedAction(action)),
    };
  };

  // Keyboard shortcuts
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // PiP change handler
  useEffect(() => {
    const handlePiPChange = () => {
      setIsPiP(document.pictureInPictureElement === videoRef.current);
    };

    videoRef.current?.addEventListener("enterpictureinpicture", handlePiPChange);
    videoRef.current?.addEventListener("leavepictureinpicture", handlePiPChange);

    return () => {
      videoRef.current?.removeEventListener(
        "enterpictureinpicture",
        handlePiPChange
      );
      videoRef.current?.removeEventListener(
        "leavepictureinpicture",
        handlePiPChange
      );
    };
  }, []);

  // Double-tap to skip (TV/touch friendly)
  const handleVideoTap = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const side = x < rect.width / 2 ? "left" : "right";
    const now = Date.now();

    // Check for double-tap (within 300ms, same side)
    if (now - lastTapRef.current.time < 300 && lastTapRef.current.side === side) {
      // Double tap detected - skip() will handle the indicator
      if (side === "left") {
        skip(-10);
      } else {
        skip(10);
      }
      lastTapRef.current = { time: 0, side: null };
    } else {
      // Single tap - toggle play or wait for double tap
      lastTapRef.current = { time: now, side };
      setTimeout(() => {
        if (lastTapRef.current.time === now) {
          // No second tap came, treat as single tap (play/pause)
          togglePlay();
        }
      }, 300);
    }
  };

  const handleSeek = (value: number[]) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = value[0];
  };

  const handleVolumeChange = (value: number[]) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value[0];
    if (value[0] > 0 && video.muted) {
      video.muted = false;
    }
  };

  const handlePlaybackRateChange = (rate: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = rate;
    setPlaybackRate(rate);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative w-full h-full bg-black group outline-none",
        prefersAlwaysOnControls && "touch-manipulation tv-show-cursor",
        !showControls && isPlaying && "cursor-none"
      )}
      tabIndex={0}
      role="application"
      aria-label={title ? `${title} player` : "Video player"}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && !prefersAlwaysOnControls && setShowControls(false)}
      onPointerDown={() => {
        setShowControls(true);
        containerRef.current?.focus();
      }}
      onKeyDown={(e) => handleKeyDown(e.nativeEvent)}
    >
      {isUsingFallbackStream && (
        <div className="absolute top-5 right-5 z-20 flex items-center gap-2 rounded-full bg-zinc-900/70 px-4 py-2 text-xs font-medium text-white backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          <span>Fallback stream</span>
        </div>
      )}

      {fallbackNotice && (
        <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 -translate-x-1/2">
          <div className="rounded-full bg-black/70 px-4 py-2 text-sm text-white shadow-lg">
            {fallbackNotice}
          </div>
        </div>
      )}

      {/* Resumed-from notice — fades out on its own, no dismissal required */}
      {resumedFromSec !== null && resumedFromSec > 0 && (
        <div className="absolute top-5 left-1/2 z-20 -translate-x-1/2 flex items-center gap-3 rounded-full bg-black/80 pl-5 pr-2 py-2 text-sm text-white backdrop-blur shadow-lg max-w-[calc(100%-2rem)]">
          <span className="truncate">Resumed from {formatDuration(resumedFromSec)}</span>
          <button
            onClick={() => {
              const video = videoRef.current;
              if (video) video.currentTime = 0;
              setResumedFromSec(null);
            }}
            className="shrink-0 rounded-full bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-medium transition-colors"
          >
            Start from beginning
          </button>
        </div>
      )}

      {/* Muted-by-autoplay notice */}
      {mutedByAutoplay && isMuted && (
        <button
          className="absolute top-5 left-1/2 z-20 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/80 px-5 py-2.5 text-sm font-medium text-white backdrop-blur hover:bg-black/90 transition-colors"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            video.muted = false;
            setIsMuted(false);
            setMutedByAutoplay(false);
          }}
        >
          <VolumeX className="h-4 w-4 text-amber-400" />
          <span>Muted — click to unmute</span>
        </button>
      )}

      {/* Video */}
      <video
        ref={videoRef}
        src={resolvedSrc}
        className="w-full h-full"
        autoPlay={autoPlay}
        playsInline
        onClick={(e) => {
          // On TV, just toggle play. On desktop, use double-tap logic.
          if (prefersAlwaysOnControls) {
            togglePlay();
          } else {
            handleVideoTap(e);
          }
        }}
        onTouchStart={() => setShowControls(true)}
        onPointerDown={() => {
          setShowControls(true);
          containerRef.current?.focus();
        }}
      />

      {/* JS-rendered subtitles — works on all TV browsers unlike <track> elements */}
      {activeCueText && (
        <div className="absolute bottom-[12%] left-0 right-0 flex justify-center pointer-events-none px-8 z-10">
          <p className="subtitle-overlay text-center whitespace-pre-line max-w-[80%]">
            {activeCueText}
          </p>
        </div>
      )}

      {/* Skip indicator (double-tap feedback) - Netflix style */}
      {skipIndicator.show && (
        <div
          className={cn(
            "absolute top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 pointer-events-none animate-fade-in",
            skipIndicator.side === "left" ? "left-20" : "right-20"
          )}
        >
          <div className="h-20 w-20 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
            {skipIndicator.side === "left" ? (
              <svg className="h-10 w-10 text-white animate-rotate-back" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12.5 8.5L7.5 12l5 3.5V8.5z" fill="currentColor" stroke="none"/>
                <path d="M12 4V2" strokeLinecap="round"/>
                <path d="M12 4C7.58 4 4 7.58 4 12s3.58 8 8 8 8-3.58 8-8" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg className="h-10 w-10 text-white animate-rotate-forward" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M11.5 8.5l5 3.5-5 3.5V8.5z" fill="currentColor" stroke="none"/>
                <path d="M12 4V2" strokeLinecap="round"/>
                <path d="M12 4c4.42 0 8 3.58 8 8s-3.58 8-8 8-8-3.58-8-8" strokeLinecap="round"/>
              </svg>
            )}
          </div>
          <span className="text-white text-lg font-semibold">{skipIndicator.seconds} seconds</span>
        </div>
      )}

      {/* Stream error overlay */}
      {streamError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
          <div className="flex flex-col items-center gap-4 max-w-md text-center px-6">
            <AlertCircle className="h-12 w-12 text-red-500" />
            <p className="text-lg text-white font-medium">{streamError}</p>
            <p className="text-sm text-zinc-400">
              The torrent may have no active peers. Try again later or choose a different source.
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  const resumeTime = videoRef.current?.currentTime || 0;
                  pendingResumeTimeRef.current = resumeTime;
                  recoveryAttemptsRef.current = 0;
                  setStreamError(null);
                  setIsBuffering(true);
                  setSrcRevision((rev) => rev + 1);
                }}
              >
                Retry
              </Button>
              {onClose && (
                <Button variant="default" onClick={onClose}>
                  Go Back
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Buffering overlay */}
      {isBuffering && !streamError && !isInitialStrictBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-12 w-12 text-white animate-spin" />
            <p className="text-sm text-zinc-400">
              Buffering... {Math.round((buffered / duration) * 100) || 0}%
            </p>
          </div>
        </div>
      )}

      {isInitialStrictBuffering && !streamError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-30">
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <Loader2 className="h-12 w-12 text-white animate-spin" />
            <p className="text-base text-white font-medium">Preparing stream…</p>
            <p className="text-sm text-zinc-300">
              Strict buffering is enabled. We&apos;re caching
              {strictBufferSizeMB ? ` ~${strictBufferSizeMB}MB` : " the full buffer"} before playback
              starts to avoid stalls on your TV.
            </p>
          </div>
        </div>
      )}



      {/* Title bar at top */}
      {title && (
        <div
          className={cn(
            "absolute top-0 inset-x-0 p-6 bg-gradient-to-b from-black/80 via-black/40 to-transparent transition-opacity duration-300",
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <h2 className="text-xl font-semibold text-white truncate">{title}</h2>
        </div>
      )}

      {/* Center controls: Skip Back | Play/Pause | Skip Forward */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-300",
          showControls && !isBuffering ? "opacity-100" : "opacity-0"
        )}
      >
        <div className={cn(
          "flex items-center gap-4",
          prefersAlwaysOnControls && "gap-6"
        )}>
          {/* Skip back 10s */}
          <button
            type="button"
            {...handleTVClick(() => skip(-10))}
            className={cn(
              "pointer-events-auto flex items-center justify-center outline-none cursor-pointer rounded-full transition-all",
              "bg-black/40 hover:bg-black/60 active:bg-black/80",
              "focus:ring-2 focus:ring-white",
              prefersAlwaysOnControls ? "h-16 w-16" : "h-12 w-12"
            )}
          >
            <svg className={cn("text-white", prefersAlwaysOnControls ? "h-8 w-8" : "h-6 w-6")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12.5 8.5L7.5 12l5 3.5V8.5z" fill="currentColor" stroke="none"/>
              <path d="M12 4V2" strokeLinecap="round"/>
              <path d="M12 4C7.58 4 4 7.58 4 12s3.58 8 8 8 8-3.58 8-8" strokeLinecap="round"/>
            </svg>
          </button>

          {/* Play/Pause - larger center button */}
          <button
            type="button"
            {...handleTVClick(togglePlay)}
            className={cn(
              "pointer-events-auto flex items-center justify-center outline-none cursor-pointer rounded-full transition-all",
              "bg-white/20 hover:bg-white/30 active:bg-white/40 backdrop-blur-sm",
              "focus:ring-4 focus:ring-white/50",
              prefersAlwaysOnControls ? "h-24 w-24" : "h-16 w-16"
            )}
          >
            {isPlaying ? (
              <Pause className={cn("text-white", prefersAlwaysOnControls ? "h-12 w-12" : "h-8 w-8")} />
            ) : (
              <Play className={cn("text-white fill-white ml-1", prefersAlwaysOnControls ? "h-12 w-12" : "h-8 w-8")} />
            )}
          </button>

          {/* Skip forward 10s */}
          <button
            type="button"
            {...handleTVClick(() => skip(10))}
            className={cn(
              "pointer-events-auto flex items-center justify-center outline-none cursor-pointer rounded-full transition-all",
              "bg-black/40 hover:bg-black/60 active:bg-black/80",
              "focus:ring-2 focus:ring-white",
              prefersAlwaysOnControls ? "h-16 w-16" : "h-12 w-12"
            )}
          >
            <svg className={cn("text-white", prefersAlwaysOnControls ? "h-8 w-8" : "h-6 w-6")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11.5 8.5l5 3.5-5 3.5V8.5z" fill="currentColor" stroke="none"/>
              <path d="M12 4V2" strokeLinecap="round"/>
              <path d="M12 4c4.42 0 8 3.58 8 8s-3.58 8-8 8-8-3.58-8-8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Bottom controls with progress bar */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/60 to-transparent transition-opacity duration-300",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none",
          prefersAlwaysOnControls ? "pb-8 pt-16" : "pb-4 pt-20"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6">
          {/* Progress bar - clickable area for TV */}
          <div
            className={cn(
              "relative group/progress mb-4 cursor-pointer",
              prefersAlwaysOnControls && "py-4 -my-4"
            )}
            onClick={handleProgressClick}
            onMouseUp={handleProgressClick}
            onTouchEnd={(e) => {
              const touch = e.changedTouches[0];
              if (touch && duration) {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.min(1, Math.max(0, (touch.clientX - rect.left) / rect.width));
                seekTo(ratio * duration);
              }
            }}
          >
            {/* Background track */}
            <div className={cn(
              "absolute bg-white/20 rounded-full w-full transition-all",
              prefersAlwaysOnControls ? "h-2" : "h-1 group-hover/progress:h-1.5"
            )}>
              {/* Buffered progress */}
              <div
                className="h-full bg-white/40 rounded-full"
                style={{ width: `${(buffered / duration) * 100}%` }}
              />
            </div>
            {/* Current progress */}
            <div
              className={cn(
                "absolute bg-purple-500 rounded-full transition-all",
                prefersAlwaysOnControls ? "h-2" : "h-1 group-hover/progress:h-1.5"
              )}
              style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
            />
            {/* Thumb indicator */}
            <div
              className={cn(
                "absolute top-1/2 -translate-y-1/2 bg-white rounded-full shadow-lg transition-all",
                prefersAlwaysOnControls ? "h-5 w-5 -ml-2.5" : "h-4 w-4 -ml-2 opacity-0 group-hover/progress:opacity-100"
              )}
              style={{ left: `${(currentTime / (duration || 1)) * 100}%` }}
            />
            {/* Invisible hit area */}
            <div className={cn(
              "w-full",
              prefersAlwaysOnControls ? "h-8" : "h-4"
            )} />
          </div>

          {/* Controls row - simplified on TV */}
          <div className={cn("flex items-center gap-4", prefersAlwaysOnControls && "justify-center gap-6")}>
            {/* Play/Pause - only show on desktop */}
            {!prefersAlwaysOnControls && (
              <button
                type="button"
                {...handleTVClick(togglePlay)}
                className="flex items-center justify-center text-white rounded-full cursor-pointer h-12 w-12 hover:bg-white/10 active:bg-white/30 focus:bg-white/20 focus:ring-2 focus:ring-white focus:outline-none"
              >
                {isPlaying ? (
                  <Pause className="h-7 w-7" />
                ) : (
                  <Play className="h-7 w-7 fill-current ml-1" />
                )}
              </button>
            )}

            {/* Volume - only show on desktop */}
            {!prefersAlwaysOnControls && (
              <div className="flex items-center gap-2 group/volume">
                <button
                  type="button"
                  {...handleTVClick(toggleMute)}
                  className="flex items-center justify-center text-white rounded-full cursor-pointer h-10 w-10 hover:bg-white/10 active:bg-white/30 focus:bg-white/20 focus:ring-2 focus:ring-white focus:outline-none"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="h-5 w-5" />
                  ) : (
                    <Volume2 className="h-5 w-5" />
                  )}
                </button>
                <div className="w-0 overflow-hidden group-hover/volume:w-20 transition-all duration-200">
                  <Slider
                    value={[isMuted ? 0 : volume]}
                    max={1}
                    step={0.01}
                    onValueChange={handleVolumeChange}
                    className="cursor-pointer"
                  />
                </div>
              </div>
            )}

            {/* Time - always show */}
            <span className={cn(
              "text-white/90 tabular-nums",
              prefersAlwaysOnControls ? "text-xl" : "text-sm"
            )}>
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>

            {/* Subtitle picker - show when subtitles available */}
            {subtitles.length > 0 && prefersAlwaysOnControls && (
              <button
                type="button"
                {...handleTVClick(cycleSubtitles)}
                className={cn(
                  "flex items-center justify-center rounded-full cursor-pointer",
                  "hover:bg-white/10 active:bg-white/30",
                  "focus:bg-white/20 focus:ring-2 focus:ring-white focus:outline-none",
                  "h-14 w-14",
                  activeSubtitleIndex !== null ? "text-purple-400" : "text-white"
                )}
              >
                <Subtitles className="h-7 w-7" />
              </button>
            )}
            {subtitles.length > 0 && !prefersAlwaysOnControls && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "flex items-center justify-center rounded-full cursor-pointer h-10 w-10",
                      "hover:bg-white/10 active:bg-white/30",
                      "focus:bg-white/20 focus:ring-2 focus:ring-white focus:outline-none",
                      activeSubtitleIndex !== null ? "text-purple-400" : "text-white"
                    )}
                  >
                    <Subtitles className="h-5 w-5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-zinc-900/95 border-zinc-800 backdrop-blur-sm">
                  <DropdownMenuItem
                    onClick={() => setActiveSubtitle(null)}
                    className={cn(
                      "cursor-pointer",
                      activeSubtitleIndex === null && "bg-white/10"
                    )}
                  >
                    Off
                  </DropdownMenuItem>
                  {subtitles.map((sub, i) => (
                    <DropdownMenuItem
                      key={sub.src}
                      onClick={() => setActiveSubtitle(i)}
                      className={cn(
                        "cursor-pointer",
                        i === activeSubtitleIndex && "bg-white/10"
                      )}
                    >
                      {sub.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Spacer - only on desktop */}
            {!prefersAlwaysOnControls && <div className="flex-1" />}


            {/* Playback speed - hide on TV */}
            {!prefersAlwaysOnControls && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className={cn(
                      "text-white hover:bg-white/10 text-sm h-10 px-3 rounded-full",
                      "focus:bg-white/20 focus:ring-2 focus:ring-white focus:outline-none"
                    )}
                  >
                    {playbackRate}x
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-zinc-900/95 border-zinc-800 backdrop-blur-sm">
                  {PLAYBACK_RATES.map((rate) => (
                    <DropdownMenuItem
                      key={rate}
                      onClick={() => handlePlaybackRateChange(rate)}
                      className={cn(
                        "cursor-pointer",
                        rate === playbackRate && "bg-white/10"
                      )}
                    >
                      {rate}x
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}


            {/* PiP - hide on TV as it may not be supported */}
            {!prefersAlwaysOnControls && (
              <button
                type="button"
                {...handleTVClick(togglePiP)}
                className={cn(
                  "flex items-center justify-center text-white rounded-full cursor-pointer h-10 w-10",
                  "hover:bg-white/10 active:bg-white/30",
                  "focus:bg-white/20 focus:ring-2 focus:ring-white focus:outline-none",
                  isPiP && "bg-white/20"
                )}
              >
                <PictureInPicture2 className="h-5 w-5" />
              </button>
            )}

            {/* Fullscreen - hide on TV as it doesn't work reliably */}
            {!prefersAlwaysOnControls && (
              <button
                type="button"
                {...handleTVClick(toggleFullscreen)}
                className="flex items-center justify-center text-white rounded-full cursor-pointer h-10 w-10 hover:bg-white/10 active:bg-white/30 focus:bg-white/20 focus:ring-2 focus:ring-white focus:outline-none"
              >
                {isFullscreen ? (
                  <Minimize className="h-5 w-5" />
                ) : (
                  <Maximize className="h-5 w-5" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
/* eslint-enable react-hooks/refs */
