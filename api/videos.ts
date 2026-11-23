import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createVercelHandler } from "../src/server/apiAdapter.js";
import { requireAuth } from "../src/server/auth.js";
import {
  deleteBlobAssets,
  hasBlobStorage,
  readBlobCatalog,
  saveBlobThumbnail,
  writeBlobCatalog,
} from "../src/server/blobStore.js";
import {
  applyVideoCreate,
  applyVideoDelete,
  applyVideoPatch,
  normalizeCategories,
  type CreateVideoInput,
  type PatchVideoInput,
} from "../src/server/catalogHelpers.js";
import type { CatalogData } from "../src/types.js";

let memoryCatalog: CatalogData | null = null;
const TMP_CATALOG_FILE = path.join(os.tmpdir(), "myflix-catalog.json");

function readFallbackCatalog(): CatalogData {
  if (memoryCatalog) return memoryCatalog;
  try {
    if (fs.existsSync(TMP_CATALOG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(TMP_CATALOG_FILE, "utf-8")) as Partial<CatalogData>;
      const videos = Array.isArray(parsed.videos) ? parsed.videos : [];
      const categories = normalizeCategories(
        videos,
        Array.isArray(parsed.categories) ? parsed.categories : [],
      );
      memoryCatalog = { videos, categories };
      return memoryCatalog;
    }
  } catch {}
  memoryCatalog = {
    videos: [],
    categories: ["Documentaries", "Workouts", "Screen Recordings"],
  };
  return memoryCatalog;
}

function writeFallbackCatalog(catalog: CatalogData): void {
  memoryCatalog = catalog;
  try {
    fs.writeFileSync(TMP_CATALOG_FILE, JSON.stringify(catalog), "utf-8");
  } catch {}
}

async function getActiveCatalog(): Promise<{
  catalog: CatalogData;
  mode: "blob" | "local";
  access?: "private" | "public";
}> {
  if (hasBlobStorage()) {
    try {
      const { catalog, access } = await readBlobCatalog();
      return { catalog, mode: "blob", access };
    } catch (err) {
      console.warn("Failed reading blob catalog, falling back to local:", err);
    }
  }
  return { catalog: readFallbackCatalog(), mode: "local" };
}

async function saveActiveCatalog(catalog: CatalogData): Promise<void> {
  if (hasBlobStorage()) {
    try {
      await writeBlobCatalog(catalog);
      return;
    } catch (err) {
      console.warn("Failed writing blob catalog, falling back to local:", err);
    }
  }
  writeFallbackCatalog(catalog);
}

export async function GET(request: Request): Promise<Response> {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const { catalog, mode, access } = await getActiveCatalog();
    return Response.json({
      videos: catalog.videos,
      categories: catalog.categories,
      storageMode: mode,
      blobAccess: access ?? "private",
    });
  } catch (error) {
    console.error("GET /api/videos failed:", error);
    return Response.json({ error: "Failed to load video library." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as
      | ({ action: "clear-prototypes" })
      | (CreateVideoInput & { action?: undefined });

    const { catalog, mode } = await getActiveCatalog();

    if ("action" in body && body.action === "clear-prototypes") {
      const videos = catalog.videos.filter((v) => !v.isPrototype);
      const nextCatalog = {
        videos,
        categories: normalizeCategories(videos, catalog.categories),
      };
      await saveActiveCatalog(nextCatalog);
      return Response.json(nextCatalog);
    }

    const input = body as CreateVideoInput;
    if (!input.title?.trim()) {
      return Response.json({ error: "Title is required." }, { status: 400 });
    }

    const id = input.id?.trim() || randomUUID();
    let resolvedThumbnail: { url: string; path?: string } | undefined = undefined;
    if (input.thumbnailDataUrl) {
      if (mode === "blob") {
        resolvedThumbnail = (await saveBlobThumbnail(id, input.thumbnailDataUrl)) ?? undefined;
      } else {
        resolvedThumbnail = { url: input.thumbnailDataUrl };
      }
    }

    const { catalog: nextCatalog, video } = applyVideoCreate(
      catalog,
      { ...input, id },
      resolvedThumbnail,
    );
    await saveActiveCatalog(nextCatalog);

    return Response.json({ video, categories: nextCatalog.categories }, { status: 201 });
  } catch (error) {
    console.error("POST /api/videos failed:", error);
    return Response.json({ error: "Failed to save video." }, { status: 500 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const body = (await request.json()) as PatchVideoInput & { id?: string };
    const id = body.id?.trim();
    if (!id) {
      return Response.json({ error: "Video ID is required." }, { status: 400 });
    }

    const { catalog, mode } = await getActiveCatalog();
    let resolvedThumbnail: { url: string; path?: string } | undefined = undefined;
    if (body.thumbnailDataUrl) {
      if (mode === "blob") {
        resolvedThumbnail = (await saveBlobThumbnail(id, body.thumbnailDataUrl)) ?? undefined;
      } else {
        resolvedThumbnail = { url: body.thumbnailDataUrl };
      }
    }

    const { catalog: nextCatalog, video, removedThumbPath } = applyVideoPatch(
      catalog,
      id,
      body,
      resolvedThumbnail,
    );

    if (!video) {
      return Response.json({ error: "Video not found." }, { status: 404 });
    }

    await saveActiveCatalog(nextCatalog);
    if (removedThumbPath && mode === "blob") {
      await deleteBlobAssets([removedThumbPath]);
    }

    return Response.json({ video, categories: nextCatalog.categories });
  } catch (error) {
    console.error("PATCH /api/videos failed:", error);
    return Response.json({ error: "Failed to update video." }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    let id = url.searchParams.get("id")?.trim();
    if (!id) {
      const body = (await request.json().catch(() => ({}))) as { id?: string };
      id = body.id?.trim();
    }

    if (!id) {
      return Response.json({ error: "Video ID is required." }, { status: 400 });
    }

    const { catalog, mode } = await getActiveCatalog();
    const { catalog: nextCatalog, deleted } = applyVideoDelete(catalog, id);
    if (!deleted) {
      return Response.json({ error: "Video not found." }, { status: 404 });
    }

    await saveActiveCatalog(nextCatalog);
    if (mode === "blob") {
      await deleteBlobAssets([deleted.thumbnailPath, deleted.videoPath]);
    }

    return Response.json({ deletedId: deleted.id, categories: nextCatalog.categories });
  } catch (error) {
    console.error("DELETE /api/videos failed:", error);
    return Response.json({ error: "Failed to delete video." }, { status: 500 });
  }
}

export default createVercelHandler({ GET, POST, PATCH, DELETE });
