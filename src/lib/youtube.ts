/**
 * Extract an 11-character YouTube video ID from common watch, share, embed, live, or shorts URLs.
 */
export function extractYouTubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();

    if (host === "youtu.be") {
      const candidate = url.pathname.split("/").filter(Boolean)[0];
      return candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
    }

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      const v = url.searchParams.get("v");
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const segments = url.pathname.split("/").filter(Boolean);
      const markerIndex = segments.findIndex((s) =>
        ["embed", "shorts", "live", "v"].includes(s.toLowerCase()),
      );
      if (markerIndex !== -1) {
        const candidate = segments[markerIndex + 1];
        if (candidate && /^[a-zA-Z0-9_-]{11}$/.test(candidate)) return candidate;
      }
    }
  } catch {
    // Fall through to regex extraction for partial strings.
  }

  const fallback = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/,
  );
  return fallback?.[1] ?? null;
}

export type ThumbnailPreset = {
  label: string;
  url: string;
};

/**
 * Return YouTube's built-in cover and auto-extracted video frame URLs for a video ID.
 */
export function getYouTubeThumbnailPresets(videoId: string): ThumbnailPreset[] {
  return [
    { label: "Max Resolution (HD)", url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` },
    { label: "High Quality (SD)", url: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` },
    { label: "Frame 1 (Start)", url: `https://i.ytimg.com/vi/${videoId}/1.jpg` },
    { label: "Frame 2 (Middle)", url: `https://i.ytimg.com/vi/${videoId}/2.jpg` },
    { label: "Frame 3 (End)", url: `https://i.ytimg.com/vi/${videoId}/3.jpg` },
  ];
}

/**
 * Format seconds as MM:SS or H:MM:SS for player timelines and duration badges.
 */
export function formatSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const rounded = Math.floor(totalSeconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Format a duration in seconds as a compact catalog label like "14m" or "1h 12m" or "4:32".
 */
export function formatDurationBadge(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "Video";
  const mins = Math.floor(totalSeconds / 60);
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  }
  if (mins >= 1) return `${mins}m`;
  return formatSeconds(totalSeconds);
}
