import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createVercelHandler } from "../src/server/apiAdapter.js";
import { requireAuth } from "../src/server/auth.js";
import { getBlobAsset, hasBlobStorage } from "../src/server/blobStore.js";

function isSafeMediaPath(value: string): boolean {
  const cleaned = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.includes("..")) return false;
  return /^(thumbnails|videos|uploads)\/[^/\\]+$/.test(cleaned);
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

export async function GET(request: Request): Promise<Response> {
  const denied = requireAuth(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const pathname = url.searchParams.get("path")?.trim() ?? "";
  if (!pathname || !isSafeMediaPath(pathname)) {
    return Response.json({ error: "Invalid media path." }, { status: 400 });
  }

  // 1. If Blob storage is configured, try fetching from Blob
  if (hasBlobStorage()) {
    try {
      const range = request.headers.get("range");
      const { data: result } = await getBlobAsset(pathname, range);
      if (result && (result.statusCode === 200 || (result.statusCode as number) === 206)) {
        const contentRange = result.headers.get("content-range");
        const contentLength = result.headers.get("content-length");
        const acceptRanges = result.headers.get("accept-ranges") || "bytes";

        const headers: Record<string, string> = {
          "Content-Type": result.blob.contentType || "application/octet-stream",
          "Accept-Ranges": acceptRanges,
          "Cache-Control": "private, max-age=3600",
        };
        if (contentRange) headers["Content-Range"] = contentRange;
        if (contentLength) headers["Content-Length"] = contentLength;

        return new Response(result.stream, {
          status: contentRange ? 206 : 200,
          headers,
        });
      }
    } catch (err) {
      console.warn("Blob media fetch missed, checking local fallback:", err);
    }
  }

  // 2. Local fallback storage (/tmp/myflix-uploads or .myflix-data)
  const localCandidates = [
    path.join(os.tmpdir(), "myflix-uploads", path.basename(pathname)),
    path.resolve(process.cwd(), ".myflix-data", pathname),
  ];

  for (const localFile of localCandidates) {
    if (fs.existsSync(localFile)) {
      try {
        const stat = fs.statSync(localFile);
        const totalSize = stat.size;
        const mime = getContentType(localFile);
        const range = request.headers.get("range");

        if (range) {
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
          const chunkSize = end - start + 1;
          const stream = fs.createReadStream(localFile, { start, end });
          const webStream = Readable.toWeb(stream) as unknown as ReadableStream;

          return new Response(webStream, {
            status: 206,
            headers: {
              "Content-Range": `bytes ${start}-${end}/${totalSize}`,
              "Accept-Ranges": "bytes",
              "Content-Length": String(chunkSize),
              "Content-Type": mime,
              "Cache-Control": "private, max-age=3600",
            },
          });
        }

        const stream = fs.createReadStream(localFile);
        const webStream = Readable.toWeb(stream) as unknown as ReadableStream;
        return new Response(webStream, {
          status: 200,
          headers: {
            "Content-Length": String(totalSize),
            "Content-Type": mime,
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, max-age=3600",
          },
        });
      } catch (err) {
        console.error("Local media read failed:", err);
      }
    }
  }

  return Response.json({ error: "Media not found." }, { status: 404 });
}

export default createVercelHandler({ GET });
