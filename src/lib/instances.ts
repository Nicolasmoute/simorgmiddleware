// SimOrg instance configuration and request-target selection.

export const INSTANCES = ["FR", "SA"] as const;
export type Instance = (typeof INSTANCES)[number];

/** What a client may pass for the `instance` parameter. */
export type InstanceParam = Instance | "ALL";

export interface InstanceConfig {
  instance: Instance;
  baseUrl: string;
  token: string;
  authHeader: string;
  authScheme: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Resolve the SimOrg base URL + credentials for one instance from env. */
export function getInstanceConfig(instance: Instance): InstanceConfig {
  const baseUrl = requireEnv(`SIMORG_${instance}_BASE_URL`).replace(/\/+$/, "");
  const token = requireEnv(`SIMORG_${instance}_TOKEN`);
  return {
    instance,
    baseUrl,
    token,
    authHeader: process.env.SIMORG_AUTH_HEADER || "Authorization",
    authScheme: process.env.SIMORG_AUTH_SCHEME ?? "Bearer ",
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
