import { randomUUID } from "node:crypto";
import {
  DEFAULT_CATEGORIES,
  type CatalogData,
  type Video,
  type VideoChapter,
  type VideoSourceType,
} from "../types.js";

export type CreateVideoInput = {
  id?: string;
  title: string;
  category: string;
  year?: number;
  duration?: string;
  durationSeconds?: number;
  match?: number;
  description?: string;
  image?: string;
  thumbnailDataUrl?: string;
  thumbnailPath?: string;
  tags?: string[] | string;
  sourceType: VideoSourceType;
  youtubeId?: string;
  videoUrl?: string;
  videoPath?: string;
  added?: boolean;
  pinned?: boolean;
  chapters?: VideoChapter[];
};

export type PatchVideoInput = {
  title?: string;
  category?: string;
  year?: number;
  duration?: string;
  durationSeconds?: number;
  description?: string;
  image?: string;
  thumbnailDataUrl?: string;
  thumbnailPath?: string;
  tags?: string[] | string;
  added?: boolean;
  liked?: boolean;
  pinned?: boolean;
  chapters?: VideoChapter[] | null;
  progress?: number | null;
  progressSeconds?: number | null;
};

/**
 * Build an empty starter catalog with default categories so users upload from the beginning.
 */
export function createSeedCatalog(): CatalogData {
  return {
    videos: [],
    categories: [...DEFAULT_CATEGORIES],
  };
}

/**
 * Merge default categories, persisted categories, and categories present on videos without duplicates.
 */
export function normalizeCategories(videos: Video[], storedCategories: string[] = []): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const cat of [...DEFAULT_CATEGORIES, ...storedCategories, ...videos.map((v) => v.category)]) {
    const clean = cat.trim();
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    ordered.push(clean);
  }
  return ordered;
}

/**
 * Normalize tags from an array or comma-separated string.
 */
export function sanitizeTags(tags: unknown, fallbackCategory: string): string[] {
  const rawList = Array.isArray(tags)
    ? tags.map((t) => String(t))
    : typeof tags === "string"
      ? tags.split(",")
      : [];

  const cleaned = Array.from(
    new Set(rawList.map((t) => t.trim()).filter(Boolean)),
  ).slice(0, 6);

  return cleaned.length > 0 ? cleaned : [fallbackCategory, "Personal"];
}

/**
 * Normalize timestamped chapter bookmarks sorted chronologically.
 */
export function sanitizeChapters(chapters: unknown): VideoChapter[] {
  if (!Array.isArray(chapters)) return [];
  const valid: VideoChapter[] = [];
  const seenIds = new Set<string>();

  for (const item of chapters) {
    if (!item || typeof item !== "object") continue;
    const raw = item as { id?: unknown; time?: unknown; label?: unknown };
    const time = Number(raw.time);
    if (!Number.isFinite(time) || time < 0) continue;
    const label = String(raw.label ?? "").trim().slice(0, 80);
    if (!label) continue;
    const id = String(raw.id ?? "").trim() || randomUUID();
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    valid.push({ id, time: Math.floor(time), label });
  }

  return valid.sort((a, b) => a.time - b.time).slice(0, 30);
}

/**
 * Parse a compressed thumbnail data URL (JPEG/PNG/WEBP, max 2 MB) into a Buffer.
 */
export function parseDataUrlImage(
  dataUrl: string,
): { buffer: Buffer; contentType: string; ext: string } | null {
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;

  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > 2 * 1024 * 1024) {
    return null;
  }
  return { buffer, contentType, ext };
}

/**
 * Create and prepend a new Video entry into the catalog.
 */
export function applyVideoCreate(
  catalog: CatalogData,
  input: CreateVideoInput,
  resolvedThumbnail?: { url: string; path?: string },
): { catalog: CatalogData; video: Video } {
  const id = input.id?.trim() || randomUUID();
  const category = input.category.trim() || DEFAULT_CATEGORIES[0];
  const fallbackThumb = input.youtubeId
    ? `https://i.ytimg.com/vi/${input.youtubeId}/hqdefault.jpg`
    : "";

  const video: Video = {
    id,
    title: input.title.trim(),
    category,
    year:
      typeof input.year === "number" && input.year >= 1900 && input.year <= 2100
        ? input.year
        : new Date().getFullYear(),
    duration: input.duration?.trim() || "Video",
    durationSeconds: input.durationSeconds,
    match: typeof input.match === "number" ? input.match : 98,
    description:
      input.description?.trim() ||
      "Uploaded to your private Myflix library.",
    image: resolvedThumbnail?.url || input.image?.trim() || fallbackThumb,
    thumbnailPath: resolvedThumbnail?.path ?? input.thumbnailPath,
    tags: sanitizeTags(input.tags, category),
    sourceType: input.sourceType,
    youtubeId: input.youtubeId,
    videoUrl: input.videoUrl,
    videoPath: input.videoPath,
    added: Boolean(input.added),
    liked: false,
    pinned: Boolean(input.pinned),
    ...(input.chapters ? { chapters: sanitizeChapters(input.chapters) } : {}),
    createdAt: new Date().toISOString(),
    isPrototype: false,
  };

  const videos = [video, ...catalog.videos];
  return {
    video,
    catalog: {
      videos,
      categories: normalizeCategories(videos, [...catalog.categories, category]),
    },
  };
}

/**
 * Update metadata, My List / Like toggles, or watch progress for an existing video.
 */
export function applyVideoPatch(
  catalog: CatalogData,
  id: string,
  patch: PatchVideoInput,
  resolvedThumbnail?: { url: string; path?: string },
): { catalog: CatalogData; video: Video | null; removedThumbPath?: string } {
  const index = catalog.videos.findIndex((v) => v.id === id);
  if (index === -1) {
    return { catalog, video: null };
  }

  const current = catalog.videos[index];
  let removedThumbPath: string | undefined;

  const updated: Video = { ...current };
  if (typeof patch.title === "string" && patch.title.trim()) {
    updated.title = patch.title.trim();
  }
  if (typeof patch.category === "string" && patch.category.trim()) {
    updated.category = patch.category.trim();
  }
  if (typeof patch.description === "string") {
    updated.description = patch.description.trim();
  }
  if (typeof patch.year === "number" && patch.year >= 1900 && patch.year <= 2100) {
    updated.year = patch.year;
  }
  if (typeof patch.duration === "string" && patch.duration.trim()) {
    updated.duration = patch.duration.trim();
  }
  if (typeof patch.durationSeconds === "number" && patch.durationSeconds > 0) {
    updated.durationSeconds = patch.durationSeconds;
  }
  if (patch.tags !== undefined) {
    updated.tags = sanitizeTags(patch.tags, updated.category);
  }
  if (typeof patch.added === "boolean") {
    updated.added = patch.added;
  }
  if (typeof patch.liked === "boolean") {
    updated.liked = patch.liked;
  }
  if (typeof patch.pinned === "boolean") {
    updated.pinned = patch.pinned;
  }
  if (patch.chapters === null) {
    delete updated.chapters;
  } else if (patch.chapters !== undefined) {
    const cleaned = sanitizeChapters(patch.chapters);
    if (cleaned.length > 0) updated.chapters = cleaned;
    else delete updated.chapters;
  }
  if (patch.progress === null) {
    delete updated.progress;
    delete updated.progressSeconds;
  } else if (typeof patch.progress === "number") {
    updated.progress = Math.max(0, Math.min(100, Math.round(patch.progress)));
  }
  if (typeof patch.progressSeconds === "number") {
    updated.progressSeconds = Math.max(0, Math.floor(patch.progressSeconds));
  }

  if (resolvedThumbnail) {
    if (current.thumbnailPath && current.thumbnailPath !== resolvedThumbnail.path) {
      removedThumbPath = current.thumbnailPath;
    }
    updated.image = resolvedThumbnail.url;
    updated.thumbnailPath = resolvedThumbnail.path;
  } else if (typeof patch.image === "string" && patch.image.trim()) {
    if (current.thumbnailPath && patch.image.trim() !== current.image) {
      removedThumbPath = current.thumbnailPath;
      delete updated.thumbnailPath;
    }
    updated.image = patch.image.trim();
  }

  const videos = catalog.videos.slice();
  videos[index] = updated;

  return {
    video: updated,
    removedThumbPath,
    catalog: {
      videos,
      categories: normalizeCategories(videos, catalog.categories),
    },
  };
}

/**
 * Remove a video by ID from the catalog and return the deleted record for asset cleanup.
 */
export function applyVideoDelete(
  catalog: CatalogData,
  id: string,
): { catalog: CatalogData; deleted: Video | null } {
  const deleted = catalog.videos.find((v) => v.id === id) ?? null;
  if (!deleted) return { catalog, deleted: null };

  const videos = catalog.videos.filter((v) => v.id !== id);
  return {
    deleted,
    catalog: {
      videos,
      categories: normalizeCategories(videos, catalog.categories),
    },
  };
}
