import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CatalogData } from "../types.js";
import { createSeedCatalog, normalizeCategories } from "./catalogHelpers.js";

const DATA_DIR = path.resolve(process.cwd(), ".myflix-data");
const CATALOG_FILE = path.join(DATA_DIR, "catalog.json");

function ensureDirs() {
  fs.mkdirSync(path.join(DATA_DIR, "thumbnails"), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });
}

/**
 * Read the local development catalog JSON, initializing with seed videos on first access.
 */
export function readLocalCatalog(): CatalogData {
  ensureDirs();
  if (!fs.existsSync(CATALOG_FILE)) {
    const seed = createSeedCatalog();
    fs.writeFileSync(CATALOG_FILE, JSON.stringify(seed, null, 2), "utf8");
    return seed;
  }

  try {
    const raw = fs.readFileSync(CATALOG_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<CatalogData>;
    const videos = Array.isArray(parsed.videos) ? parsed.videos : [];
    const categories = normalizeCategories(
      videos,
      Array.isArray(parsed.categories) ? parsed.categories : [],
    );
    return { videos, categories };
  } catch {
    return createSeedCatalog();
  }
}

/**
 * Persist the local development catalog JSON to .myflix-data/catalog.json.
 */
export function writeLocalCatalog(catalog: CatalogData): void {
  ensureDirs();
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf8");
}

/**
 * Save a binary asset (thumbnail or uploaded video) under .myflix-data/ and return its /api/media path.
 */
export function saveLocalAsset(
  folder: "thumbnails" | "uploads",
  ext: string,
  buffer: Buffer,
): { path: string; url: string } {
  ensureDirs();
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const filename = `${randomUUID()}.${safeExt}`;
  const relPath = `${folder}/${filename}`;
  fs.writeFileSync(path.join(DATA_DIR, relPath), buffer);
  return {
    path: relPath,
    url: `/api/media?path=${encodeURIComponent(relPath)}`,
  };
}

/**
 * Delete a locally stored asset if it exists inside .myflix-data/.
 */
export function deleteLocalAsset(relPath: string | undefined): void {
  if (!relPath) return;
  const resolved = resolveSafeLocalMediaPath(relPath);
  if (resolved && fs.existsSync(resolved)) {
    fs.unlinkSync(resolved);
  }
}

/**
 * Resolve a media relative path safely inside .myflix-data/, preventing path traversal.
 */
export function resolveSafeLocalMediaPath(relPath: string): string | null {
  const cleaned = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.includes("..") || !/^(thumbnails|uploads)\/[^/\\]+$/.test(cleaned)) {
    return null;
  }
  const fullPath = path.resolve(DATA_DIR, cleaned);
  if (!fullPath.startsWith(DATA_DIR + path.sep)) {
    return null;
  }
  return fullPath;
}
