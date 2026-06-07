// Smoke test: connect to the MCP server over stdio and exercise the discovery
// tools (which work offline from the bundled spec). Run: npm run smoke
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["index.mjs"],
  env: { ...process.env },
});
const client = new Client({ name: "smoke", version: "0.0.0" }, { capabilities: {} });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const list = await client.callTool({
  name: "simorg_list_endpoints",
  arguments: { tag: "general" },
});
console.log("\n[list_endpoints tag=general]\n" + list.content[0].text);

const desc = await client.callTool({
  name: "simorg_describe_endpoint",
  arguments: { method: "GET", path: "/api/v1/classrooms" },
});
console.log("\n[describe GET /api/v1/classrooms]\n" + desc.content[0].text.slice(0, 400));

const call = await client.callTool({
  name: "simorg_call",
  arguments: { path: "/api/v1/classrooms", instance: "FR" },
});
console.log("\n[call GET /api/v1/classrooms instance=FR]\n" + call.content[0].text.slice(0, 300));

await client.close();
