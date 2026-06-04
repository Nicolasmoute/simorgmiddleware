import { getInstanceConfig, type Instance } from "./instances";

// OAuth2 client-credentials token manager for SimOrg.
//
// Each instance's access token is fetched from its token endpoint and cached
// in memory until shortly before it expires. Concurrent requests for the same
// instance share a single in-flight fetch so we never stampede the token
// endpoint.

interface CachedToken {
  accessToken: string;
  /** epoch ms after which the token should be considered stale */
  expiresAt: number;
}

const EXPIRY_SAFETY_MS = 60_000; // refresh a minute before actual expiry
const DEFAULT_TTL_SEC = 3600; // assume 1h if the response omits expires_in

const cache = new Map<Instance, CachedToken>();
const inflight = new Map<Instance, Promise<string>>();

async function fetchToken(instance: Instance): Promise<string> {
  const cfg = getInstanceConfig(instance);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: cfg.scope,
  });

  const resp = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Token request for ${instance} failed: ${resp.status} ${text.slice(0, 300)}`);
  }

  let json: { access_token?: string; expires_in?: number };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Token response for ${instance} was not JSON: ${text.slice(0, 200)}`);
  }
  if (!json.access_token) {
    throw new Error(`Token response for ${instance} had no access_token`);
  }

  const ttlSec = Number(json.expires_in) > 0 ? Number(json.expires_in) : DEFAULT_TTL_SEC;
  cache.set(instance, {
    accessToken: json.access_token,
    expiresAt: Date.now() + ttlSec * 1000,
  });
  return json.access_token;
}

/** Return a valid access token for the instance, fetching/refreshing as needed. */
export async function getAccessToken(instance: Instance): Promise<string> {
  const cached = cache.get(instance);
  if (cached && cached.expiresAt > Date.now() + EXPIRY_SAFETY_MS) {
    return cached.accessToken;
  }
  const existing = inflight.get(instance);
  if (existing) return existing;

  const p = fetchToken(instance).finally(() => inflight.delete(instance));
  inflight.set(instance, p);
  return p;
}

/** Testing/ops helper: drop cached tokens so the next call refetches. */
export function clearTokenCache(instance?: Instance): void {
  if (instance) cache.delete(instance);
  else cache.clear();
}
