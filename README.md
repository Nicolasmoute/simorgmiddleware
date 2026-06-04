# SimOrg Middleware

An access-controlled API gateway in front of the [SimOrg](https://simorg.aero)
ERP used by SIM AERO. SimOrg's own API is all-or-nothing: a token grants full
access and cannot be restricted to, say, read-only operations. This middleware
sits in front of both SimOrg instances and issues scoped API keys, so users can
be given read-only access by default and broader access only when an admin
grants it.

It **mirrors the SimOrg API verbatim**, adding exactly one control: an
`instance` selector — `FR`, `SA`, or `ALL`.

> **Status — milestone 1 (this repo): core proxy + auth.**
> Implemented: generic FR/SA/ALL reverse proxy, API-key authentication,
> READ/WRITE scope enforcement, the SQLite/Prisma data model, and a key
> management CLI.
> **Deferred to milestone 2:** Microsoft SSO sign-in (NextAuth v5), the
> self-service 3-month token page, and the admin console UI.

## How it works

```
client ──API key──▶  middleware  ──instance token──▶  SimOrg FR
                         │         ──instance token──▶  SimOrg SA
                         └─ enforces: valid key? not blocked/expired?
                                      method allowed by key scope?
```

- **Authentication.** Every request must carry an issued key, via
  `Authorization: Bearer smk_…` or the `x-api-key` header. Only the SHA-256
  hash of a key is stored; the plaintext is shown once at creation.
- **Authorisation (scope).** Keys are `READ` (default) or `WRITE`. The policy
  is HTTP-method based: `GET`/`HEAD`/`OPTIONS` are reads; everything else needs
  `WRITE`. Only admins issue or upgrade `WRITE` keys.
- **Instance selection.** Pass `?instance=FR|SA|ALL` (or the
  `x-simorg-instance` header). The middleware forwards to the matching instance
  using that instance's full-access SimOrg token (kept server-side only).
- **`ALL` merge.** Both instances are queried concurrently. Because FR and SA
  are independent databases whose ids can collide, every returned object is
  tagged with `_instance` (`"FR"` / `"SA"`). List responses are flattened into
  one tagged array; non-list responses are keyed `{ FR, SA }`. Partial failures
  return HTTP `207` with an `_errors` map.

## Usage

```bash
# Read from the France instance
curl "https://<host>/api/simorg/<simorg-path>?instance=FR" \
  -H "Authorization: Bearer smk_xxx"

# Merge both instances
curl "https://<host>/api/simorg/<simorg-path>?instance=ALL" \
  -H "Authorization: Bearer smk_xxx"

# A write (requires a WRITE-scope key)
curl -X POST "https://<host>/api/simorg/<simorg-path>?instance=SA" \
  -H "Authorization: Bearer smk_xxx" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

`GET /api/health` reports liveness and which instances are configured.

## Local development

```bash
npm install
cp .env.example .env        # fill in SimOrg base URLs + tokens
npm run db:push             # create the SQLite schema
npm run keys seed           # create admin users from ADMIN_EMAILS
npm run keys key:create --email n.moute@sim.aero --label "my key"
npm run dev                 # http://localhost:3000
npm test                    # unit tests (scope + merge logic)
```

## Key management CLI

Until the admin UI lands, manage users and keys with `npm run keys`:

| Command | Description |
| --- | --- |
| `seed` | Create admin users from `ADMIN_EMAILS` |
| `user:add <email> [--admin]` | Create/update a user |
| `user:list` | List users |
| `key:create --email <e> --label <l> [--scope READ\|WRITE] [--months N]` | Issue a key (prints the secret once) |
| `key:list [--email <e>]` | List keys (never shows secrets) |
| `key:scope <keyId> READ\|WRITE` | Change a key's scope |
| `key:block <keyId>` / `key:unblock <keyId>` | Block / unblock a key |

Read-only keys default to a 3-month lifetime (`DEFAULT_KEY_LIFETIME_MONTHS`).

## Configuration

See [`.env.example`](./.env.example). Key variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite location (use a persistent volume on Zeabur) |
| `SIMORG_FR_BASE_URL` / `SIMORG_SA_BASE_URL` | Public API base URL per instance |
| `SIMORG_FR_TOKEN` / `SIMORG_SA_TOKEN` | Full-access SimOrg token per instance (server-side only) |
| `SIMORG_AUTH_HEADER` / `SIMORG_AUTH_SCHEME` | How tokens are presented to SimOrg (default `Authorization: Bearer …`) |
| `ADMIN_EMAILS` | Comma-separated admin emails |
| `DEFAULT_KEY_LIFETIME_MONTHS` | Default key lifetime (3) |

## Deploying to Zeabur

The app is a standard Next.js 16 service. Either let Zeabur's buildpack detect
it (Git deploy) or build the included `Dockerfile`.

1. Create a service from this repository.
2. Set the environment variables above (instance base URLs + tokens, etc.).
3. **Persist the SQLite file:** mount a volume and point `DATABASE_URL` at it,
   e.g. `file:/data/simorg.db`, so issued keys survive redeploys.
4. After first deploy, seed admins: `npm run keys seed` (run in the service
   shell), then issue keys.

## Notes & limitations

- **Read/write classification is method-based.** If SimOrg exposes read
  operations behind `POST` (e.g. complex search endpoints), they would require
  a `WRITE` key today. The intended refinement is a configurable
  path/method allowlist in `src/lib/scope.ts` — see the comment there.
- **The middleware holds full-access SimOrg tokens.** They are never forwarded
  to clients; client auth headers are stripped before forwarding upstream.
