// SimOrg instance configuration and request-target selection.
//
// SimOrg authenticates via OAuth2 client-credentials: per instance we hold a
// client id/secret and a token endpoint, exchange them for a short-lived
// access token (see simorg-token.ts), and call the API with that bearer token.

export const INSTANCES = ["FR", "SA"] as const;
export type Instance = (typeof INSTANCES)[number];

/** What a client may pass for the `instance` parameter. */
export type InstanceParam = Instance | "ALL";

export interface InstanceConfig {
  instance: Instance;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Resolve the SimOrg base URL + OAuth credentials for one instance from env.
 * Env names (per instance, with FR/SA):
 *   SIMORG_<I>_BASE_URL, SIMORG_<I>_CLIENT_ID, SIMORG_<I>_CLIENT_SECRET,
 *   SIMORG_<I>_TOKEN_URL.
 * Shared fallbacks: SIMORG_TOKEN_URL (token endpoint), SIMORG_SCOPE (scope,
 * defaulting to "application").
 */
export function getInstanceConfig(instance: Instance): InstanceConfig {
  const baseUrl = requireEnv(`SIMORG_${instance}_BASE_URL`).replace(/\/+$/, "");
  const clientId = requireEnv(`SIMORG_${instance}_CLIENT_ID`);
  const clientSecret = requireEnv(`SIMORG_${instance}_CLIENT_SECRET`);
  const tokenUrl =
    process.env[`SIMORG_${instance}_TOKEN_URL`] || process.env.SIMORG_TOKEN_URL;
  if (!tokenUrl) {
    throw new Error(
      `Missing token URL: set SIMORG_${instance}_TOKEN_URL or SIMORG_TOKEN_URL`,
    );
  }
  return {
    instance,
    baseUrl,
    clientId,
    clientSecret,
    tokenUrl,
    scope: process.env.SIMORG_SCOPE || "application",
  };
}

/**
 * Normalise and validate the client-supplied instance selector.
 * Accepts FR / SA / ALL, case-insensitively. Returns null if invalid.
 */
export function parseInstanceParam(raw: string | null | undefined): InstanceParam | null {
  if (!raw) return null;
  const value = raw.trim().toUpperCase();
  if (value === "ALL") return "ALL";
  if ((INSTANCES as readonly string[]).includes(value)) return value as Instance;
  return null;
}

/** Expand an instance selector into the concrete instances to call. */
export function resolveTargets(param: InstanceParam): Instance[] {
  return param === "ALL" ? [...INSTANCES] : [param];
}
