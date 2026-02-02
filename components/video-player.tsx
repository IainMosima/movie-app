"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture2,
  Loader2,
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
  title?: string;
  onClose?: () => void;
  autoPlay?: boolean;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function VideoPlayer({
  src,
  title,
  onClose,
  autoPlay = true,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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
  const [skipIndicator, setSkipIndicator] = useState<{ side: "left" | "right"; show: boolean; seconds: number }>({ side: "left", show: false, seconds: 10 });
  const lastTapRef = useRef<{ time: number; side: "left" | "right" | null }>({ time: 0, side: null });
  const [prefersAlwaysOnControls, setPrefersAlwaysOnControls] = useState(false);

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
    const media = window.matchMedia("(hover: none), (pointer: coarse)");

    // Also check for TV-like characteristics
    const isLikelyTV = () => {
      const ua = navigator.userAgent.toLowerCase();
      return (
        ua.includes("tv") ||
        ua.includes("vidaa") ||
        ua.includes("hisense") ||
        ua.includes("tizen") ||
        ua.includes("webos") ||
        ua.includes("smart") ||
        ua.includes("netcast") ||
        window.innerWidth >= 1280 && !("ontouchstart" in window) && media.matches
      );
    };

    const update = () => setPrefersAlwaysOnControls(media.matches || isLikelyTV());
    update();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
    } else {
      (media as MediaQueryList & { addListener: (cb: () => void) => void }).addListener(update);
    }
    return () => {
      if (typeof media.removeEventListener === "function") {
        media.removeEventListener("change", update);
      } else {
        (media as MediaQueryList & { removeListener: (cb: () => void) => void }).removeListener(update);
      }
    };
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

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration);
    const handleWaiting = () => setIsBuffering(true);
    const handlePlaying = () => setIsBuffering(false);
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

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("durationchange", handleDurationChange);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("progress", handleProgress);
    video.addEventListener("volumechange", handleVolumeChange);

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
    };
  }, []);

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
  }, [isFullscreen, onClose]);

  const seekTo = (time: number) => {
    const video = videoRef.current;
    if (!video) return;

    const newTime = Math.max(0, Math.min(time, (video.duration || 0) - 1));

    try {
      video.currentTime = newTime;

      // Use fastSeek if available
      if ('fastSeek' in video && typeof video.fastSeek === 'function') {
        (video as HTMLVideoElement & { fastSeek: (time: number) => void }).fastSeek(newTime);
      }

      console.log(`Seek to ${newTime.toFixed(1)}s`);
    } catch (err) {
      console.error('Seek error:', err);
    }
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video || !duration) return;
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

  // TV pointer helper - handles all possible click events from TV remotes
  const handleTVClick = (action: () => void) => ({
    onClick: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); action(); },
    onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); },
    onMouseUp: (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); action(); },
    onTouchEnd: (e: React.TouchEvent) => { e.preventDefault(); e.stopPropagation(); action(); },
    onKeyDown: handleTVKeyDown(action),
  });

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

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  };

  const toggleFullscreen = async () => {
    const container = containerRef.current;
    const video = videoRef.current;
    if (!container) return;

    // Check current fullscreen state (with vendor prefixes for VIDAA/WebKit)
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
        // Exit fullscreen with vendor prefix fallbacks
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
        // Enter fullscreen with vendor prefix fallbacks
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
          // iOS/some TVs only support fullscreen on video element
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
  };

  const togglePiP = async () => {
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
  };

  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;

    const maxTime = video.duration || Infinity;
    const newTime = Math.max(0, Math.min(video.currentTime + seconds, maxTime - 1));

    // Show skip feedback indicator
    setSkipIndicator({
      side: seconds < 0 ? "left" : "right",
      show: true,
      seconds: Math.abs(seconds)
    });
    setTimeout(() => setSkipIndicator(prev => ({ ...prev, show: false })), 800);

    // Try multiple methods to seek (TV browsers can be finicky)
    try {
      // Method 1: Direct assignment
      video.currentTime = newTime;

      // Method 2: If video is paused, also try play/pause cycle to force update
      if (video.paused) {
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            video.pause();
            video.currentTime = newTime;
          }).catch(() => {});
        }
      }

      // Method 3: Use fastSeek if available (some TV browsers support this)
      if ('fastSeek' in video && typeof video.fastSeek === 'function') {
        (video as HTMLVideoElement & { fastSeek: (time: number) => void }).fastSeek(newTime);
      }

      console.log(`Skip to ${newTime.toFixed(1)}s (was ${video.currentTime.toFixed(1)}s)`);
    } catch (err) {
      console.error('Seek error:', err);
    }
  };

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

  const adjustVolume = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(video.volume + delta, 1));
    if (video.muted && delta > 0) {
      video.muted = false;
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
        "relative w-full h-full bg-black group",
        prefersAlwaysOnControls && "touch-manipulation tv-show-cursor"
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
      {/* Video - use native controls on TV for better seeking support */}
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full"
        autoPlay={autoPlay}
        playsInline
        controls={prefersAlwaysOnControls}
        controlsList="nodownload noplaybackrate"
        onClick={!prefersAlwaysOnControls ? handleVideoTap : undefined}
        onTouchStart={() => setShowControls(true)}
        onPointerDown={() => {
          setShowControls(true);
          containerRef.current?.focus();
        }}
      />

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

      {/* Buffering overlay */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-12 w-12 text-white animate-spin" />
            <p className="text-sm text-zinc-400">
              Buffering... {Math.round((buffered / duration) * 100) || 0}%
            </p>
          </div>
        </div>
      )}


      {/* Center play button (when paused) */}
      {!isPlaying && !isBuffering && (
        <button
          type="button"
          {...handleTVClick(togglePlay)}
          className="absolute inset-0 flex items-center justify-center outline-none cursor-pointer z-10"
        >
          <div className={cn(
            "bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center transition-colors",
            "hover:bg-white/20 active:bg-white/40 focus:bg-white/30 focus:ring-4 focus:ring-white/50",
            prefersAlwaysOnControls ? "h-28 w-28" : "h-20 w-20"
          )}>
            <Play className={cn(
              "text-white fill-white ml-1",
              prefersAlwaysOnControls ? "h-14 w-14" : "h-10 w-10"
            )} />
          </div>
        </button>
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

      {/* Netflix-style skip buttons in center - hide on TV when using native controls */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center gap-32 pointer-events-none transition-opacity duration-300",
          showControls && !isBuffering && !prefersAlwaysOnControls ? "opacity-100" : "opacity-0"
        )}
      >
        {/* Skip back */}
        <button
          type="button"
          {...handleTVClick(() => skip(-10))}
          className={cn(
            "pointer-events-auto flex flex-col items-center gap-1 group outline-none cursor-pointer",
            prefersAlwaysOnControls && "gap-2"
          )}
        >
          <div className={cn(
            "h-16 w-16 rounded-full border-2 border-white/30 flex items-center justify-center transition-all",
            "hover:border-white/60 hover:bg-white/10 active:bg-white/30",
            "group-focus:border-white group-focus:bg-white/20 group-focus:ring-4 group-focus:ring-white/30",
            prefersAlwaysOnControls && "h-24 w-24"
          )}>
            <svg className={cn("h-8 w-8 text-white", prefersAlwaysOnControls && "h-12 w-12")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12.5 8.5L7.5 12l5 3.5V8.5z" fill="currentColor" stroke="none"/>
              <path d="M12 4V2" strokeLinecap="round"/>
              <path d="M12 4C7.58 4 4 7.58 4 12s3.58 8 8 8 8-3.58 8-8" strokeLinecap="round"/>
            </svg>
          </div>
          <span className={cn("text-white text-sm font-medium", prefersAlwaysOnControls && "text-lg")}>-10s</span>
        </button>

        {/* Skip forward */}
        <button
          type="button"
          {...handleTVClick(() => skip(10))}
          className={cn(
            "pointer-events-auto flex flex-col items-center gap-1 group outline-none cursor-pointer",
            prefersAlwaysOnControls && "gap-2"
          )}
        >
          <div className={cn(
            "h-16 w-16 rounded-full border-2 border-white/30 flex items-center justify-center transition-all",
            "hover:border-white/60 hover:bg-white/10 active:bg-white/30",
            "group-focus:border-white group-focus:bg-white/20 group-focus:ring-4 group-focus:ring-white/30",
            prefersAlwaysOnControls && "h-24 w-24"
          )}>
            <svg className={cn("h-8 w-8 text-white", prefersAlwaysOnControls && "h-12 w-12")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M11.5 8.5l5 3.5-5 3.5V8.5z" fill="currentColor" stroke="none"/>
              <path d="M12 4V2" strokeLinecap="round"/>
              <path d="M12 4c4.42 0 8 3.58 8 8s-3.58 8-8 8-8-3.58-8-8" strokeLinecap="round"/>
            </svg>
          </div>
          <span className={cn("text-white text-sm font-medium", prefersAlwaysOnControls && "text-lg")}>+10s</span>
        </button>
      </div>

      {/* Bottom controls - hide on TV when using native controls */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/60 to-transparent transition-opacity duration-300 pb-4 pt-20",
          showControls && !prefersAlwaysOnControls ? "opacity-100" : "opacity-0 pointer-events-none"
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
                "absolute bg-red-500 rounded-full transition-all",
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

          {/* Controls row */}
          <div className={cn("flex items-center gap-4", prefersAlwaysOnControls && "gap-6")}>
            {/* Play/Pause */}
            <button
              type="button"
              {...handleTVClick(togglePlay)}
              className={cn(
                "flex items-center justify-center text-white rounded-full cursor-pointer",
                "hover:bg-white/10 active:bg-white/30",
                "focus:bg-white/20 focus:ring-2 focus:ring-white focus:outline-none",
                prefersAlwaysOnControls ? "h-16 w-16" : "h-12 w-12"
              )}
            >
              {isPlaying ? (
                <Pause className={cn(prefersAlwaysOnControls ? "h-9 w-9" : "h-7 w-7")} />
              ) : (
                <Play className={cn("fill-current ml-1", prefersAlwaysOnControls ? "h-9 w-9" : "h-7 w-7")} />
              )}
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2 group/volume">
              <button
                type="button"
                {...handleTVClick(toggleMute)}
                className={cn(
                  "flex items-center justify-center text-white rounded-full cursor-pointer",
                  "hover:bg-white/10 active:bg-white/30",
                  "focus:bg-white/20 focus:ring-2 focus:ring-white focus:outline-none",
                  prefersAlwaysOnControls ? "h-14 w-14" : "h-10 w-10"
                )}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className={cn(prefersAlwaysOnControls ? "h-7 w-7" : "h-5 w-5")} />
                ) : (
                  <Volume2 className={cn(prefersAlwaysOnControls ? "h-7 w-7" : "h-5 w-5")} />
                )}
              </button>
              <div className={cn(
                "w-0 overflow-hidden group-hover/volume:w-20 transition-all duration-200",
                prefersAlwaysOnControls && "w-28"
              )}>
                <Slider
                  value={[isMuted ? 0 : volume]}
                  max={1}
                  step={0.01}
                  onValueChange={handleVolumeChange}
                  className={cn("cursor-pointer", prefersAlwaysOnControls && "[&_[role=slider]]:h-5 [&_[role=slider]]:w-5")}
                />
              </div>
            </div>

            {/* Time */}
            <span className={cn("text-sm text-white/90 tabular-nums", prefersAlwaysOnControls && "text-base")}>
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>

            {/* Spacer */}
            <div className="flex-1" />

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

            {/* Fullscreen */}
            <button
              type="button"
              {...handleTVClick(toggleFullscreen)}
              className={cn(
                "flex items-center justify-center text-white rounded-full cursor-pointer",
                "hover:bg-white/10 active:bg-white/30",
                "focus:bg-white/20 focus:ring-2 focus:ring-white focus:outline-none",
                prefersAlwaysOnControls ? "h-16 w-16" : "h-10 w-10"
              )}
            >
              {isFullscreen ? (
                <Minimize className={cn(prefersAlwaysOnControls ? "h-8 w-8" : "h-5 w-5")} />
              ) : (
                <Maximize className={cn(prefersAlwaysOnControls ? "h-8 w-8" : "h-5 w-5")} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
