import specJson from "../../docs/simorg-openapi.json";

// SimOrg OpenAPI spec helpers, shared by the remote MCP endpoint (and usable by
// anything server-side). The spec is imported (bundled) so it is always
// available at runtime without a file/network dependency.

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

const spec = specJson as AnyObj;
const basePath = String(spec.basePath || "").replace(/\/+$/, "");

export interface SpecEndpoint {
  method: string;
  fullPath: string;
  tag: string;
  summary: string;
  operation: AnyObj;
}

const index: SpecEndpoint[] = (() => {
  const items: SpecEndpoint[] = [];
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(ops as AnyObj)) {
      if (!["get", "post", "put", "patch", "delete", "head"].includes(method.toLowerCase()))
        continue;
      const o = op as AnyObj;
      items.push({
        method: method.toUpperCase(),
        fullPath: `${basePath}${p}`,
        tag: (o.tags && o.tags[0]) || "(untagged)",
        summary: o.summary || o.description || "",
        operation: o,
      });
    }
  }
  return items;
})();

export function listEndpoints(args: { search?: string; tag?: string; method?: string }): string {
  const s = (args.search || "").toLowerCase();
  const t = (args.tag || "").toLowerCase();
  const m = (args.method || "").toUpperCase();
  const matches = index.filter(
    (it) =>
      (!t || it.tag.toLowerCase() === t) &&
      (!m || it.method === m) &&
      (!s || `${it.fullPath} ${it.summary}`.toLowerCase().includes(s)),
  );
  if (matches.length === 0) return "No matching endpoints.";
  return (
    `${matches.length} endpoint(s):\n` +
    matches
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
      .map(
        (it) =>
          `${it.method.padEnd(6)} ${it.fullPath}  [${it.tag}]${it.summary ? "  — " + it.summary : ""}`,
      )
      .join("\n")
  );
}

export function describeEndpoint(method: string, path: string): string | null {
  const it = index.find((x) => x.method === String(method).toUpperCase() && x.fullPath === path);
  if (!it) return null;
  return JSON.stringify(
    {
      method: it.method,
      path: it.fullPath,
      tag: it.tag,
      summary: it.summary,
      parameters: it.operation.parameters || [],
      requestBody: it.operation.requestBody || it.operation.consumes || undefined,
      responses: it.operation.responses || {},
    },
    null,
    2,
  );
}

export const MCP_TOOLS = [
  {
    name: "simorg_list_endpoints",
    description:
      "List available SimOrg API endpoints (from the OpenAPI spec). Filter by tag, HTTP method, or a free-text search over path/summary. Use this to discover what data is available before calling.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Free-text filter over path and summary" },
        tag: { type: "string", description: "Filter by tag, e.g. 'report', 'parts', 'slot'" },
        method: { type: "string", description: "Filter by HTTP method (GET, POST, ...)" },
      },
    },
  },
  {
    name: "simorg_describe_endpoint",
    description:
      "Show the full OpenAPI definition (parameters, request body, responses) for one endpoint, identified by method + path (e.g. /api/v1/report/all_sessions).",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", description: "HTTP method, e.g. GET" },
        path: { type: "string", description: "Full path, e.g. /api/v1/classrooms" },
      },
      required: ["method", "path"],
    },
  },
  {
    name: "simorg_call",
    description:
      "Call a SimOrg endpoint through the middleware. Reads (GET) work with a read-only key; writes need a WRITE-scoped key. Choose the instance: FR (France), SA (South Africa), or ALL (both DBs merged, each record tagged with _instance).",
    inputSchema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          description: "HTTP method (default GET)",
        },
        path: { type: "string", description: "Full SimOrg path, e.g. /api/v1/classrooms" },
        instance: {
          type: "string",
          enum: ["FR", "SA", "ALL"],
          description: "Which instance(s) to target",
        },
        query: {
          type: "object",
          description: "Query-string parameters as key/value pairs",
          additionalProperties: true,
        },
        body: {
          type: "object",
          description: "JSON request body (for POST/PUT/PATCH)",
          additionalProperties: true,
        },
      },
      required: ["path"],
    },
  },
];
