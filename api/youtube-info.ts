import { createVercelHandler } from "../src/server/apiAdapter.js";
import { requireAuth } from "../src/server/auth.js";

export async function GET(request: Request): Promise<Response> {
  const denied = requireAuth(request);
  if (denied) return denied;

  try {
    const url = new URL(request.url);
    const videoId = url.searchParams.get("id")?.trim() ?? "";
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return Response.json({ error: "Invalid YouTube video ID." }, { status: 400 });
    }

    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      `https://www.youtube.com/watch?v=${videoId}`,
    )}&format=json`;

    const res = await fetch(oembedUrl, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return Response.json(
        { error: "Could not fetch YouTube details. Video may be Private or embedding disabled." },
        { status: 404 },
      );
    }

    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };

    return Response.json({
      title: data.title ?? "",
      author: data.author_name ?? "",
      thumbnailUrl: data.thumbnail_url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    });
  } catch (error) {
    console.error("GET /api/youtube-info failed:", error);
    return Response.json({ error: "Failed to query YouTube metadata." }, { status: 500 });
  }
}

export default createVercelHandler({ GET });
