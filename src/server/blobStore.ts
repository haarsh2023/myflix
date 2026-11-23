import { del, get, put } from "@vercel/blob";
import type { CatalogData } from "../types.js";
import {
  createSeedCatalog,
  normalizeCategories,
  parseDataUrlImage,
} from "./catalogHelpers.js";

const CATALOG_PATH = "myflix/catalog.json";

export type BlobAccessMode = "private" | "public";

let cachedAccess: BlobAccessMode | null = null;

/**
 * Return true when Vercel Blob credentials are available in the environment.
 */
export function hasBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/**
 * Return the configured or previously detected Vercel Blob store access mode.
 */
export function getPreferredBlobAccess(): BlobAccessMode {
  if (process.env.BLOB_ACCESS === "public") return "public";
  if (process.env.BLOB_ACCESS === "private") return "private";
  return cachedAccess ?? "private";
}

function isAccessMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot use (private|public) access on a (public|private) store/i.test(message);
}

/**
 * Execute a Blob SDK call and automatically adapt if the store's public/private access mode differs.
 */
export async function withDetectedBlobAccess<T>(
  runner: (access: BlobAccessMode) => Promise<T>,
): Promise<{ data: T; access: BlobAccessMode }> {
  const primary = getPreferredBlobAccess();
  try {
    const data = await runner(primary);
    cachedAccess = primary;
    return { data, access: primary };
  } catch (err) {
    if (!isAccessMismatchError(err)) throw err;
    const fallback: BlobAccessMode = primary === "private" ? "public" : "private";
    const data = await runner(fallback);
    cachedAccess = fallback;
    return { data, access: fallback };
  }
}

/**
 * Read catalog JSON from Vercel Blob, returning the seeded starter catalog if none exists yet.
 */
export async function readBlobCatalog(): Promise<{
  catalog: CatalogData;
  access: BlobAccessMode;
}> {
  const { data: result, access } = await withDetectedBlobAccess((mode) =>
    get(CATALOG_PATH, { access: mode, useCache: false }),
  );

  if (!result || result.statusCode !== 200) {
    return { catalog: createSeedCatalog(), access };
  }

  try {
    const raw = await new Response(result.stream).text();
    const parsed = JSON.parse(raw) as Partial<CatalogData>;
    const videos = Array.isArray(parsed.videos) ? parsed.videos : [];
    const categories = normalizeCategories(
      videos,
      Array.isArray(parsed.categories) ? parsed.categories : [],
    );
    return { catalog: { videos, categories }, access };
  } catch (err) {
    console.error("Failed to parse catalog from Vercel Blob:", err);
    return { catalog: createSeedCatalog(), access };
  }
}

/**
 * Overwrite the single catalog JSON blob in Vercel Blob.
 */
export async function writeBlobCatalog(catalog: CatalogData): Promise<BlobAccessMode> {
  const payload = JSON.stringify(catalog);
  const { access } = await withDetectedBlobAccess((mode) =>
    put(CATALOG_PATH, payload, {
      access: mode,
      allowOverwrite: true,
      addRandomSuffix: false,
      contentType: "application/json",
    }),
  );
  return access;
}

/**
 * Upload a captured JPEG/PNG/WEBP thumbnail data URL to Vercel Blob and return a playable URL.
 */
export async function saveBlobThumbnail(
  videoId: string,
  dataUrl: string,
): Promise<{ url: string; path: string } | null> {
  const parsed = parseDataUrlImage(dataUrl);
  if (!parsed) return null;

  const pathname = `thumbnails/${videoId}-${Date.now()}.${parsed.ext}`;
  const { data: blob, access } = await withDetectedBlobAccess((mode) =>
    put(pathname, parsed.buffer, {
      access: mode,
      addRandomSuffix: true,
      contentType: parsed.contentType,
    }),
  );

  return {
    path: blob.pathname,
    url:
      access === "private"
        ? `/api/media?path=${encodeURIComponent(blob.pathname)}`
        : blob.url,
  };
}

/**
 * Fetch a blob asset stream for authenticated private-media proxying.
 */
export async function getBlobAsset(pathname: string, rangeHeader?: string | null) {
  return withDetectedBlobAccess((mode) =>
    get(pathname, {
      access: mode,
      ...(rangeHeader ? { headers: { Range: rangeHeader } } : {}),
    }),
  );
}

/**
 * Best-effort cleanup of stored thumbnail/video blobs when a video is edited or deleted.
 */
export async function deleteBlobAssets(paths: Array<string | undefined>): Promise<void> {
  const valid = paths.filter((p): p is string => Boolean(p && p.trim()));
  if (valid.length === 0) return;

  try {
    await del(valid);
  } catch (err) {
    console.error("Failed to delete Vercel Blob assets:", err);
  }
}
