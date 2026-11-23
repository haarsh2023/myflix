import { createVercelHandler } from "../src/server/apiAdapter.js";
import {
  clearSessionCookie,
  createSessionCookie,
  getPasscodeConfig,
  isAuthenticated,
  verifyPasscode,
} from "../src/server/auth.js";
import { getPreferredBlobAccess, hasBlobStorage } from "../src/server/blobStore.js";

export async function GET(request: Request): Promise<Response> {
  try {
    const config = getPasscodeConfig();
    return Response.json({
      authenticated: isAuthenticated(request),
      configured: config.configured,
      storageMode: hasBlobStorage() ? "blob" : "local",
      blobAccess: getPreferredBlobAccess(),
      devHint: config.isDevDefault
        ? 'Default passcode is "myflix" (set MYFLIX_PASSCODE in Vercel environment variables to customize).'
        : undefined,
    });
  } catch (error) {
    console.error("GET /api/auth failed:", error);
    return Response.json({ error: "Unable to check auth status." }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const config = getPasscodeConfig();
    if (!config.configured) {
      return Response.json(
        { error: "MYFLIX_PASSCODE environment variable is not configured on the server." },
        { status: 503 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as { passcode?: unknown };
    const passcode = typeof body.passcode === "string" ? body.passcode : "";
    if (!verifyPasscode(passcode)) {
      return Response.json({ error: "Incorrect passcode." }, { status: 401 });
    }

    return Response.json(
      { authenticated: true },
      {
        headers: {
          "Set-Cookie": createSessionCookie(request),
        },
      },
    );
  } catch (error) {
    console.error("POST /api/auth failed:", error);
    return Response.json({ error: "Login failed." }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    return Response.json(
      { authenticated: false },
      {
        headers: {
          "Set-Cookie": clearSessionCookie(request),
        },
      },
    );
  } catch (error) {
    console.error("DELETE /api/auth failed:", error);
    return Response.json({ error: "Logout failed." }, { status: 500 });
  }
}

export default createVercelHandler({ GET, POST, DELETE });
