// Read vs. write classification for API keys.
//
// SimOrg's own API cannot restrict which operations a token may call, so the
// middleware does it here. The default policy is HTTP-method based: safe
// methods are reads, everything else is a write. This is documented behaviour;
// if SimOrg exposes read operations behind POST (e.g. complex searches), add
// them to the override list below rather than widening every key to WRITE.

export type Scope = "READ" | "WRITE";

export const SCOPES: readonly Scope[] = ["READ", "WRITE"] as const;

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The access level a given HTTP method requires. */
export function requiredScope(method: string): Scope {
  return READ_METHODS.has(method.toUpperCase()) ? "READ" : "WRITE";
}

/** Whether a key holding `keyScope` may perform a request using `method`. */
export function isMethodAllowed(keyScope: Scope, method: string): boolean {
  if (keyScope === "WRITE") return true; // WRITE implies READ
  return requiredScope(method) === "READ";
}

export function isScope(value: unknown): value is Scope {
  return value === "READ" || value === "WRITE";
}
