import { createHash, timingSafeEqual } from "node:crypto";

// Admin authentication for the management API.
//
// While SSO is deferred, the admin endpoints are guarded by a single shared
// secret, ADMIN_TOKEN, set as an environment variable. This is a deliberate
// bridge: it is powerful (anyone holding it can grant WRITE keys), so it must
// be a long random value, kept out of the repo, and rotated by redeploying.
// When SSO lands, these endpoints move behind per-admin sessions instead.

export interface AdminOk {
  ok: true;
}
export interface AdminFail {
  ok: false;
  status: number;
  error: string;
}
export type AdminAuthResult = AdminOk | AdminFail;

/** Accept the token via `x-admin-token` or `Authorization: Bearer <token>`. */
function extractAdminToken(req: Request): string | null {
  const header = req.headers.get("x-admin-token");
  if (header) return header.trim();
  const auth = req.headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  return null;
}

/** Constant-time, length-independent comparison via fixed-size digests. */
function secretsMatch(a: string, b: string): boolean {
  const da = createHash("sha256").update(a).digest();
  const db = createHash("sha256").update(b).digest();
  return timingSafeEqual(da, db);
}

export function requireAdmin(req: Request): AdminAuthResult {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "Admin API is disabled: ADMIN_TOKEN is not configured.",
    };
  }
  const provided = extractAdminToken(req);
  if (!provided) {
    return {
      ok: false,
      status: 401,
      error: "Missing admin token. Send 'x-admin-token' or 'Authorization: Bearer <token>'.",
    };
  }
  if (!secretsMatch(provided, expected)) {
    return { ok: false, status: 403, error: "Invalid admin token." };
  }
  return { ok: true };
}
