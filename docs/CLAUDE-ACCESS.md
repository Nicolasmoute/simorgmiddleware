# Accessing SimOrg data (incl. with Claude)

This middleware mirrors the [SimOrg](https://simorg.aero) API and adds one
control — an `instance` selector (`FR`, `SA`, or `ALL`). This guide covers how
to call it directly and how to wire it into Claude via the bundled MCP server.

- **Live base URL:** `https://simorgmiddleware.zeabur.app`
- **OpenAPI spec (reference):** [`simorg-openapi.json`](./simorg-openapi.json)
  (also live at `GET /api/simorg/api/v1/docs?instance=FR`)

## 1. Get an API key

Keys are issued by an admin through the admin API (guarded by `ADMIN_TOKEN`):

```bash
curl -X POST https://simorgmiddleware.zeabur.app/api/admin/keys \
  -H "x-admin-token: $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"you@sim.aero","label":"my key"}'
# → { "key": "smk_…", "scope": "READ", "expiresAt": "…" }   (copy the key once)
```

Keys are **READ** by default (GET only) and last 3 months. An admin can grant
`WRITE` (`PATCH /api/admin/keys/:id {"scope":"WRITE"}`) or block a key.

## 2. Call the API directly

```bash
KEY=smk_...

# France
curl "https://simorgmiddleware.zeabur.app/api/simorg/api/v1/classrooms?instance=FR" \
  -H "Authorization: Bearer $KEY"

# South Africa
curl "https://simorgmiddleware.zeabur.app/api/simorg/api/v1/devices?instance=SA" \
  -H "Authorization: Bearer $KEY"

# Both DBs merged (each record tagged with _instance to resolve id overlap)
curl "https://simorgmiddleware.zeabur.app/api/simorg/api/v1/devices?instance=ALL" \
  -H "Authorization: Bearer $KEY"
```

Rules:
- **Path** = `/api/simorg` + the SimOrg path. SimOrg paths live under
  `/api/v1/...` (e.g. `/api/simorg/api/v1/report/all_sessions`).
- **Instance** = `?instance=FR|SA|ALL` (or header `x-simorg-instance`). Required.
- **Auth** = `Authorization: Bearer smk_…` (or `x-api-key`).
- A READ key can only `GET`; writes return `403` until an admin grants `WRITE`.

## 3. Use it from Claude (MCP server)

The [`mcp/`](../mcp) folder is a small MCP server that turns the middleware into
tools, handling auth and the instance selector for you. Tools:

- **`simorg_list_endpoints`** — discover endpoints (filter by `tag`, `method`, `search`).
- **`simorg_describe_endpoint`** — parameters/responses for one endpoint.
- **`simorg_call`** — call an endpoint (`path`, `instance`, optional `query`/`body`).

### Setup

```bash
cd mcp && npm install        # one-time
export SIMORG_MW_API_KEY=smk_...   # your issued key
```

**Claude Code** — a [`.mcp.json`](../.mcp.json) is committed at the repo root; it
reads `SIMORG_MW_API_KEY` from your environment (no secret in git). Just export
the key and start Claude Code in this repo.

**Claude Desktop** — add to `claude_desktop_config.json` (use absolute paths):

```json
{
  "mcpServers": {
    "simorg": {
      "command": "node",
      "args": ["/abs/path/to/simorgmiddleware/mcp/index.mjs"],
      "env": {
        "SIMORG_MW_BASE_URL": "https://simorgmiddleware.zeabur.app",
        "SIMORG_MW_API_KEY": "smk_...",
        "SIMORG_MW_DEFAULT_INSTANCE": "FR"
      }
    }
  }
}
```

Then ask Claude things like *"list the SimOrg report endpoints"* or *"get all
devices from both instances"* and it will use the tools.

Environment variables: `SIMORG_MW_BASE_URL` (default the live URL),
`SIMORG_MW_API_KEY` (required to call), `SIMORG_MW_DEFAULT_INSTANCE` (optional).

## 4. What's exposed

The middleware is a generic pass-through: the **entire** SimOrg API is reachable
(`Simorg API 1.0.0`, 77 endpoints). Access is gated by **HTTP method**, not by
endpoint — a READ key reaches every `GET`; writes need a `WRITE` key.

| Area (tag) | Reads (GET) | Writes (POST/PUT/PATCH/DELETE) |
| --- | --- | --- |
| report | 31 | — |
| parts | 9 | 8 |
| general | 6 | — |
| slot (FFS bookings) | 2 | 7 |
| Sales Invoice | 2 | 2 |
| customer | — | 4 |
| maintenance | — | 2 |
| stocktake (+ counting/filters) | 3 | 1 |
| ato | — | 1 |
| **Total** | **53** | **24** |

All reads are genuine `GET`s (no POST-based "search" endpoints), so a read-only
key cleanly reaches every read function. See
[`simorg-openapi.json`](./simorg-openapi.json) for the full, authoritative list.

## Security notes

- The middleware holds SimOrg's OAuth2 client credentials server-side and
  obtains/caches access tokens itself; clients never see them. Client auth
  headers are stripped before forwarding upstream.
- Keys are stored only as SHA-256 hashes; the plaintext is shown once.
- Never commit `SIMORG_MW_API_KEY` or `ADMIN_TOKEN`.
