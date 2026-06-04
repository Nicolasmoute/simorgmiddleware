import { authenticateRequest } from "./auth-key";
import { buildForwardHeaders, buildResponseHeaders, jsonResponse } from "./http";
import {
  getInstanceConfig,
  parseInstanceParam,
  resolveTargets,
  type Instance,
} from "./instances";
import { mergeResults, type InstanceResult } from "./merge";
import { isMethodAllowed, requiredScope } from "./scope";
import { getAccessToken } from "./simorg-token";

// The generic SimOrg reverse proxy.
//
// Rather than hand-coding every SimOrg endpoint, this forwards any path under
// /api/simorg/* to the selected instance, mirroring the SimOrg API verbatim
// except for one added control: the `instance` parameter (FR | SA | ALL),
// supplied as a query parameter or the `x-simorg-instance` header.

const INSTANCE_QUERY_PARAM = "instance";
const INSTANCE_HEADER = "x-simorg-instance";
const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);
// Statuses that must not carry a response body (per the Fetch spec). Passing
// even an empty ArrayBuffer for these makes the Response constructor throw.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

interface ForwardResult {
  instance: Instance;
  status: number;
  ok: boolean;
  headers: Headers;
  bodyBytes: ArrayBuffer;
}

function errorResult(instance: Instance, status: number, detail: string): ForwardResult {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ error: `SimOrg ${instance} request failed`, detail }),
  );
  return {
    instance,
    status,
    ok: false,
    headers: new Headers({ "content-type": "application/json; charset=utf-8" }),
    bodyBytes: bytes.buffer as ArrayBuffer,
  };
}

/**
 * Forward a single request to one SimOrg instance, authenticating with an
 * OAuth2 client-credentials access token. Never throws: upstream/token
 * failures are returned as a 502 ForwardResult so that an `ALL` call can still
 * succeed on the other instance.
 */
async function forwardToInstance(
  instance: Instance,
  path: string,
  search: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | undefined,
): Promise<ForwardResult> {
  try {
    const cfg = getInstanceConfig(instance);
    const accessToken = await getAccessToken(instance);
    const target = `${cfg.baseUrl}/${path}${search ? `?${search}` : ""}`;

    const upstreamHeaders = new Headers(headers);
    upstreamHeaders.set("authorization", `Bearer ${accessToken}`);

    // Follow redirects (default): `redirect: "manual"` would yield an opaque
    // response (status 0, empty body) and silently corrupt any 3xx from SimOrg.
    const resp = await fetch(target, { method, headers: upstreamHeaders, body });

    return {
      instance,
      status: resp.status,
      ok: resp.ok,
      headers: resp.headers,
      bodyBytes: await resp.arrayBuffer(),
    };
  } catch (err) {
    return errorResult(instance, 502, err instanceof Error ? err.message : String(err));
  }
}

function parseBody(result: ForwardResult): unknown {
  const text = new TextDecoder().decode(result.bodyBytes);
  if (!text) return null;
  if ((result.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

/**
 * Handle a proxied request end to end: authenticate, enforce scope, resolve
 * the instance(s), forward, and return either a faithful single-instance
 * response or a merged ALL response.
 */
export async function handleProxy(req: Request, pathSegments: string[]): Promise<Response> {
  // 1. Authenticate the API key.
  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status);
  }

  // 2. Enforce read/write scope.
  if (!isMethodAllowed(auth.key.scope, req.method)) {
    return jsonResponse(
      {
        error: "This API key is limited to read-only operations.",
        method: req.method,
        requiredScope: requiredScope(req.method),
        keyScope: auth.key.scope,
      },
      403,
    );
  }

  // 3. Resolve the instance selector (query param or header).
  const url = new URL(req.url);
  const rawInstance =
    url.searchParams.get(INSTANCE_QUERY_PARAM) ?? req.headers.get(INSTANCE_HEADER);
  const instanceParam = parseInstanceParam(rawInstance);
  if (!instanceParam) {
    return jsonResponse(
      {
        error:
          "Missing or invalid 'instance'. Pass ?instance=FR|SA|ALL or the 'x-simorg-instance' header.",
        received: rawInstance ?? null,
      },
      400,
    );
  }

  // 4. Build the upstream path and query (minus our control parameter).
  url.searchParams.delete(INSTANCE_QUERY_PARAM);
  const path = pathSegments.map(encodeURIComponent).join("/");
  const search = url.searchParams.toString();

  const method = req.method.toUpperCase();
  const body = METHODS_WITHOUT_BODY.has(method) ? undefined : await req.arrayBuffer();
  const forwardHeaders = buildForwardHeaders(req.headers);

  const targets = resolveTargets(instanceParam);

  let results: ForwardResult[];
  try {
    results = await Promise.all(
      targets.map((inst) =>
        forwardToInstance(inst, path, search, method, forwardHeaders, body),
      ),
    );
  } catch (err) {
    return jsonResponse(
      { error: "Failed to reach SimOrg.", detail: err instanceof Error ? err.message : String(err) },
      502,
    );
  }

  // 5a. Single instance: mirror SimOrg's response faithfully, relaying its
  // status and headers (e.g. Location, pagination) minus unsafe/stale ones.
  if (instanceParam !== "ALL") {
    const r = results[0];
    const headers = buildResponseHeaders(r.headers);
    headers.set("x-simorg-instance", r.instance);
    const body = NULL_BODY_STATUSES.has(r.status) ? null : r.bodyBytes;
    return new Response(body, { status: r.status, headers });
  }

  // 5b. ALL: parse JSON from each instance and merge, tagging by instance.
  const parsed: InstanceResult[] = results.map((r) => ({
    instance: r.instance,
    status: r.status,
    ok: r.ok,
    body: parseBody(r),
  }));
  const merged = mergeResults(parsed);
  return jsonResponse(merged.body, merged.status, {
    "x-simorg-instance": "ALL",
    "x-simorg-instances": results.map((r) => `${r.instance}=${r.status}`).join(","),
  });
}
