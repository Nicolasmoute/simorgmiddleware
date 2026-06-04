// Small helpers for building responses without depending on Next-specific
// types, so the proxy logic stays unit-testable.

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

/** Header names that must not be forwarded upstream to SimOrg. */
const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

/** Client auth/control headers that must be stripped before forwarding. */
const CLIENT_ONLY = new Set(["authorization", "x-api-key", "x-simorg-instance", "cookie"]);

export function buildForwardHeaders(incoming: Headers): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower) || CLIENT_ONLY.has(lower)) return;
    out.set(key, value);
  });
  return out;
}
