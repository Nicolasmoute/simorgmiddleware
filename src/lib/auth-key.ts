import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./db";
import type { Scope } from "./scope";

// API-key issuance and verification.
//
// Keys look like `smk_<40 hex chars>`. Only the SHA-256 hash is stored, so a
// leaked database does not reveal usable keys. The non-secret `smk_xxxx…`
// prefix is kept for display in listings and logs.

const KEY_PREFIX = "smk_";
const PREFIX_DISPLAY_LEN = 12; // e.g. "smk_a1b2c3d4"

export interface GeneratedKey {
  /** The full secret. Returned only once, at creation time. */
  plaintext: string;
  keyHash: string;
  keyPrefix: string;
}

export function generateApiKey(): GeneratedKey {
  const plaintext = KEY_PREFIX + randomBytes(20).toString("hex");
  return {
    plaintext,
    keyHash: hashKey(plaintext),
    keyPrefix: plaintext.slice(0, PREFIX_DISPLAY_LEN),
  };
}

export function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Extract the presented key from Authorization: Bearer or x-api-key. */
export function extractKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) return match[1].trim();
  }
  const apiKey = req.headers.get("x-api-key");
  return apiKey ? apiKey.trim() : null;
}

export interface AuthSuccess {
  ok: true;
  key: {
    id: string;
    scope: Scope;
    userEmail: string;
  };
}

export interface AuthFailure {
  ok: false;
  status: number;
  error: string;
}

export type AuthResult = AuthSuccess | AuthFailure;

/** Constant-time comparison of two hex hash strings of equal length. */
function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Authenticate an incoming request by its API key. Resolves the key, then
 * checks block status and expiry. Returns the key's scope for downstream
 * authorisation. Updates lastUsedAt opportunistically (best effort).
 */
export async function authenticateRequest(req: Request): Promise<AuthResult> {
  const raw = extractKey(req);
  if (!raw) {
    return {
      ok: false,
      status: 401,
      error: "Missing API key. Send 'Authorization: Bearer <key>' or the 'x-api-key' header.",
    };
  }

  const hash = hashKey(raw);
  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    include: { user: true },
  });

  // Defence-in-depth: the unique lookup already used the hash, but compare in
  // constant time to avoid leaking timing information about partial matches.
  if (!record || !hashesEqual(record.keyHash, hash)) {
    return { ok: false, status: 401, error: "Invalid API key." };
  }

  if (record.blocked) {
    return { ok: false, status: 403, error: "This API key has been blocked." };
  }

  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
    return { ok: false, status: 401, error: "This API key has expired." };
  }

  // Best-effort last-used timestamp; never block the request on it.
  void prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    ok: true,
    key: {
      id: record.id,
      scope: (record.scope === "WRITE" ? "WRITE" : "READ") as Scope,
      userEmail: record.user.email,
    },
  };
}
