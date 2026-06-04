import { prisma } from "./db";
import { generateApiKey } from "./auth-key";
import { isScope, type Scope } from "./scope";

// Shared key-management service used by both the CLI (`npm run keys`) and the
// admin HTTP API (`/api/admin/keys`), so issuance/listing/mutation logic lives
// in exactly one place.

/** Raised for caller errors (bad input, missing key); carries an HTTP status. */
export class KeyServiceError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "KeyServiceError";
  }
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function defaultMonths(): number {
  const n = Number(process.env.DEFAULT_KEY_LIFETIME_MONTHS ?? "3");
  return Number.isFinite(n) && n > 0 ? n : 3;
}

export interface IssueKeyInput {
  email: string;
  label: string;
  scope?: string;
  months?: number;
}

export interface IssuedKey {
  /** Plaintext secret — returned only here, at creation time. */
  plaintext: string;
  id: string;
  scope: Scope;
  email: string;
  expiresAt: Date;
}

/**
 * Issue a new API key for `email` (creating the user if needed). Only callers
 * that have already passed admin auth should request scope=WRITE.
 */
export async function issueKey(input: IssueKeyInput): Promise<IssuedKey> {
  const email = input.email?.trim().toLowerCase();
  const label = input.label?.trim();
  if (!email) throw new KeyServiceError("email is required");
  if (!label) throw new KeyServiceError("label is required");

  const scopeRaw = (input.scope ?? "READ").toUpperCase();
  if (!isScope(scopeRaw)) {
    throw new KeyServiceError(`Invalid scope "${scopeRaw}". Use READ or WRITE.`);
  }

  const months = input.months ?? defaultMonths();
  if (!Number.isFinite(months) || months <= 0) {
    throw new KeyServiceError(`Invalid months value: ${input.months}`);
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  const { plaintext, keyHash, keyPrefix } = generateApiKey();
  const expiresAt = addMonths(new Date(), months);
  const key = await prisma.apiKey.create({
    data: { label, keyHash, keyPrefix, scope: scopeRaw, expiresAt, userId: user.id },
  });

  return { plaintext, id: key.id, scope: scopeRaw, email, expiresAt };
}

export type KeyStatus = "active" | "blocked" | "expired";

export interface KeySummary {
  id: string;
  keyPrefix: string;
  scope: string;
  status: KeyStatus;
  blocked: boolean;
  email: string;
  label: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

function statusOf(blocked: boolean, expiresAt: Date | null): KeyStatus {
  if (blocked) return "blocked";
  if (expiresAt && expiresAt.getTime() < Date.now()) return "expired";
  return "active";
}

/** List keys (never exposes secrets), optionally filtered by owner email. */
export async function listKeys(email?: string): Promise<KeySummary[]> {
  const keys = await prisma.apiKey.findMany({
    where: email ? { user: { email: email.trim().toLowerCase() } } : undefined,
    orderBy: { createdAt: "desc" },
    include: { user: true },
  });
  return keys.map((k) => ({
    id: k.id,
    keyPrefix: k.keyPrefix,
    scope: k.scope,
    status: statusOf(k.blocked, k.expiresAt),
    blocked: k.blocked,
    email: k.user.email,
    label: k.label,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  }));
}

async function mustFindKey(id: string) {
  const key = await prisma.apiKey.findUnique({ where: { id } });
  if (!key) throw new KeyServiceError(`No key with id ${id}`, 404);
  return key;
}

export async function setKeyScope(id: string, scope: string): Promise<void> {
  const normalized = scope?.toUpperCase();
  if (!isScope(normalized)) throw new KeyServiceError("scope must be READ or WRITE");
  await mustFindKey(id);
  await prisma.apiKey.update({ where: { id }, data: { scope: normalized } });
}

export async function setKeyBlocked(id: string, blocked: boolean): Promise<void> {
  await mustFindKey(id);
  await prisma.apiKey.update({ where: { id }, data: { blocked } });
}

export async function revokeKey(id: string): Promise<void> {
  await mustFindKey(id);
  await prisma.apiKey.delete({ where: { id } });
}
