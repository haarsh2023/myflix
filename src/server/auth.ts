import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "myflix_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type PasscodeConfig = {
  passcode: string | null;
  configured: boolean;
  isDevDefault: boolean;
};

/**
 * Resolve passcode configuration, failing closed in production/Vercel when MYFLIX_PASSCODE is unset.
 */
export function getPasscodeConfig(): PasscodeConfig {
  const configured = process.env.MYFLIX_PASSCODE?.trim();
  if (configured) {
    return { passcode: configured, configured: true, isDevDefault: false };
  }

  // Fallback to default passcode "myflix" so initial deployments unlock out-of-the-box
  return { passcode: "myflix", configured: true, isDevDefault: true };
}

function getSessionSecret(): string {
  const explicit = process.env.MYFLIX_SESSION_SECRET?.trim();
  if (explicit) return explicit;

  const passcode = getPasscodeConfig().passcode ?? "";
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN ?? "";
  return createHash("sha256")
    .update(`myflix-session-v1:${passcode}:${blobToken}`)
    .digest("hex");
}

function signPayload(encodedPayload: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function safeEqualStrings(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

/**
 * Constant-time verification of a candidate passcode against the configured secret.
 */
export function verifyPasscode(candidate: string): boolean {
  const { passcode, configured } = getPasscodeConfig();
  if (!configured || !passcode) return false;
  return safeEqualStrings(candidate, passcode);
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).trim();
    const val = part.slice(eqIndex + 1).trim();
    if (key) result[key] = decodeURIComponent(val);
  }
  return result;
}

function isHttpsRequest(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return request.url.startsWith("https://");
}

/**
 * Create an HttpOnly signed session cookie string valid for 30 days.
 */
export function createSessionCookie(request: Request): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + SESSION_TTL_MS }),
    "utf8",
  ).toString("base64url");
  const signature = signPayload(payload);
  const secureAttr = isHttpsRequest(request) ? "; Secure" : "";
  return `${COOKIE_NAME}=${encodeURIComponent(`${payload}.${signature}`)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureAttr}`;
}

/**
 * Create an expired Set-Cookie header value to sign out of Myflix.
 */
export function clearSessionCookie(request: Request): string {
  const secureAttr = isHttpsRequest(request) ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secureAttr}`;
}

/**
 * Verify that the incoming request carries a valid, unexpired Myflix session cookie.
 */
export function isAuthenticated(request: Request): boolean {
  const { configured } = getPasscodeConfig();
  if (!configured) return false;

  const cookies = parseCookies(request.headers.get("cookie"));
  const rawToken = cookies[COOKIE_NAME];
  if (!rawToken) return false;

  const dotIndex = rawToken.indexOf(".");
  if (dotIndex === -1) return false;

  const payload = rawToken.slice(0, dotIndex);
  const signature = rawToken.slice(dotIndex + 1);
  if (!payload || !signature) return false;

  const expectedSignature = signPayload(payload);
  if (!safeEqualStrings(signature, expectedSignature)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      exp?: number;
    };
    return typeof parsed.exp === "number" && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

/**
 * Return a 401 JSON Response when unauthenticated, or null when authorized.
 */
export function requireAuth(request: Request): Response | null {
  if (isAuthenticated(request)) return null;
  return Response.json({ error: "Authentication required" }, { status: 401 });
}
