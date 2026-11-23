import { useCallback, useEffect, useRef, useState } from "react";
import { formatDurationBadge, formatSeconds } from "../lib/youtube";
import { getLocalVideoBlob } from "../lib/idb";
import type { Video, VideoChapter } from "../types";
import { Icon } from "./Icons";

type YTPlayerInstance = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  isMuted: () => boolean;
  setPlaybackRate: (rate: number) => void;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (event: { target: YTPlayerInstance }) => void;
        onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
        onError?: (event: { data: number }) => void;
      };
    },
  ) => YTPlayerInstance;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
  };
};

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    const existingReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      existingReady?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error("YouTube IFrame API failed to initialize."));
      }
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("Could not load YouTube player script."));
      document.head.appendChild(script);
    }
  });

  return ytApiPromise;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

type VideoPlayerProps = {
  video: Video;
  nextVideo?: Video;
  initialSeekSeconds?: number | null;
  onPlayNext?: (next: Video) => void;
  onSaveProgress: (
    id: string,
    progressPercent: number,
    progressSeconds: number,
    durationSeconds?: number,
    durationLabel?: string,
  ) => void;
  onSaveChapters?: (id: string, chapters: VideoChapter[]) => void;
  onCaptureThumbnail?: (id: string, dataUrl: string) => void;
  onClose: () => void;
};

export function VideoPlayer({
  video,
  nextVideo,
  initialSeekSeconds,
  onPlayNext,
  onSaveProgress,
  onSaveChapters,
  onCaptureThumbnail,
  onClose,
}: VideoPlayerProps) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const htmlVideoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number | null>(null);
  const lastSavedRef = useRef<number>(0);

  const [playing, setPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(video.progressSeconds ?? 0);
  const [duration, setDuration] = useState(video.durationSeconds ?? 0);
  const [volume, setVolume] = useState(90);
  const [muted, setMuted] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(2); // 1x
  const [visible, setVisible] = useState(true);
  const [nativeYtInteractive, setNativeYtInteractive] = useState(false);
  const [ytErrorCode, setYtErrorCode] = useState<number | null>(null);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [autoNextCountdown, setAutoNextCountdown] = useState<number | null>(null);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [addingChapter, setAddingChapter] = useState(false);
  const [chapterLabel, setChapterLabel] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const isYouTube = video.sourceType === "youtube" && Boolean(video.youtubeId);
  const isNativeVideo = video.sourceType === "video" && Boolean(video.videoUrl);
  const isPrototype = !isYouTube && !isNativeVideo;
  const chapters = video.chapters ?? [];

  const [resolvedVideoSrc, setResolvedVideoSrc] = useState<string>(() =>
    video.videoUrl?.startsWith("indexeddb://") ? "" : (video.videoUrl || "")
  );

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (video.videoUrl?.startsWith("indexeddb://")) {
      const id = video.videoUrl.replace("indexeddb://", "");
      void getLocalVideoBlob(id).then((blob) => {
        if (!active) return;
        if (blob) {
          objectUrl = URL.createObjectURL(blob);
          setResolvedVideoSrc(objectUrl);
        }
      });
    } else {
      setResolvedVideoSrc(video.videoUrl || "");
    }

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [video.videoUrl]);

  const progressPercent =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : video.progress ?? 0;

  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  currentTimeRef.current = currentTime;
  durationRef.current = duration;

  const flushProgress = useCallback(
    (force = false) => {
      if (isPrototype) return;
      const now = Date.now();
      if (!force && now - lastSavedRef.current < 5000) return;

      const dur = durationRef.current;
      const cur = currentTimeRef.current;
      if (dur <= 0) return;

      lastSavedRef.current = now;
      const pct = Math.min(100, Math.max(0, Math.round((cur / dur) * 100)));
      const normalizedPct = pct >= 97 ? 100 : pct;
      onSaveProgress(
        video.id,
        normalizedPct,
        Math.floor(cur),
        Math.round(dur),
        formatDurationBadge(dur),
      );
    },
    [isPrototype, onSaveProgress, video.id],
  );

  const playingRef = useRef(playing);
  playingRef.current = playing;

  const scheduleHide = useCallback((delay = 4000) => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (playingRef.current) {
        setVisible(false);
        setChaptersOpen(false);
        setShortcutsOpen(false);
      }
    }, delay);
  }, []);

  const wake = useCallback(() => {
    setVisible(true);
    scheduleHide(4000);
  }, [scheduleHide]);

  const lastMousePosRef = useRef<{ x: number; y: number } | null>(null);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      const last = lastMousePosRef.current;
      if (last && Math.abs(last.x - e.clientX) < 3 && Math.abs(last.y - e.clientY) < 3) {
        return;
      }
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      wake();
    },
    [wake],
  );

  // Fullscreen transition listener to ensure elements disappear after shifting to fullscreen
  useEffect(() => {
    const handleFullscreenChange = () => {
      setVisible(true);
      scheduleHide(4000);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, [scheduleHide]);

  // Window-level mouse activity tracking with coordinate diffing to ignore synthetic re-render mouse moves
  useEffect(() => {
    const onWindowMouseMove = (e: MouseEvent) => {
      const last = lastMousePosRef.current;
      if (last && Math.abs(last.x - e.clientX) < 3 && Math.abs(last.y - e.clientY) < 3) {
        return;
      }
      lastMousePosRef.current = { x: e.clientX, y: e.clientY };
      wake();
    };

    window.addEventListener("mousemove", onWindowMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onWindowMouseMove);
    };
  }, [wake]);

  // Reset per-video state ONLY when switching to a different video
  useEffect(() => {
    const startSec =
      typeof initialSeekSeconds === "number" && initialSeekSeconds >= 0
        ? initialSeekSeconds
        : video.progressSeconds ?? 0;
    setCurrentTime(startSec);
    setDuration(video.durationSeconds ?? 0);
    setPlaying(true);
    setYtErrorCode(null);
    setUpNextDismissed(false);
    setAutoNextCountdown(null);
    setAddingChapter(false);
    setChapterLabel("");
    lastSavedRef.current = 0;
    setVisible(true);
    scheduleHide(4000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  // Countdown to Auto-Play Next when video ends
  useEffect(() => {
    if (autoNextCountdown === null || !nextVideo || !onPlayNext) return;
    if (autoNextCountdown <= 0) {
      onPlayNext(nextVideo);
      return;
    }
    const timer = window.setTimeout(() => {
      setAutoNextCountdown((c) => (c !== null ? c - 1 : null));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [autoNextCountdown, nextVideo, onPlayNext]);

  // YouTube IFrame API setup
  useEffect(() => {
    if (!isYouTube || !video.youtubeId) return;
    let cancelled = false;
    let pollId: number | null = null;

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !ytHostRef.current) return;
        ytHostRef.current.innerHTML = "";
        const mountNode = document.createElement("div");
        ytHostRef.current.appendChild(mountNode);

        const startAt =
          typeof initialSeekSeconds === "number" && initialSeekSeconds >= 0
            ? Math.floor(initialSeekSeconds)
            : video.progressSeconds && (video.progress ?? 0) < 96
              ? Math.floor(video.progressSeconds)
              : 0;

        const instance = new YT.Player(mountNode, {
          videoId: video.youtubeId!,
          playerVars: {
            autoplay: 1,
            controls: 1,
            modestbranding: 1,
            rel: 0,
            iv_load_policy: 3,
            playsinline: 1,
            start: startAt,
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              ytPlayerRef.current = e.target;
              const d = e.target.getDuration();
              if (d > 0) setDuration(d);
              e.target.setVolume(volume);
              if (muted) e.target.mute();
              e.target.playVideo();
            },
            onStateChange: (e) => {
              if (cancelled) return;
              if (e.data === YT.PlayerState.PLAYING) {
                setPlaying(true);
                const d = e.target.getDuration();
                if (d > 0) setDuration(d);
                scheduleHide(4000);
              } else if (e.data === YT.PlayerState.PAUSED) {
                setPlaying(false);
                if (hideTimer.current) window.clearTimeout(hideTimer.current);
                setVisible(true);
                flushProgress(true);
              } else if (e.data === YT.PlayerState.ENDED) {
                setPlaying(false);
                if (hideTimer.current) window.clearTimeout(hideTimer.current);
                setVisible(true);
                flushProgress(true);
                if (nextVideo && onPlayNext) {
                  setAutoNextCountdown(5);
                }
              }
            },
            onError: (e) => {
              if (!cancelled) setYtErrorCode(e.data);
            },
          },
        });

        ytPlayerRef.current = instance;
        pollId = window.setInterval(() => {
          const p = ytPlayerRef.current;
          if (!p) return;
          try {
            const t = p.getCurrentTime?.() ?? 0;
            const d = p.getDuration?.() ?? 0;
            if (d > 0) setDuration(d);
            if (Number.isFinite(t)) setCurrentTime(t);
            flushProgress(false);
          } catch {
            // Player might not be ready yet.
          }
        }, 500);
      })
      .catch(() => {
        if (!cancelled) setYtErrorCode(-1);
      });

    return () => {
      cancelled = true;
      if (pollId) window.clearInterval(pollId);
      flushProgress(true);
      try {
        ytPlayerRef.current?.destroy();
      } catch {
        // Ignore teardown errors.
      }
      ytPlayerRef.current = null;
    };
    // Intentionally re-init only when video.id or video.youtubeId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYouTube, video.id, video.youtubeId]);

  // Prototype simulation fallback
  useEffect(() => {
    if (!isPrototype) return;
    const total = 600;
    setDuration(total);
    setCurrentTime(((video.progress ?? 12) / 100) * total);
    const id = window.setInterval(() => {
      setCurrentTime((prev) => {
        if (!playing) return prev;
        return prev + 0.8 >= total ? 0 : prev + 0.8;
      });
    }, 500);
    return () => window.clearInterval(id);
  }, [isPrototype, playing, video.id, video.progress]);

  // Save HTML5 video progress cleanly on unmount
  useEffect(() => {
    if (!isNativeVideo) return;
    return () => flushProgress(true);
  }, [isNativeVideo, flushProgress]);

  const togglePlay = useCallback(() => {
    if (isYouTube && ytPlayerRef.current) {
      if (playing) {
        ytPlayerRef.current.pauseVideo();
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
        setVisible(true);
        setPlaying(false);
      } else {
        ytPlayerRef.current.playVideo();
        setPlaying(true);
        wake();
      }
      return;
    }

    if (isNativeVideo && htmlVideoRef.current) {
      if (htmlVideoRef.current.paused) {
        void htmlVideoRef.current.play();
        setPlaying(true);
        wake();
      } else {
        htmlVideoRef.current.pause();
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
        setVisible(true);
        setPlaying(false);
      }
      return;
    }

    setPlaying((prev) => {
      const next = !prev;
      if (next) {
        wake();
      } else {
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
        setVisible(true);
      }
      return next;
    });
  }, [isNativeVideo, isYouTube, playing, wake]);

  const seekToSeconds = useCallback(
    (targetSeconds: number) => {
      wake();
      const maxTime = durationRef.current > 0 ? durationRef.current : 600;
      const clamped = Math.max(0, Math.min(maxTime, targetSeconds));
      setCurrentTime(clamped);

      if (isYouTube && ytPlayerRef.current) {
        ytPlayerRef.current.seekTo(clamped, true);
      } else if (isNativeVideo && htmlVideoRef.current) {
        htmlVideoRef.current.currentTime = clamped;
      }
    },
    [isNativeVideo, isYouTube, wake],
  );

  const handleVolumeChange = useCallback(
    (nextVol: number) => {
      wake();
      const clamped = Math.max(0, Math.min(100, nextVol));
      setVolume(clamped);
      const shouldMute = clamped === 0;
      setMuted(shouldMute);

      if (isYouTube && ytPlayerRef.current) {
        ytPlayerRef.current.setVolume(clamped);
        if (shouldMute) ytPlayerRef.current.mute();
        else ytPlayerRef.current.unMute();
      } else if (isNativeVideo && htmlVideoRef.current) {
        htmlVideoRef.current.volume = clamped / 100;
        htmlVideoRef.current.muted = shouldMute;
      }
    },
    [isNativeVideo, isYouTube, wake],
  );

  const toggleMute = useCallback(() => {
    wake();
    const nextMuted = !muted;
    setMuted(nextMuted);
    if (isYouTube && ytPlayerRef.current) {
      if (nextMuted) ytPlayerRef.current.mute();
      else {
        ytPlayerRef.current.unMute();
        ytPlayerRef.current.setVolume(volume > 0 ? volume : 80);
      }
    } else if (isNativeVideo && htmlVideoRef.current) {
      htmlVideoRef.current.muted = nextMuted;
    }
  }, [isNativeVideo, isYouTube, muted, volume, wake]);

  const cycleSpeed = useCallback(() => {
    wake();
    const nextIdx = (speedIndex + 1) % SPEEDS.length;
    const rate = SPEEDS[nextIdx];
    setSpeedIndex(nextIdx);
    if (isYouTube && ytPlayerRef.current) {
      ytPlayerRef.current.setPlaybackRate(rate);
    } else if (isNativeVideo && htmlVideoRef.current) {
      htmlVideoRef.current.playbackRate = rate;
    }
  }, [isNativeVideo, isYouTube, speedIndex, wake]);

  const toggleFullscreen = useCallback(() => {
    const doc = document as unknown as {
      fullscreenElement?: Element;
      webkitFullscreenElement?: Element;
      exitFullscreen?: () => Promise<void>;
      webkitExitFullscreen?: () => Promise<void>;
    };
    const el = playerContainerRef.current as unknown as {
      requestFullscreen?: () => Promise<void>;
      webkitRequestFullscreen?: () => Promise<void>;
    };

    if (doc.fullscreenElement || doc.webkitFullscreenElement) {
      void (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(document);
    } else {
      void (el?.requestFullscreen || el?.webkitRequestFullscreen)?.call(el);
    }
    setVisible(true);
    scheduleHide(4000);
  }, [scheduleHide]);

  const stepSpeed = useCallback(
    (delta: number) => {
      wake();
      const nextIdx = Math.max(0, Math.min(SPEEDS.length - 1, speedIndex + delta));
      const rate = SPEEDS[nextIdx];
      setSpeedIndex(nextIdx);
      if (isYouTube && ytPlayerRef.current) {
        ytPlayerRef.current.setPlaybackRate(rate);
      } else if (isNativeVideo && htmlVideoRef.current) {
        htmlVideoRef.current.playbackRate = rate;
      }
    },
    [isNativeVideo, isYouTube, speedIndex, wake],
  );

  const openBookmarkComposer = useCallback(() => {
    wake();
    setChapterLabel(`Moment at ${formatSeconds(currentTimeRef.current)}`);
    setAddingChapter(true);
  }, [wake]);

  const handleSaveChapter = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!onSaveChapters) return;
      const cleanLabel = chapterLabel.trim();
      if (!cleanLabel) return;
      const newChapter: VideoChapter = {
        id: crypto.randomUUID(),
        time: Math.floor(currentTimeRef.current),
        label: cleanLabel.slice(0, 80),
      };
      const updated = [...chapters, newChapter].sort((a, b) => a.time - b.time);
      onSaveChapters(video.id, updated);
      setAddingChapter(false);
      setChapterLabel("");
      setChaptersOpen(true);
    },
    [chapterLabel, chapters, onSaveChapters, video.id],
  );

  const handleDeleteChapter = useCallback(
    (chapterId: string) => {
      if (!onSaveChapters) return;
      const updated = chapters.filter((c) => c.id !== chapterId);
      onSaveChapters(video.id, updated);
    },
    [chapters, onSaveChapters, video.id],
  );

  const handleCapturePlayerFrame = useCallback(() => {
    const el = htmlVideoRef.current;
    if (!el || !onCaptureThumbnail || !el.videoWidth || !el.videoHeight) return;
    try {
      const maxW = 1280;
      const scale = el.videoWidth > maxW ? maxW / el.videoWidth : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(el.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(el.videoHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
      onCaptureThumbnail(video.id, dataUrl);
    } catch {
      // Cross-origin frame capture may be blocked by browser policy.
    }
  }, [onCaptureThumbnail, video.id]);

  const handleClose = useCallback(() => {
    flushProgress(true);
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
    onClose();
  }, [flushProgress, onClose]);

  useEffect(() => {
    scheduleHide();
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;

      wake();
      if (event.key === "Escape") {
        if (!document.fullscreenElement) handleClose();
      } else if (event.code === "Space" || event.key.toLowerCase() === "k") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "ArrowLeft" || event.key.toLowerCase() === "j") {
        event.preventDefault();
        seekToSeconds(currentTimeRef.current - 10);
      } else if (event.key === "ArrowRight" || event.key.toLowerCase() === "l") {
        event.preventDefault();
        seekToSeconds(currentTimeRef.current + 10);
      } else if (event.key.toLowerCase() === "m") {
        toggleMute();
      } else if (event.key.toLowerCase() === "f") {
        toggleFullscreen();
      } else if (event.key.toLowerCase() === "b" && onSaveChapters) {
        event.preventDefault();
        openBookmarkComposer();
      } else if (event.key === "[") {
        stepSpeed(-1);
      } else if (event.key === "]") {
        stepSpeed(1);
      } else if (event.key === "?") {
        setShortcutsOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [
    handleClose,
    onSaveChapters,
    openBookmarkComposer,
    scheduleHide,
    seekToSeconds,
    stepSpeed,
    toggleFullscreen,
    toggleMute,
    togglePlay,
    wake,
  ]);

  const showUpNext =
    Boolean(nextVideo && onPlayNext) &&
    !upNextDismissed &&
    (autoNextCountdown !== null || (duration > 20 && duration - currentTime <= 12));

  return (
    <div
      ref={playerContainerRef}
      className={`player ${visible || nativeYtInteractive ? "" : "player--hidden"}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (playingRef.current) scheduleHide(1000);
      }}
      onTouchStart={wake}
    >
      {isYouTube && (
        <div className="player-youtube-stage">
          <div ref={ytHostRef} className="player-youtube-frame" />
          {!nativeYtInteractive && !ytErrorCode && (
            <div
              className="player-hit-shield"
              onClick={togglePlay}
              onDoubleClick={toggleFullscreen}
            />
          )}
          {ytErrorCode !== null && (
            <div className="player-error-card">
              <h2>YouTube playback unavailable (Code {ytErrorCode})</h2>
              <p>
                To play inside Myflix, set this video to <strong>Unlisted</strong> or{" "}
                <strong>Public</strong> (not Private) and turn on <strong>Allow embedding</strong>{" "}
                in YouTube Studio.
              </p>
              <div className="player-error-actions">
                <a
                  className="button button--light"
                  href={`https://www.youtube.com/watch?v=${video.youtubeId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open on YouTube
                </a>
                <button className="button button--glass" onClick={handleClose}>
                  Back to Myflix
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {isNativeVideo && (
        <video
          ref={htmlVideoRef}
          className="player-html-video"
          src={resolvedVideoSrc}
          poster={video.image}
          playsInline
          autoPlay
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (el.duration > 0) setDuration(el.duration);
            if (typeof initialSeekSeconds === "number" && initialSeekSeconds >= 0) {
              el.currentTime = Math.min(initialSeekSeconds, Math.max(0, el.duration - 1));
            } else if (video.progressSeconds && (video.progress ?? 0) < 96) {
              el.currentTime = Math.min(video.progressSeconds, Math.max(0, el.duration - 2));
            }
            el.volume = volume / 100;
            el.muted = muted;
            el.playbackRate = SPEEDS[speedIndex];
          }}
          onTimeUpdate={(e) => {
            setCurrentTime(e.currentTarget.currentTime);
            flushProgress(false);
          }}
          onPlay={() => {
            setPlaying(true);
            scheduleHide(4000);
          }}
          onPause={() => {
            setPlaying(false);
            if (hideTimer.current) window.clearTimeout(hideTimer.current);
            setVisible(true);
            flushProgress(true);
          }}
          onEnded={() => {
            setPlaying(false);
            if (hideTimer.current) window.clearTimeout(hideTimer.current);
            setVisible(true);
            flushProgress(true);
            if (nextVideo && onPlayNext && !upNextDismissed) {
              setAutoNextCountdown(5);
            }
          }}
        />
      )}

      {isPrototype && (
        <>
          <img src={video.image.replace("w=1200", "w=2000")} alt="" />
          <div className="player-demo-banner">
            Prototype preview — add your own YouTube link or video via <strong>+ Add Video</strong>{" "}
            to stream real video
          </div>
        </>
      )}

      <div className="player-vignette" />

      <header>
        <button onClick={handleClose} aria-label="Back">
          <Icon name="left" size={34} />
        </button>
        <div className="player-title-wrap">
          <h1>{video.title}</h1>
          <span className="player-cat-pill">{video.category}</span>
        </div>
        <div className="player-header-tools">
          {onSaveChapters && !isPrototype && (
            <>
              <button
                className={`player-pill-btn ${addingChapter ? "active" : ""}`}
                onClick={openBookmarkComposer}
                title="Bookmark this moment (B)"
              >
                <Icon name="bookmark" size={14} />
                <span>Bookmark</span>
              </button>
              <button
                className={`player-pill-btn ${chaptersOpen ? "active" : ""}`}
                onClick={() => {
                  wake();
                  setChaptersOpen((prev) => !prev);
                }}
                title="View saved chapters and moments"
              >
                <Icon name="list" size={14} />
                <span>Moments{chapters.length ? ` (${chapters.length})` : ""}</span>
              </button>
            </>
          )}
          <button
            className={`player-pill-btn ${shortcutsOpen ? "active" : ""}`}
            onClick={() => {
              wake();
              setShortcutsOpen((prev) => !prev);
            }}
            title="Keyboard shortcuts (?)"
          >
            <Icon name="keyboard" size={14} />
          </button>
          {isYouTube && (
            <button
              className={`player-pill-btn ${nativeYtInteractive ? "active" : ""}`}
              onClick={() => {
                wake();
                setNativeYtInteractive((prev) => !prev);
              }}
              title="Toggle direct interaction with YouTube captions and quality menu"
            >
              {nativeYtInteractive ? "Using YT Controls" : "YT Menu / CC"}
            </button>
          )}
        </div>
      </header>

      {addingChapter && (
        <form className="player-chapter-composer" onSubmit={handleSaveChapter}>
          <span className="player-chapter-time">{formatSeconds(currentTime)}</span>
          <input
            type="text"
            value={chapterLabel}
            onChange={(e) => setChapterLabel(e.target.value)}
            placeholder="Name this moment (e.g. Summit view)"
            autoFocus
          />
          <button type="submit" className="button button--red">
            Save
          </button>
          <button
            type="button"
            className="button button--glass"
            onClick={() => setAddingChapter(false)}
          >
            Cancel
          </button>
        </form>
      )}

      {chaptersOpen && (
        <aside className="player-chapters-drawer" aria-label="Bookmarked moments">
          <div className="player-drawer-head">
            <strong>Bookmarked Moments</strong>
            <button
              type="button"
              onClick={() => setChaptersOpen(false)}
              aria-label="Close moments drawer"
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          {chapters.length === 0 ? (
            <p className="player-drawer-empty">
              Press <strong>Bookmark</strong> (or <code>B</code>) while watching to save favorite
              timestamps synced across all your devices.
            </p>
          ) : (
            <div className="player-chapters-list">
              {chapters.map((ch) => (
                <div key={ch.id} className="player-chapter-item">
                  <button
                    type="button"
                    className="player-chapter-jump"
                    onClick={() => seekToSeconds(ch.time)}
                  >
                    <span>{formatSeconds(ch.time)}</span>
                    <strong>{ch.label}</strong>
                  </button>
                  <button
                    type="button"
                    className="player-chapter-del"
                    aria-label={`Remove ${ch.label}`}
                    onClick={() => handleDeleteChapter(ch.id)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
      )}

      {shortcutsOpen && (
        <div className="player-shortcuts-card" role="dialog" aria-label="Keyboard shortcuts">
          <div className="player-drawer-head">
            <strong>Player Shortcuts</strong>
            <button type="button" onClick={() => setShortcutsOpen(false)} aria-label="Close">
              <Icon name="close" size={16} />
            </button>
          </div>
          <div className="shortcuts-grid">
            <div><kbd>Space</kbd> / <kbd>K</kbd><span>Play / Pause</span></div>
            <div><kbd>J</kbd> / <kbd>←</kbd><span>Back 10s</span></div>
            <div><kbd>L</kbd> / <kbd>→</kbd><span>Forward 10s</span></div>
            <div><kbd>B</kbd><span>Bookmark Moment</span></div>
            <div><kbd>[</kbd> / <kbd>]</kbd><span>Speed - / +</span></div>
            <div><kbd>M</kbd><span>Mute</span></div>
            <div><kbd>F</kbd><span>Fullscreen</span></div>
            <div><kbd>?</kbd><span>Toggle Guide</span></div>
          </div>
        </div>
      )}

      {!nativeYtInteractive && !ytErrorCode && !playing && (
        <div className="player-center player-center--paused">
          <button onClick={togglePlay} aria-label="Play">
            <Icon name="play" size={48} />
          </button>
        </div>
      )}

      {showUpNext && nextVideo && onPlayNext && (
        <div className="player-up-next">
          <img src={nextVideo.image} alt="" />
          <div>
            <small>
              {autoNextCountdown !== null
                ? `AUTO-PLAYING IN ${autoNextCountdown}S`
                : "UP NEXT"}
            </small>
            <strong>{nextVideo.title}</strong>
            <div className="player-up-next-actions">
              <button className="button button--light" onClick={() => onPlayNext(nextVideo)}>
                <Icon name="play" size={16} /> Play Now
              </button>
              <button
                className="button button--glass"
                onClick={() => {
                  setAutoNextCountdown(null);
                  setUpNextDismissed(true);
                }}
              >
                {autoNextCountdown !== null ? "Cancel" : "Dismiss"}
              </button>
            </div>
          </div>
        </div>
      )}

      {!nativeYtInteractive && (
        <div className="player-controls">
          <div className="player-timeline-row">
            <span className="player-time">{formatSeconds(currentTime)}</span>
            <div className="player-timeline-track">
              <input
                type="range"
                min="0"
                max={duration > 0 ? duration : 100}
                step="0.25"
                value={duration > 0 ? currentTime : progressPercent}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (duration > 0) seekToSeconds(val);
                  else setCurrentTime(val);
                }}
                aria-label="Video progress"
                style={{ "--progress": `${progressPercent}%` } as React.CSSProperties}
              />
              {duration > 0 &&
                chapters.map((ch) => {
                  const leftPct = Math.min(100, Math.max(0, (ch.time / duration) * 100));
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      className="player-timeline-dot"
                      style={{ left: `${leftPct}%` }}
                      title={`${formatSeconds(ch.time)} — ${ch.label}`}
                      aria-label={`Jump to ${ch.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        seekToSeconds(ch.time);
                      }}
                    />
                  );
                })}
            </div>
            <span className="player-time">
              {duration > 0 ? formatSeconds(duration) : video.duration}
            </span>
          </div>
          <div>
            <button onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              <Icon name={playing ? "pause" : "play"} />
            </button>
            <button
              onClick={() => seekToSeconds(currentTime - 10)}
              aria-label="Back 10 seconds"
            >
              <Icon name="rotate" />
              <small>10</small>
            </button>
            <button
              onClick={() => seekToSeconds(currentTime + 10)}
              className="forward"
              aria-label="Forward 10 seconds"
            >
              <Icon name="rotate" />
              <small>10</small>
            </button>
            <div className="player-volume-group">
              <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
                <Icon name={muted || volume === 0 ? "mute" : "volume"} />
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={muted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                aria-label="Volume"
                className="player-volume-slider"
              />
            </div>
            <strong>{video.title}</strong>
            <span />
            {isNativeVideo && onCaptureThumbnail && (
              <button
                aria-label="Set current frame as thumbnail"
                title="Set current frame as thumbnail"
                onClick={handleCapturePlayerFrame}
              >
                <Icon name="camera" size={20} />
              </button>
            )}
            {isNativeVideo && document.pictureInPictureEnabled && (
              <button
                aria-label="Picture in Picture"
                onClick={() => {
                  const el = htmlVideoRef.current;
                  if (!el) return;
                  if (document.pictureInPictureElement) {
                    void document.exitPictureInPicture?.();
                  } else {
                    void el.requestPictureInPicture?.();
                  }
                }}
              >
                <Icon name="pip" size={20} />
              </button>
            )}
            <button className="speed" onClick={cycleSpeed} aria-label="Playback speed">
              {SPEEDS[speedIndex]}×
            </button>
            <button aria-label="Fullscreen" onClick={toggleFullscreen}>
              <Icon name="fullscreen" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
