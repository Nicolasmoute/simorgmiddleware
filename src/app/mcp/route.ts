import { handleProxy } from "@/lib/proxy";
import { MCP_TOOLS, listEndpoints, describeEndpoint } from "@/lib/simorg-spec";

// Remote MCP endpoint (Streamable HTTP / JSON-RPC) exposing SimOrg as tools, so
// Claude (cowork / Claude.ai connectors, or `claude mcp add --transport http`)
// can use it by URL — no local process or repo needed.
//
// Auth: simorg_call reuses the proxy's API-key auth. The key is taken from the
// incoming request: `Authorization: Bearer <smk key>`, `x-api-key`, or a `?key=`
// query parameter (handy for connector UIs that only accept a URL).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "simorg", version: "0.1.0" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-key, mcp-protocol-version, mcp-session-id",
};

type Json = Record<string, unknown>;
const text = (t: string) => ({ content: [{ type: "text", text: t }] });
const toolErr = (t: string) => ({ content: [{ type: "text", text: t }], isError: true });

function extractKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const x = req.headers.get("x-api-key");
  if (x) return x.trim();
  const k = new URL(req.url).searchParams.get("key");
  return k ? k.trim() : null;
}

async function simorgCall(args: Json, req: Request) {
  const method = String(args.method || "GET").toUpperCase();
  const instance = String(args.instance || "").toUpperCase();
  if (!["FR", "SA", "ALL"].includes(instance)) {
    return toolErr("instance is required and must be FR, SA, or ALL.");
  }
  const path = String(args.path || "").replace(/^\/+/, "");
  if (!path) return toolErr("path is required, e.g. /api/v1/classrooms");
  if (path.split("/").includes("..")) return toolErr("path must not contain '..' segments.");

  const key = extractKey(req);
  if (!key) {
    return toolErr(
      "Missing API key. Configure the connector with 'Authorization: Bearer <smk key>' or a '?key=' URL parameter.",
    );
  }

  const url = new URL(`http://internal/api/simorg/${path}`);
  url.searchParams.set("instance", instance);
  for (const [k, v] of Object.entries((args.query as Json) || {})) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, String(item));
    else url.searchParams.set(k, String(v));
  }

  const headers = new Headers({ authorization: `Bearer ${key}` });
  let body: string | undefined;
  if (!["GET", "HEAD"].includes(method) && args.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(args.body);
  }

  const resp = await handleProxy(new Request(url, { method, headers, body }), path.split("/"));
  const out = `HTTP ${resp.status} (instance=${resp.headers.get("x-simorg-instance") || instance})\n${await resp.text()}`;
  return resp.ok ? text(out) : toolErr(out);
}

async function callTool(name: string, args: Json, req: Request) {
  if (name === "simorg_list_endpoints") return text(listEndpoints(args));
  if (name === "simorg_describe_endpoint") {
    const d = describeEndpoint(String(args.method || ""), String(args.path || ""));
    return d ? text(d) : toolErr(`No endpoint ${args.method} ${args.path}. Use simorg_list_endpoints.`);
  }
  if (name === "simorg_call") return simorgCall(args, req);
  return toolErr(`Unknown tool: ${name}`);
}

const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: unknown, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

async function handleMessage(msg: Json, req: Request): Promise<object | null> {
  const { id, method, params } = msg as { id?: unknown; method?: string; params?: Json };
  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: (params?.protocolVersion as string) || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, { tools: MCP_TOOLS });
    case "tools/call":
      try {
        const result = await callTool(
          String(params?.name || ""),
          (params?.arguments as Json) || {},
          req,
        );
        return ok(id, result);
      } catch (err) {
        return ok(id, toolErr(`Tool failed: ${err instanceof Error ? err.message : String(err)}`));
      }
    default:
      // Notifications (e.g. notifications/initialized) have no id → no response.
      if (id === undefined || id === null) return null;
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(req: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400, headers: CORS });
  }

  const isBatch = Array.isArray(payload);
  const messages = (isBatch ? payload : [payload]) as Json[];
  const responses: object[] = [];
  for (const m of messages) {
    const r = await handleMessage(m, req);
    if (r !== null) responses.push(r);
  }

  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: CORS });
  }
  return Response.json(isBatch ? responses : responses[0], { headers: CORS });
}

// No server-initiated stream; advertise the endpoint instead of erroring blankly.
export function GET(): Response {
  return Response.json(
    { name: SERVER_INFO.name, transport: "streamable-http", hint: "POST JSON-RPC to this URL" },
    { headers: CORS },
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}
