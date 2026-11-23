import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { createVercelHandler } from "../src/server/apiAdapter.js";
import { requireAuth } from "../src/server/auth.js";
import { getPreferredBlobAccess, hasBlobStorage } from "../src/server/blobStore.js";

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get("content-type") || "";

  // If Vercel Blob is not configured, or if the client sent multipart/form-data directly
  if (!hasBlobStorage() || contentType.includes("multipart/form-data")) {
    const denied = requireAuth(request);
    if (denied) return denied;

    try {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "No file uploaded." }, { status: 400 });
      }

      const ext = path.extname(file.name).slice(1) || "mp4";
      const filename = `${randomUUID()}.${ext}`;
      const uploadDir = path.join(os.tmpdir(), "myflix-uploads");
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(path.join(uploadDir, filename), buffer);

      return Response.json({
        path: `uploads/${filename}`,
        url: `/api/media?path=${encodeURIComponent(`uploads/${filename}`)}`,
      });
    } catch (err) {
      console.error("File upload fallback failed:", err);
      return Response.json(
        { error: err instanceof Error ? err.message : "Failed to upload file." },
        { status: 500 },
      );
    }
  }

  try {
    const body = (await request.json()) as HandleUploadBody;

    // Require Myflix session when generating a browser upload token;
    // Vercel's upload-completed webhook carries a signed Blob header instead of browser cookies.
    if (body?.type !== "blob.upload-completed") {
      const denied = requireAuth(request);
      if (denied) return denied;
    }

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (pathname.includes("..")) {
          throw new Error("Invalid file path.");
        }
        return {
          allowedContentTypes: [
            "video/mp4",
            "video/webm",
            "video/quicktime",
            "video/x-matroska",
            "image/jpeg",
            "image/png",
            "image/webp",
          ],
          addRandomSuffix: true,
          maximumSizeInBytes: 1024 * 1024 * 1024, // 1 GB safety cap
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.info("Blob upload completed:", blob.pathname, getPreferredBlobAccess());
      },
    });

    return Response.json(jsonResponse);
  } catch (error) {
    console.error("POST /api/upload failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload authorization failed." },
      { status: 400 },
    );
  }
}

export default createVercelHandler({ POST });
