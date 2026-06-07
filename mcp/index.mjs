#!/usr/bin/env node
// MCP server wrapping the SimOrg middleware.
//
// Exposes the SimOrg ERP (France + South Africa) to Claude as a small set of
// tools, handling auth and the FR/SA/ALL instance selector automatically.
// Discovery tools are backed by the bundled OpenAPI spec (or fetched live);
// simorg_call performs the actual request through the middleware.
//
// Configuration (environment variables):
//   SIMORG_MW_BASE_URL          middleware base URL
//                               (default https://simorgmiddleware.zeabur.app)
//   SIMORG_MW_API_KEY           an issued API key (smk_...) — required to call
//   SIMORG_MW_DEFAULT_INSTANCE  FR | SA | ALL (optional default)

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = (process.env.SIMORG_MW_BASE_URL || "https://simorgmiddleware.zeabur.app").replace(
  /\/+$/,
  "",
);
const API_KEY = process.env.SIMORG_MW_API_KEY || "";
const DEFAULT_INSTANCE = (process.env.SIMORG_MW_DEFAULT_INSTANCE || "").toUpperCase();
const SPEC_PATH = fileURLToPath(new URL("../docs/simorg-openapi.json", import.meta.url));

// --- OpenAPI spec: bundled file first, live fetch as fallback ---------------
let endpointIndex = null;

function buildIndex(spec) {
  const basePath = (spec.basePath || "").replace(/\/+$/, "");
  const items = [];
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const [method, op] of Object.entries(ops)) {
      if (!["get", "post", "put", "patch", "delete", "head"].includes(method.toLowerCase()))
        continue;
      items.push({
        method: method.toUpperCase(),
        fullPath: `${basePath}${p}`,
        tag: (op.tags && op.tags[0]) || "(untagged)",
        summary: op.summary || op.description || "",
        operation: op,
      });
    }
  }
  return items;
}

async function loadSpec() {
  if (endpointIndex) return endpointIndex;
  // 1. bundled file
  try {
    const raw = await readFile(SPEC_PATH, "utf8");
    endpointIndex = buildIndex(JSON.parse(raw));
    return endpointIndex;
  } catch {
    /* fall through to live fetch */
  }
  // 2. live fetch via the middleware
  const resp = await fetch(`${BASE_URL}/api/simorg/api/v1/docs?instance=FR`, {
    headers: API_KEY ? { authorization: `Bearer ${API_KEY}` } : {},
  });
  if (!resp.ok) {
    throw new Error(
      `Could not load OpenAPI spec (no bundled file, live fetch returned ${resp.status}).`,
    );
  }
  endpointIndex = buildIndex(await resp.json());
  return endpointIndex;
}

const textResult = (text) => ({ content: [{ type: "text", text }] });
const errorResult = (text) => ({ content: [{ type: "text", text }], isError: true });

// --- Tool definitions -------------------------------------------------------
const TOOLS = [
  {
    name: "simorg_list_endpoints",
    description:
      "List available SimOrg API endpoints (from the OpenAPI spec). Filter by tag, HTTP method, or a free-text search over path/summary. Use this to discover what data is available before calling.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Free-text filter over path and summary" },
        tag: { type: "string", description: "Filter by tag, e.g. 'report', 'parts', 'slot'" },
        method: {
          type: "string",
          description: "Filter by HTTP method (GET, POST, ...)",
        },
      },
    },
  },
  {
    name: "simorg_describe_endpoint",
    description:
      "Show the full OpenAPI definition (parameters, request body, responses) for one endpoint, identified by method + path (path as shown by simorg_list_endpoints, e.g. /api/v1/report/all_sessions).",
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
        path: {
          type: "string",
          description: "Full SimOrg path, e.g. /api/v1/classrooms",
        },
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

// --- Tool handlers ----------------------------------------------------------
async function handleList(args) {
  const items = await loadSpec();
  const search = (args.search || "").toLowerCase();
  const tag = (args.tag || "").toLowerCase();
  const method = (args.method || "").toUpperCase();
  const matches = items.filter(
    (it) =>
      (!tag || it.tag.toLowerCase() === tag) &&
      (!method || it.method === method) &&
      (!search || `${it.fullPath} ${it.summary}`.toLowerCase().includes(search)),
  );
  if (matches.length === 0) return textResult("No matching endpoints.");
  const lines = matches
    .sort((a, b) => a.fullPath.localeCompare(b.fullPath))
    .map((it) => `${it.method.padEnd(6)} ${it.fullPath}  [${it.tag}]${it.summary ? "  — " + it.summary : ""}`);
  return textResult(`${matches.length} endpoint(s):\n` + lines.join("\n"));
}

async function handleDescribe(args) {
  const items = await loadSpec();
  const method = String(args.method || "").toUpperCase();
  const path = String(args.path || "");
  const it = items.find((x) => x.method === method && x.fullPath === path);
  if (!it) return errorResult(`No endpoint ${method} ${path}. Use simorg_list_endpoints.`);
  return textResult(
    JSON.stringify(
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
    ),
  );
}

async function handleCall(args) {
  if (!API_KEY) {
    return errorResult("SIMORG_MW_API_KEY is not set; cannot call the SimOrg middleware.");
  }
  const method = (args.method || "GET").toUpperCase();
  const instance = (args.instance || DEFAULT_INSTANCE || "").toUpperCase();
  if (!["FR", "SA", "ALL"].includes(instance)) {
    return errorResult("instance is required and must be FR, SA, or ALL.");
  }
  const path = String(args.path || "").replace(/^\/+/, "");
  if (!path) return errorResult("path is required, e.g. /api/v1/classrooms");
  // Defensive: keep calls within the SimOrg path space (no `..` traversal to
  // other middleware routes such as /api/admin).
  if (path.split("/").includes("..")) {
    return errorResult("path must not contain '..' segments.");
  }

  const url = new URL(`${BASE_URL}/api/simorg/${path}`);
  url.searchParams.set("instance", instance);
  for (const [k, v] of Object.entries(args.query || {})) {
    if (v === undefined || v === null) continue;
    // Repeat the key for array values (e.g. ids=1&ids=2) rather than stringify.
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }

  const init = {
    method,
    headers: { authorization: `Bearer ${API_KEY}`, accept: "application/json" },
  };
  if (!["GET", "HEAD"].includes(method) && args.body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(args.body);
  }

  let resp;
  try {
    resp = await fetch(url, init);
  } catch (err) {
    return errorResult(`Request failed: ${err?.message || err}`);
  }
  const text = await resp.text();
  const header = `HTTP ${resp.status} ${resp.statusText} (instance=${resp.headers.get("x-simorg-instance") || instance})`;
  const result = `${header}\n${text.length > 12000 ? text.slice(0, 12000) + "\n…(truncated)" : text}`;
  return resp.ok ? textResult(result) : errorResult(result);
}

// --- Wire up the server -----------------------------------------------------
const server = new Server(
  { name: "simorg", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === "simorg_list_endpoints") return await handleList(args);
    if (name === "simorg_describe_endpoint") return await handleDescribe(args);
    if (name === "simorg_call") return await handleCall(args);
    return errorResult(`Unknown tool: ${name}`);
  } catch (err) {
    return errorResult(`Tool ${name} failed: ${err?.message || err}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is safe for diagnostics; stdout is the JSON-RPC channel.
console.error(`simorg-mcp ready (base=${BASE_URL}, key=${API_KEY ? "set" : "MISSING"})`);
