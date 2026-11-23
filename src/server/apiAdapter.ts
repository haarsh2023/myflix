import type { IncomingMessage, ServerResponse } from "node:http";

export type RouteHandler = (request: Request) => Promise<Response> | Response;

export type RouteMap = {
  GET?: RouteHandler;
  POST?: RouteHandler;
  PUT?: RouteHandler;
  PATCH?: RouteHandler;
  DELETE?: RouteHandler;
  OPTIONS?: RouteHandler;
};

export async function toWebRequest(req: Request | IncomingMessage): Promise<Request> {
  if (req instanceof Request) return req;

  const nodeReq = req as IncomingMessage;
  const protocol = nodeReq.headers["x-forwarded-proto"] || "https";
  const host =
    nodeReq.headers["x-forwarded-host"] || nodeReq.headers.host || "localhost";
  const url = `${protocol}://${host}${nodeReq.url || "/"}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  const method = (nodeReq.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }

  let bodyContent: BodyInit | undefined;
  try {
    const anyReq = nodeReq as unknown as { body?: unknown };
    if (anyReq.body !== undefined && anyReq.body !== null) {
      bodyContent =
        typeof anyReq.body === "string" || Buffer.isBuffer(anyReq.body)
          ? (anyReq.body as BodyInit)
          : JSON.stringify(anyReq.body);
    }
  } catch {
    // Vercel's automatic body parser can throw if body is invalid JSON or already consumed
  }

  if (bodyContent !== undefined) {
    return new Request(url, { method, headers, body: bodyContent });
  }

  const chunks: Buffer[] = [];
  try {
    for await (const chunk of nodeReq) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } catch {
    // Stream might be closed or empty
  }
  const bodyBuffer = Buffer.concat(chunks);
  return new Request(url, {
    method,
    headers,
    body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
  });
}

export function createVercelHandler(routes: RouteMap) {
  return async function vercelHandler(
    req: Request | IncomingMessage,
    res?: ServerResponse,
  ): Promise<Response | void> {
    try {
      const webReq = await toWebRequest(req);
      const method = webReq.method.toUpperCase();
      const handler = routes[method as keyof RouteMap];

      if (!handler) {
        const notAllowed = new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: Object.keys(routes).join(", ") },
        });
        if (res && typeof res.writeHead === "function") {
          res.statusCode = 405;
          res.end("Method Not Allowed");
          return;
        }
        return notAllowed;
      }

      const webRes = await handler(webReq);

      if (res && typeof res.writeHead === "function") {
        res.statusCode = webRes.status;
        webRes.headers.forEach((val, key) => {
          res.setHeader(key, val);
        });
        const arrayBuf = await webRes.arrayBuffer();
        res.end(Buffer.from(arrayBuf));
        return;
      }

      return webRes;
    } catch (err) {
      console.error("Vercel Serverless Function error:", err);
      if (res && typeof res.writeHead === "function") {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Internal Server Error" }));
        return;
      }
      return Response.json({ error: "Internal Server Error" }, { status: 500 });
    }
  };
}
