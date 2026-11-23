import { useEffect, useMemo, useRef, useState } from "react";
import { upload as uploadToVercelBlob } from "@vercel/blob/client";
import { saveLocalVideoBlob } from "../lib/idb";
import {
  extractYouTubeId,
  formatDurationBadge,
  formatSeconds,
  getYouTubeThumbnailPresets,
} from "../lib/youtube";
import type { Video } from "../types";
import { Icon } from "./Icons";

type UploadModalProps = {
  categories: string[];
  storageMode: "blob" | "local";
  blobAccess?: "private" | "public";
  editingVideo?: Video | null;
  initialTab?: "youtube" | "file";
  onClose: () => void;
  onSaved: (video: Video, mode: "create" | "edit") => void;
};

type SourceTab = "youtube" | "file";

/**
 * Compress an image file into a JPEG data URL (max 1280px wide) for lightweight catalog thumbnails.
 */
async function compressImageFileToDataUrl(file: File): Promise<string> {
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode selected image."));
      el.src = bitmapUrl;
    });
    const maxW = 1280;
    const scale = img.naturalWidth > maxW ? maxW / img.naturalWidth : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas context unavailable.");
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

/**
 * Capture the current frame of an HTMLVideoElement as a compressed JPEG data URL.
 */
function captureVideoFrame(videoEl: HTMLVideoElement): string | null {
  if (!videoEl.videoWidth || !videoEl.videoHeight) return null;
  const maxW = 1280;
  const scale = videoEl.videoWidth > maxW ? maxW / videoEl.videoWidth : 1;
  const width = Math.max(1, Math.round(videoEl.videoWidth * scale));
  const height = Math.max(1, Math.round(videoEl.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(videoEl, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export function UploadModal({
  categories,
  storageMode,
  blobAccess = "private",
  editingVideo,
  initialTab = "youtube",
  onClose,
  onSaved,
}: UploadModalProps) {
  const isEdit = Boolean(editingVideo);
  const [sourceTab, setSourceTab] = useState<SourceTab>(
    editingVideo?.sourceType === "video" ? "file" : editingVideo ? "youtube" : initialTab,
  );

  // YouTube state
  const [ytInput, setYtInput] = useState(
    editingVideo?.youtubeId ? `https://youtu.be/${editingVideo.youtubeId}` : "",
  );
  const youtubeId = useMemo(() => extractYouTubeId(ytInput), [ytInput]);
  const [ytChannel, setYtChannel] = useState("");
  const [ytFetching, setYtFetching] = useState(false);
  const [invalidYtPresets, setInvalidYtPresets] = useState<Set<string>>(() => new Set());

  // Direct file / video URL state
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [directVideoUrl, setDirectVideoUrl] = useState(
    editingVideo?.sourceType === "video" ? editingVideo.videoUrl ?? "" : "",
  );
  const [scrubberSrc, setScrubberSrc] = useState<string>("");
  const [scrubberDuration, setScrubberDuration] = useState(0);
  const [scrubberTime, setScrubberTime] = useState(0);
  const [scrubberPlaying, setScrubberPlaying] = useState(false);
  const [scrubberError, setScrubberError] = useState("");
  const [draggingVideo, setDraggingVideo] = useState(false);
  const [sampledFrames, setSampledFrames] = useState<{ time: number; dataUrl: string }[]>([]);
  const scrubberVideoRef = useRef<HTMLVideoElement>(null);

  // Metadata fields
  const [title, setTitle] = useState(editingVideo?.title ?? "");
  const [description, setDescription] = useState(editingVideo?.description ?? "");
  const [selectedCategory, setSelectedCategory] = useState(
    editingVideo?.category ?? categories[0] ?? "Documentaries",
  );
  const [customCategory, setCustomCategory] = useState("");
  const [tagsInput, setTagsInput] = useState(editingVideo?.tags.join(", ") ?? "");
  const [year, setYear] = useState(String(editingVideo?.year ?? new Date().getFullYear()));
  const [addToMyList, setAddToMyList] = useState(Boolean(editingVideo?.added));
  const [pinned, setPinned] = useState(Boolean(editingVideo?.pinned));

  // Thumbnail state: either external URL (e.g. YouTube frame) or captured/uploaded data URL
  const [thumbnailUrl, setThumbnailUrl] = useState(editingVideo?.image ?? "");
  const [capturedDataUrl, setCapturedDataUrl] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");

  const thumbInputRef = useRef<HTMLInputElement>(null);
  const localFrameFileRef = useRef<HTMLInputElement>(null);
  const directVideoFileRef = useRef<HTMLInputElement>(null);

  const ytPresets = useMemo(
    () => (youtubeId ? getYouTubeThumbnailPresets(youtubeId) : []),
    [youtubeId],
  );

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, submitting]);

  // Reset invalid presets & fetch YouTube title when youtubeId changes
  useEffect(() => {
    setInvalidYtPresets(new Set());
    if (!youtubeId || isEdit) return;

    setThumbnailUrl((prev) =>
      prev && !prev.includes("i.ytimg.com")
        ? prev
        : `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`,
    );

    let cancelled = false;
    setYtFetching(true);
    fetch(`/api/youtube-info?id=${encodeURIComponent(youtubeId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { title?: string; author?: string } | null) => {
        if (cancelled || !data) return;
        if (data.title) {
          setTitle((prev) => (prev.trim() ? prev : data.title!));
        }
        if (data.author) {
          setYtChannel(data.author);
        }
      })
      .catch(() => {
        // Ignore metadata fetch errors; user can type title manually.
      })
      .finally(() => {
        if (!cancelled) setYtFetching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [youtubeId, isEdit]);

  // Manage object URL lifecycle for local video frame scrubber
  useEffect(() => {
    if (!selectedVideoFile) return;
    const objectUrl = URL.createObjectURL(selectedVideoFile);
    setScrubberSrc(objectUrl);
    setScrubberError("");
    if (!title.trim() && !isEdit) {
      const baseName = selectedVideoFile.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      setTitle(baseName);
    }
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVideoFile]);

  // Auto-sample 3 thumbnail frame candidates when scrubbing a local video file
  useEffect(() => {
    if (!scrubberSrc.startsWith("blob:")) {
      setSampledFrames([]);
      return;
    }

    let cancelled = false;
    const probe = document.createElement("video");
    probe.src = scrubberSrc;
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = "auto";

    const runSampling = async () => {
      await new Promise<void>((resolve) => {
        if (probe.readyState >= 1) return resolve();
        probe.addEventListener("loadedmetadata", () => resolve(), { once: true });
        probe.addEventListener("error", () => resolve(), { once: true });
      });
      if (cancelled || !Number.isFinite(probe.duration) || probe.duration <= 0) return;

      const ratios = [0.15, 0.45, 0.8];
      const frames: { time: number; dataUrl: string }[] = [];
      for (const ratio of ratios) {
        if (cancelled) return;
        const target = Math.max(0.1, Math.min(probe.duration - 0.1, probe.duration * ratio));
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 1500);
          probe.addEventListener(
            "seeked",
            () => {
              window.clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          probe.currentTime = target;
        });
        if (cancelled) return;
        const shot = captureVideoFrame(probe);
        if (shot) frames.push({ time: target, dataUrl: shot });
      }

      if (!cancelled && frames.length > 0) {
        setSampledFrames(frames);
        setCapturedDataUrl((prev) => prev || frames[0].dataUrl);
        setThumbnailUrl((prev) => prev || frames[0].dataUrl);
      }
    };

    void runSampling();
    return () => {
      cancelled = true;
      probe.removeAttribute("src");
      probe.load();
    };
  }, [scrubberSrc]);

  // Also load scrubber if user pastes a direct video URL in File/URL tab
  useEffect(() => {
    if (sourceTab !== "file" || selectedVideoFile) return;
    const trimmed = directVideoUrl.trim();
    if (/^https?:\/\/.+/i.test(trimmed) || trimmed.startsWith("/api/media")) {
      setScrubberSrc(trimmed);
      setScrubberError("");
    } else if (!trimmed) {
      setScrubberSrc("");
    }
  }, [directVideoUrl, selectedVideoFile, sourceTab]);

  const handleCaptureScrubberFrame = () => {
    const el = scrubberVideoRef.current;
    if (!el) return;
    try {
      const dataUrl = captureVideoFrame(el);
      if (!dataUrl) {
        setError("Video frame is not ready yet. Scrub or wait a moment and try again.");
        return;
      }
      setCapturedDataUrl(dataUrl);
      setThumbnailUrl(dataUrl);
      setError("");
    } catch {
      setError(
        "Browser security prevented capturing a frame from that remote URL. Upload a custom image instead.",
      );
    }
  };

  const handleCustomImagePick = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setCapturedDataUrl(dataUrl);
      setThumbnailUrl(dataUrl);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load thumbnail image.");
    }
  };

  const uploadLocalFileToServer = (file: File): Promise<{ url: string; path: string }> =>
    new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload");
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          setUploadProgress(Math.round((event.loaded / event.total) * 100));
        }
      };
      xhr.onload = () => {
        try {
          const parsed = JSON.parse(xhr.responseText) as {
            url?: string;
            path?: string;
            error?: string;
          };
          if (xhr.status >= 200 && xhr.status < 300 && parsed.url && parsed.path) {
            resolve({ url: parsed.url, path: parsed.path });
          } else {
            reject(new Error(parsed.error || "Failed to upload video file."));
          }
        } catch {
          reject(new Error("Unexpected response from upload endpoint."));
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.send(form);
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const finalCategory =
      selectedCategory === "__custom__" ? customCategory.trim() : selectedCategory.trim();
    if (!title.trim()) {
      setError("Please enter a title for your video.");
      return;
    }
    if (!finalCategory) {
      setError("Please select or enter a category.");
      return;
    }

    if (!isEdit) {
      if (sourceTab === "youtube" && !youtubeId) {
        setError("Please paste a valid YouTube link or 11-character video ID.");
        return;
      }
      if (sourceTab === "file" && !selectedVideoFile && !directVideoUrl.trim()) {
        setError("Please choose a video file or paste a direct video URL.");
        return;
      }
    }

    setSubmitting(true);
    setError("");

    try {
      // Auto-capture a thumbnail frame if uploading/linking a direct video and no thumbnail was picked
      let finalCapturedDataUrl = capturedDataUrl;
      let finalThumbUrl = thumbnailUrl;
      if (
        !finalCapturedDataUrl &&
        !finalThumbUrl &&
        sourceTab === "file" &&
        scrubberVideoRef.current
      ) {
        try {
          const autoFrame = captureVideoFrame(scrubberVideoRef.current);
          if (autoFrame) {
            finalCapturedDataUrl = autoFrame;
            finalThumbUrl = autoFrame;
          }
        } catch {
          // Cross-origin URLs may disallow canvas capture; ignore silently.
        }
      }

      if (isEdit && editingVideo) {
        const res = await fetch("/api/videos", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editingVideo.id,
            title: title.trim(),
            description: description.trim(),
            category: finalCategory,
            tags: tagsInput,
            year: Number(year) || new Date().getFullYear(),
            added: addToMyList,
            pinned,
            ...(finalCapturedDataUrl
              ? { thumbnailDataUrl: finalCapturedDataUrl }
              : finalThumbUrl && finalThumbUrl !== editingVideo.image
                ? { image: finalThumbUrl }
                : {}),
          }),
        });
        const data = (await res.json()) as { video?: Video; error?: string };
        if (!res.ok || !data.video) {
          throw new Error(data.error || "Could not update video.");
        }
        onSaved(data.video, "edit");
        onClose();
        return;
      }

      let uploadedVideoUrl = directVideoUrl.trim();
      let uploadedVideoPath: string | undefined;
      let pendingLocalVideoId: string | undefined;

      if (sourceTab === "file" && selectedVideoFile) {
        const safeName = selectedVideoFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        if (storageMode === "blob") {
          try {
            setUploadProgress(0);
            const blob = await uploadToVercelBlob(
              `videos/${Date.now()}-${safeName}`,
              selectedVideoFile,
              {
                access: blobAccess,
                handleUploadUrl: "/api/upload",
                onUploadProgress: (progressEvent) => {
                  setUploadProgress(Math.round(progressEvent.percentage));
                },
              },
            );
            uploadedVideoPath = blob.pathname;
            uploadedVideoUrl =
              blobAccess === "private"
                ? `/api/media?path=${encodeURIComponent(blob.pathname)}`
                : blob.url;
          } catch (blobErr) {
            console.warn("Blob upload failed or not configured, saving to local device storage:", blobErr);
            pendingLocalVideoId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            setUploadProgress(50);
            await saveLocalVideoBlob(pendingLocalVideoId, selectedVideoFile);
            setUploadProgress(100);
            uploadedVideoPath = "local-indexeddb";
            uploadedVideoUrl = `indexeddb://${pendingLocalVideoId}`;
          }
        } else {
          // Device / Local Dev Mode: store in IndexedDB directly on this device
          pendingLocalVideoId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          setUploadProgress(50);
          await saveLocalVideoBlob(pendingLocalVideoId, selectedVideoFile);
          setUploadProgress(100);
          uploadedVideoPath = "local-indexeddb";
          uploadedVideoUrl = `indexeddb://${pendingLocalVideoId}`;
        }
      }

      const durationSecs = scrubberDuration > 0 ? Math.round(scrubberDuration) : undefined;
      const durationBadge = durationSecs ? formatDurationBadge(durationSecs) : "Video";

      const payload = {
        id: pendingLocalVideoId || undefined,
        title: title.trim(),
        description: description.trim(),
        category: finalCategory,
        tags: tagsInput,
        year: Number(year) || new Date().getFullYear(),
        duration: durationBadge,
        durationSeconds: durationSecs,
        sourceType: sourceTab === "youtube" ? "youtube" : "video",
        youtubeId: sourceTab === "youtube" ? youtubeId : undefined,
        videoUrl: sourceTab === "file" ? uploadedVideoUrl : undefined,
        videoPath: sourceTab === "file" ? uploadedVideoPath : undefined,
        thumbnailDataUrl: finalCapturedDataUrl || undefined,
        image:
          !finalCapturedDataUrl && finalThumbUrl
            ? finalThumbUrl
            : sourceTab === "youtube" && youtubeId
              ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
              : undefined,
        added: addToMyList,
        pinned,
      };

      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { video?: Video; error?: string };
      if (!res.ok || !data.video) {
        throw new Error(data.error || "Could not save video.");
      }

      onSaved(data.video, "create");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong while saving.");
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  const activePreviewImage = capturedDataUrl || thumbnailUrl;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      role="presentation"
    >
      <section
        className="upload-modal"
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit video" : "Add video to Myflix"}
      >
        <button
          className="modal-close"
          onClick={() => !submitting && onClose()}
          aria-label="Close modal"
        >
          <Icon name="close" />
        </button>

        <div className="upload-header">
          <span className="eyebrow">
            <span className="mini-logo">M</span> MYFLIX STUDIO
          </span>
          <h2>{isEdit ? "Edit Video Details" : "Add Video to Myflix"}</h2>
          <p>
            {isEdit
              ? "Update title, description, category, or pick a fresh thumbnail frame."
              : "Showcase unlimited Unlisted/Public YouTube videos or upload a video clip directly."}
          </p>
        </div>

        {!isEdit && (
          <div className="source-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === "youtube"}
              className={sourceTab === "youtube" ? "active" : ""}
              onClick={() => setSourceTab("youtube")}
            >
              <Icon name="link" size={16} />
              <span>YouTube Link</span>
              <em>Unlimited Free</em>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceTab === "file"}
              className={sourceTab === "file" ? "active" : ""}
              onClick={() => setSourceTab("file")}
            >
              <Icon name="upload" size={16} />
              <span>Upload Video / Direct URL</span>
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="upload-form">
          {!isEdit && sourceTab === "youtube" && (
            <div className="upload-section">
              <label className="field-label" htmlFor="yt-url-input">
                YouTube Video URL or ID
              </label>
              <div className="yt-input-row">
                <input
                  id="yt-url-input"
                  type="text"
                  value={ytInput}
                  onChange={(e) => setYtInput(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
                  autoFocus
                />
                {ytFetching && <span className="field-status">Fetching info…</span>}
                {!ytFetching && youtubeId && (
                  <span className="field-status field-status--ok">ID: {youtubeId}</span>
                )}
              </div>
              <p className="field-hint">
                In YouTube Studio, set visibility to <strong>Unlisted</strong> (not Private) and
                keep <strong>Allow embedding</strong> enabled so it streams across all your devices.
                {ytChannel ? ` Channel: ${ytChannel}` : ""}
              </p>
            </div>
          )}

          {!isEdit && sourceTab === "file" && (
            <div className="upload-section">
              <label className="field-label">Video File or Direct Stream URL</label>
              <div
                className={`file-dropzone ${draggingVideo ? "file-dropzone--active" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDraggingVideo(true);
                }}
                onDragLeave={() => setDraggingVideo(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDraggingVideo(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file && file.type.startsWith("video/")) {
                    setSelectedVideoFile(file);
                    setError("");
                  } else if (file) {
                    setError("Please drop an MP4, WebM, MOV, or video file.");
                  }
                }}
                onClick={() => directVideoFileRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    directVideoFileRef.current?.click();
                  }
                }}
              >
                <Icon name="film" size={26} />
                <div>
                  <strong>
                    {selectedVideoFile
                      ? selectedVideoFile.name
                      : "Drag & drop a video file here, or click to browse"}
                  </strong>
                  <span>
                    {selectedVideoFile
                      ? `${(selectedVideoFile.size / (1024 * 1024)).toFixed(1)} MB ready`
                      : "Supports MP4, WebM, MOV • frames auto-captured for your thumbnail"}
                  </span>
                </div>
              </div>
              <div className="file-url-row">
                <input
                  ref={directVideoFileRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setSelectedVideoFile(file);
                  }}
                />
                <input
                  type="url"
                  value={directVideoUrl}
                  onChange={(e) => {
                    setSelectedVideoFile(null);
                    setDirectVideoUrl(e.target.value);
                  }}
                  placeholder="Or paste direct .mp4 / .webm URL"
                  aria-label="Direct video URL"
                />
              </div>
            </div>
          )}

          {/* Thumbnail & Frame Selector Section */}
          <div className="upload-section">
            <div className="thumb-header-row">
              <label className="field-label">Select Thumbnail Frame</label>
              <div className="thumb-tool-buttons">
                <button
                  type="button"
                  className="mini-action-btn"
                  onClick={() => localFrameFileRef.current?.click()}
                >
                  <Icon name="camera" size={15} />
                  <span>Scrub Local Video Frame</span>
                </button>
                <button
                  type="button"
                  className="mini-action-btn"
                  onClick={() => thumbInputRef.current?.click()}
                >
                  <Icon name="upload" size={15} />
                  <span>Upload Image</span>
                </button>
                <input
                  ref={localFrameFileRef}
                  type="file"
                  accept="video/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const url = URL.createObjectURL(file);
                      setScrubberSrc(url);
                      setScrubberError("");
                    }
                  }}
                />
                <input
                  ref={thumbInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={(e) => {
                    void handleCustomImagePick(e.target.files?.[0]);
                  }}
                />
              </div>
            </div>

            {youtubeId && (sourceTab === "youtube" || editingVideo?.sourceType === "youtube") && (
              <div className="yt-frame-grid">
                {ytPresets.map((preset) => {
                  if (invalidYtPresets.has(preset.url)) return null;
                  const isSelected = !capturedDataUrl && thumbnailUrl === preset.url;
                  return (
                    <button
                      type="button"
                      key={preset.url}
                      className={`yt-frame-option ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        setCapturedDataUrl("");
                        setThumbnailUrl(preset.url);
                      }}
                    >
                      <img
                        src={preset.url}
                        alt={preset.label}
                        onLoad={(e) => {
                          if (
                            preset.url.includes("maxresdefault") &&
                            e.currentTarget.naturalWidth <= 120
                          ) {
                            setInvalidYtPresets((prev) => new Set(prev).add(preset.url));
                            setThumbnailUrl((prev) =>
                              prev === preset.url
                                ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
                                : prev,
                            );
                          }
                        }}
                        onError={() => {
                          setInvalidYtPresets((prev) => new Set(prev).add(preset.url));
                          setThumbnailUrl((prev) =>
                            prev === preset.url
                              ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
                              : prev,
                          );
                        }}
                      />
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {sampledFrames.length > 0 && (
              <div className="sampled-frames-strip">
                {sampledFrames.map((frame, idx) => (
                  <button
                    type="button"
                    key={`${frame.time}-${idx}`}
                    className={`yt-frame-option ${capturedDataUrl === frame.dataUrl ? "selected" : ""}`}
                    onClick={() => {
                      setCapturedDataUrl(frame.dataUrl);
                      setThumbnailUrl(frame.dataUrl);
                      if (scrubberVideoRef.current) {
                        scrubberVideoRef.current.currentTime = frame.time;
                        setScrubberTime(frame.time);
                      }
                    }}
                  >
                    <img src={frame.dataUrl} alt={`Frame at ${formatSeconds(frame.time)}`} />
                    <span>Frame @ {formatSeconds(frame.time)}</span>
                  </button>
                ))}
              </div>
            )}

            {scrubberSrc && (
              <div className="frame-scrubber">
                <video
                  ref={scrubberVideoRef}
                  src={scrubberSrc}
                  crossOrigin="anonymous"
                  muted
                  playsInline
                  preload="metadata"
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget;
                    if (Number.isFinite(v.duration) && v.duration > 0) {
                      setScrubberDuration(v.duration);
                      const target = Math.min(v.duration * 0.15, v.duration);
                      v.currentTime = target;
                      setScrubberTime(target);
                    }
                  }}
                  onTimeUpdate={(e) => setScrubberTime(e.currentTarget.currentTime)}
                  onError={() =>
                    setScrubberError(
                      "Could not preview this URL directly in browser. You can still upload a custom image.",
                    )
                  }
                />
                {scrubberError ? (
                  <p className="field-hint">{scrubberError}</p>
                ) : (
                  <div className="scrubber-controls">
                    <button
                      type="button"
                      className="mini-action-btn"
                      onClick={() => {
                        const v = scrubberVideoRef.current;
                        if (!v) return;
                        if (v.paused) {
                          void v.play();
                          setScrubberPlaying(true);
                        } else {
                          v.pause();
                          setScrubberPlaying(false);
                        }
                      }}
                    >
                      <Icon name={scrubberPlaying ? "pause" : "play"} size={14} />
                    </button>
                    <input
                      type="range"
                      min="0"
                      max={scrubberDuration || 100}
                      step="0.1"
                      value={scrubberTime}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setScrubberTime(next);
                        if (scrubberVideoRef.current) {
                          scrubberVideoRef.current.currentTime = next;
                        }
                      }}
                      aria-label="Scrub video frame"
                    />
                    <span className="scrubber-time">
                      {formatSeconds(scrubberTime)} / {formatSeconds(scrubberDuration)}
                    </span>
                    {scrubberDuration > 0 && (
                      <div className="scrubber-jumps">
                        {[0.15, 0.5, 0.85].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            className="scrubber-jump-pill"
                            onClick={() => {
                              const next = scrubberDuration * pct;
                              setScrubberTime(next);
                              if (scrubberVideoRef.current) {
                                scrubberVideoRef.current.currentTime = next;
                              }
                            }}
                          >
                            {Math.round(pct * 100)}%
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      className="button button--light scrubber-capture-btn"
                      onClick={handleCaptureScrubberFrame}
                    >
                      <Icon name="camera" size={16} />
                      <span>Use Frame</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {activePreviewImage && (
              <div className="selected-thumb-preview">
                <img src={activePreviewImage} alt="Selected video thumbnail preview" />
                <div>
                  <strong>Selected Thumbnail</strong>
                  <span>
                    {capturedDataUrl
                      ? "Custom captured frame / uploaded image"
                      : "YouTube frame preview"}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="upload-grid">
            <div className="upload-field upload-field--full">
              <label className="field-label" htmlFor="video-title-input">
                Title
              </label>
              <input
                id="video-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Ladakh Solo Ride 2026"
                required
              />
            </div>

            <div className="upload-field upload-field--full">
              <label className="field-label" htmlFor="video-desc-input">
                Short Description
              </label>
              <textarea
                id="video-desc-input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Write a brief summary of what happens in this video..."
              />
            </div>

            <div className="upload-field">
              <label className="field-label" htmlFor="video-cat-select">
                Category
              </label>
              <select
                id="video-cat-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                <option value="__custom__">+ New custom category…</option>
              </select>
              {selectedCategory === "__custom__" && (
                <input
                  type="text"
                  className="custom-category-input"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  placeholder="Enter new category name"
                  autoFocus
                />
              )}
            </div>

            <div className="upload-field">
              <label className="field-label" htmlFor="video-year-input">
                Year
              </label>
              <input
                id="video-year-input"
                type="number"
                min="1980"
                max="2100"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>

            <div className="upload-field upload-field--full">
              <label className="field-label" htmlFor="video-tags-input">
                Tags (comma separated)
              </label>
              <input
                id="video-tags-input"
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="Travel, Behind the Scenes, Personal"
              />
            </div>
          </div>

          <div className="checkbox-group-row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={addToMyList}
                onChange={(e) => setAddToMyList(e.target.checked)}
              />
              <span>Add directly to My List</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              <span>Pin to Home Hero Spotlight ★</span>
            </label>
          </div>

          {uploadProgress !== null && (
            <div className="upload-progress-bar">
              <div style={{ width: `${uploadProgress}%` }} />
              <span>Uploading video… {uploadProgress}%</span>
            </div>
          )}

          {error && <p className="upload-error">{error}</p>}

          <div className="upload-actions">
            <button
              type="button"
              className="button button--glass"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="button button--red" disabled={submitting}>
              {submitting
                ? uploadProgress !== null
                  ? `Uploading (${uploadProgress}%)…`
                  : "Saving…"
                : isEdit
                  ? "Save Changes"
                  : "Publish to Myflix"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
