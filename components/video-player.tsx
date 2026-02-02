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
  const [skipIndicator, setSkipIndicator] = useState<{ side: "left" | "right"; show: boolean }>({ side: "left", show: false });
  const lastTapRef = useRef<{ time: number; side: "left" | "right" | null }>({ time: 0, side: null });

  // Show controls on mouse move
  const handleMouseMove = useCallback(() => {
    setShowControls(true);

    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }

    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  }, [isPlaying]);

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

  // Fullscreen change handler
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const video = videoRef.current;
      if (!video) return;

      switch (e.key.toLowerCase()) {
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
        case "arrowleft":
        case "j":
          e.preventDefault();
          skip(-10);
          break;
        case "arrowright":
        case "l":
          e.preventDefault();
          skip(10);
          break;
        case "arrowup":
          e.preventDefault();
          adjustVolume(0.1);
          break;
        case "arrowdown":
          e.preventDefault();
          adjustVolume(-0.1);
          break;
        case "p":
          e.preventDefault();
          togglePiP();
          break;
        case "escape":
          if (isFullscreen) {
            document.exitFullscreen();
          } else if (onClose) {
            onClose();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, onClose]);

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
    if (!container) return;

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await container.requestFullscreen();
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
    video.currentTime = Math.max(0, Math.min(video.currentTime + seconds, maxTime));
  };

  // Double-tap to skip (TV/touch friendly)
  const handleVideoTap = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const side = x < rect.width / 2 ? "left" : "right";
    const now = Date.now();

    // Check for double-tap (within 300ms, same side)
    if (now - lastTapRef.current.time < 300 && lastTapRef.current.side === side) {
      // Double tap detected
      if (side === "left") {
        skip(-10);
      } else {
        skip(10);
      }
      setSkipIndicator({ side, show: true });
      setTimeout(() => setSkipIndicator(prev => ({ ...prev, show: false })), 500);
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
      className="relative w-full h-full bg-black group"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* Video */}
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full"
        autoPlay={autoPlay}
        playsInline
        onClick={handleVideoTap}
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
          <span className="text-white text-lg font-semibold">10 seconds</span>
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
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="h-20 w-20 bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white/20 transition-colors">
            <Play className="h-10 w-10 text-white fill-white ml-1" />
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

      {/* Netflix-style skip buttons in center */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center gap-32 pointer-events-none transition-opacity duration-300",
          showControls && !isBuffering ? "opacity-100" : "opacity-0"
        )}
      >
        {/* Skip back */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); skip(-10); }}
          className="pointer-events-auto flex flex-col items-center gap-1 group"
        >
          <div className="h-16 w-16 rounded-full border-2 border-white/30 flex items-center justify-center group-hover:border-white/60 group-hover:bg-white/10 transition-all">
            <svg className="h-8 w-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12.5 8.5L7.5 12l5 3.5V8.5z" fill="currentColor" stroke="none"/>
              <path d="M12 4V2" strokeLinecap="round"/>
              <path d="M12 4C7.58 4 4 7.58 4 12s3.58 8 8 8 8-3.58 8-8" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-white text-sm font-medium">10</span>
        </button>

        {/* Skip forward */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); skip(10); }}
          className="pointer-events-auto flex flex-col items-center gap-1 group"
        >
          <div className="h-16 w-16 rounded-full border-2 border-white/30 flex items-center justify-center group-hover:border-white/60 group-hover:bg-white/10 transition-all">
            <svg className="h-8 w-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M11.5 8.5l5 3.5-5 3.5V8.5z" fill="currentColor" stroke="none"/>
              <path d="M12 4V2" strokeLinecap="round"/>
              <path d="M12 4c4.42 0 8 3.58 8 8s-3.58 8-8 8-8-3.58-8-8" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="text-white text-sm font-medium">10</span>
        </button>
      </div>

      {/* Bottom controls */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/60 to-transparent transition-opacity duration-300 pb-4 pt-20",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6">
          {/* Progress bar */}
          <div className="relative group/progress mb-4" onClick={(e) => e.stopPropagation()}>
            {/* Buffered progress (pointer-events-none so clicks go through to slider) */}
            <div className="absolute h-1 group-hover/progress:h-1.5 bg-white/20 rounded-full w-full transition-all pointer-events-none">
              <div
                className="h-full bg-white/40 rounded-full"
                style={{ width: `${(buffered / duration) * 100}%` }}
              />
            </div>
            <Slider
              value={[currentTime]}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSeek}
              className="cursor-pointer [&_[role=slider]]:h-4 [&_[role=slider]]:w-4 [&_[role=slider]]:opacity-0 group-hover/progress:[&_[role=slider]]:opacity-100 [&_[role=slider]]:transition-opacity"
            />
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-4">
            {/* Play/Pause */}
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePlay}
              className="h-12 w-12 text-white hover:bg-white/10 rounded-full"
            >
              {isPlaying ? (
                <Pause className="h-7 w-7" />
              ) : (
                <Play className="h-7 w-7 fill-current ml-1" />
              )}
            </Button>

            {/* Volume */}
            <div className="flex items-center gap-2 group/volume">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleMute}
                className="h-10 w-10 text-white hover:bg-white/10 rounded-full"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="h-5 w-5" />
                ) : (
                  <Volume2 className="h-5 w-5" />
                )}
              </Button>
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

            {/* Time */}
            <span className="text-sm text-white/90 tabular-nums">
              {formatDuration(currentTime)} / {formatDuration(duration)}
            </span>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Playback speed */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="text-white hover:bg-white/10 text-sm h-10 px-3 rounded-full"
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

            {/* PiP */}
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePiP}
              className={cn(
                "h-10 w-10 text-white hover:bg-white/10 rounded-full",
                isPiP && "bg-white/20"
              )}
            >
              <PictureInPicture2 className="h-5 w-5" />
            </Button>

            {/* Fullscreen */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleFullscreen}
              className="h-10 w-10 text-white hover:bg-white/10 rounded-full"
            >
              {isFullscreen ? (
                <Minimize className="h-5 w-5" />
              ) : (
                <Maximize className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
