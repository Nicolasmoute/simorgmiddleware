import { authenticateRequest } from "./auth-key";
import { buildForwardHeaders, jsonResponse } from "./http";
import {
  getInstanceConfig,
  parseInstanceParam,
  resolveTargets,
  type Instance,
} from "./instances";
import { mergeResults, type InstanceResult } from "./merge";
import { isMethodAllowed, requiredScope } from "./scope";

// The generic SimOrg reverse proxy.
//
// Rather than hand-coding every SimOrg endpoint, this forwards any path under
// /api/simorg/* to the selected instance, mirroring the SimOrg API verbatim
// except for one added control: the `instance` parameter (FR | SA | ALL),
// supplied as a query parameter or the `x-simorg-instance` header.

const INSTANCE_QUERY_PARAM = "instance";
const INSTANCE_HEADER = "x-simorg-instance";
const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

interface ForwardResult {
  instance: Instance;
  status: number;
  ok: boolean;
  contentType: string;
  bodyBytes: ArrayBuffer;
}

/** Forward a single request to one SimOrg instance. */
async function forwardToInstance(
  instance: Instance,
  path: string,
  search: string,
  method: string,
  headers: Headers,
  body: ArrayBuffer | undefined,
): Promise<ForwardResult> {
  const cfg = getInstanceConfig(instance);
  const target = `${cfg.baseUrl}/${path}${search ? `?${search}` : ""}`;

  const upstreamHeaders = new Headers(headers);
  upstreamHeaders.set(cfg.authHeader, `${cfg.authScheme}${cfg.token}`);

  const resp = await fetch(target, {
    method,
    headers: upstreamHeaders,
    body,
    redirect: "manual",
  });

  return {
    instance,
    status: resp.status,
    ok: resp.ok,
    contentType: resp.headers.get("content-type") ?? "application/octet-stream",
    bodyBytes: await resp.arrayBuffer(),
  };
}

function parseBody(result: ForwardResult): unknown {
  const text = new TextDecoder().decode(result.bodyBytes);
  if (!text) return null;
  if (result.contentType.includes("application/json")) {
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

  // 5a. Single instance: mirror SimOrg's response faithfully.
  if (instanceParam !== "ALL") {
    const r = results[0];
    return new Response(r.bodyBytes, {
      status: r.status,
      headers: {
        "content-type": r.contentType,
        "x-simorg-instance": r.instance,
      },
    });
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
