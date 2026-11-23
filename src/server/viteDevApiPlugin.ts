import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import type { Plugin } from "vite";
import * as authHandler from "../../api/auth.js";
import * as mediaBlobHandler from "../../api/media.js";
import * as uploadBlobHandler from "../../api/upload.js";
import * as videosBlobHandler from "../../api/videos.js";
import * as ytInfoHandler from "../../api/youtube-info.js";
import { requireAuth } from "./auth.js";
import { hasBlobStorage } from "./blobStore.js";
import {
  applyVideoCreate,
  applyVideoDelete,
  applyVideoPatch,
  normalizeCategories,
  parseDataUrlImage,
  type CreateVideoInput,
  type PatchVideoInput,
} from "./catalogHelpers.js";
import {
  deleteLocalAsset,
  readLocalCatalog,
  resolveSafeLocalMediaPath,
  saveLocalAsset,
  writeLocalCatalog,
} from "./localDevStore.js";

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host || "localhost:8443";
  const url = `http://${host}${req.url || "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const method = req.method || "GET";
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks);
  return new Request(url, { method, headers, body });
}

async function sendWebResponse(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  const setCookies =
    typeof (webRes.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie ===
    "function"
      ? (webRes.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [];

  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") {
      res.setHeader(key, value);
    }
  });
  if (setCookies.length > 0) {
    res.setHeader("Set-Cookie", setCookies);
  }

  if (!webRes.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(
    webRes.body as unknown as import("node:stream/web").ReadableStream,
  );
  await new Promise<void>((resolve, reject) => {
    nodeStream.pipe(res);
    nodeStream.on("end", resolve);
    nodeStream.on("error", reject);
  });
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

async function handleLocalVideos(request: Request): Promise<Response> {
  const denied = requireAuth(request);
  if (denied) return denied;

  const method = request.method.toUpperCase();
  if (method === "GET") {
    const catalog = readLocalCatalog();
    return Response.json({
      videos: catalog.videos,
      categories: catalog.categories,
      storageMode: "local",
    });
  }

  if (method === "POST") {
    const body = (await request.json()) as
      | { action: "clear-prototypes" }
      | (CreateVideoInput & { action?: undefined });
    const catalog = readLocalCatalog();

    if ("action" in body && body.action === "clear-prototypes") {
      const videos = catalog.videos.filter((v) => !v.isPrototype);
      const nextCatalog = {
        videos,
        categories: normalizeCategories(videos, catalog.categories),
      };
      writeLocalCatalog(nextCatalog);
      return Response.json(nextCatalog);
    }

    const input = body as CreateVideoInput;
    if (!input.title?.trim()) {
      return Response.json({ error: "Title is required." }, { status: 400 });
    }

    let resolvedThumbnail: { url: string; path?: string } | undefined;
    if (input.thumbnailDataUrl) {
      const parsed = parseDataUrlImage(input.thumbnailDataUrl);
      if (parsed) {
        resolvedThumbnail = saveLocalAsset("thumbnails", parsed.ext, parsed.buffer);
      }
    }

    const { catalog: nextCatalog, video } = applyVideoCreate(catalog, input, resolvedThumbnail);
    writeLocalCatalog(nextCatalog);
    return Response.json({ video, categories: nextCatalog.categories }, { status: 201 });
  }

  if (method === "PATCH") {
    const body = (await request.json()) as PatchVideoInput & { id?: string };
    const id = body.id?.trim();
    if (!id) {
      return Response.json({ error: "Video ID is required." }, { status: 400 });
    }

    const catalog = readLocalCatalog();
    let resolvedThumbnail: { url: string; path?: string } | undefined;
    if (body.thumbnailDataUrl) {
      const parsed = parseDataUrlImage(body.thumbnailDataUrl);
      if (parsed) {
        resolvedThumbnail = saveLocalAsset("thumbnails", parsed.ext, parsed.buffer);
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

    writeLocalCatalog(nextCatalog);
    if (removedThumbPath) deleteLocalAsset(removedThumbPath);
    return Response.json({ video, categories: nextCatalog.categories });
  }

  if (method === "DELETE") {
    const url = new URL(request.url);
    let id = url.searchParams.get("id")?.trim();
    if (!id) {
      const body = (await request.json().catch(() => ({}))) as { id?: string };
      id = body.id?.trim();
    }
    if (!id) {
      return Response.json({ error: "Video ID is required." }, { status: 400 });
    }

    const catalog = readLocalCatalog();
    const { catalog: nextCatalog, deleted } = applyVideoDelete(catalog, id);
    if (!deleted) {
      return Response.json({ error: "Video not found." }, { status: 404 });
    }

    writeLocalCatalog(nextCatalog);
    deleteLocalAsset(deleted.thumbnailPath);
    deleteLocalAsset(deleted.videoPath);
    return Response.json({ deletedId: deleted.id, categories: nextCatalog.categories });
  }

  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

async function handleLocalUpload(request: Request): Promise<Response> {
  const denied = requireAuth(request);
  if (denied) return denied;
  if (request.method.toUpperCase() !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }

  const ext = path.extname(file.name).slice(1) || "mp4";
  const buffer = Buffer.from(await file.arrayBuffer());
  const saved = saveLocalAsset("uploads", ext, buffer);
  return Response.json(saved);
}

function handleLocalMedia(request: Request, res: ServerResponse): boolean {
  const denied = requireAuth(request);
  if (denied) {
    void sendWebResponse(res, denied);
    return true;
  }

  const url = new URL(request.url);
  const relPath = url.searchParams.get("path")?.trim() ?? "";
  const fullPath = resolveSafeLocalMediaPath(relPath);
  if (!fullPath || !fs.existsSync(fullPath)) {
    void sendWebResponse(res, Response.json({ error: "Media not found." }, { status: 404 }));
    return true;
  }

  const stat = fs.statSync(fullPath);
  const contentType = getContentType(fullPath);
  const range = request.headers.get("range");

  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start >= stat.size || end < start) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${stat.size}`);
        res.end();
        return true;
      }
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", String(end - start + 1));
      res.setHeader("Content-Type", contentType);
      fs.createReadStream(fullPath, { start, end }).pipe(res);
      return true;
    }
  }

  res.statusCode = 200;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Content-Type", contentType);
  fs.createReadStream(fullPath).pipe(res);
  return true;
}

/**
 * Vite dev-only plugin that serves /api/* locally during `vite dev`,
 * delegating to Vercel Blob when configured or falling back to .myflix-data/.
 */
export function myflixDevApiPlugin(): Plugin {
  return {
    name: "myflix-dev-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = (req.url || "").split("?")[0];
        if (!pathname.startsWith("/api/")) return next();

        try {
          const webReq = await toWebRequest(req);
          const method = webReq.method.toUpperCase();
          const useBlob = hasBlobStorage();

          if (pathname === "/api/auth") {
            const fn = (authHandler as Record<string, (r: Request) => Promise<Response>>)[method];
            const response = fn ? await fn(webReq) : Response.json({ error: "Method not allowed" }, { status: 405 });
            await sendWebResponse(res, response);
            return;
          }

          if (pathname === "/api/youtube-info") {
            const response =
              method === "GET"
                ? await ytInfoHandler.GET(webReq)
                : Response.json({ error: "Method not allowed" }, { status: 405 });
            await sendWebResponse(res, response);
            return;
          }

          if (pathname === "/api/videos") {
            if (useBlob) {
              const fn = (videosBlobHandler as Record<string, (r: Request) => Promise<Response>>)[method];
              const response = fn ? await fn(webReq) : Response.json({ error: "Method not allowed" }, { status: 405 });
              await sendWebResponse(res, response);
            } else {
              await sendWebResponse(res, await handleLocalVideos(webReq));
            }
            return;
          }

          if (pathname === "/api/upload") {
            if (useBlob) {
              const response =
                method === "POST"
                  ? await uploadBlobHandler.POST(webReq)
                  : Response.json({ error: "Method not allowed" }, { status: 405 });
              await sendWebResponse(res, response);
            } else {
              await sendWebResponse(res, await handleLocalUpload(webReq));
            }
            return;
          }

          if (pathname === "/api/media") {
            if (useBlob) {
              const response =
                method === "GET"
                  ? await mediaBlobHandler.GET(webReq)
                  : Response.json({ error: "Method not allowed" }, { status: 405 });
              await sendWebResponse(res, response);
            } else {
              handleLocalMedia(webReq, res);
            }
            return;
          }

          next();
        } catch (err) {
          console.error("Dev API middleware error:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "Internal dev server error." }));
          }
        }
      });
    },
  };
}
