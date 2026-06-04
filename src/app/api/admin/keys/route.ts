import { requireAdmin } from "@/lib/admin-auth";
import { jsonResponse } from "@/lib/http";
import { issueKey, listKeys, KeyServiceError } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/admin/keys?email=  → list keys (no secrets)
// POST /api/admin/keys         → issue a key (returns the secret once)

export async function GET(req: Request): Promise<Response> {
  const admin = requireAdmin(req);
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status);

  const email = new URL(req.url).searchParams.get("email") ?? undefined;
  const keys = await listKeys(email);
  return jsonResponse({ keys });
}

export async function POST(req: Request): Promise<Response> {
  const admin = requireAdmin(req);
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  try {
    const issued = await issueKey({
      email: String(body.email ?? ""),
      label: String(body.label ?? ""),
      scope: body.scope == null ? undefined : String(body.scope),
      months: body.months == null ? undefined : Number(body.months),
    });
    return jsonResponse(
      {
        // The plaintext key is shown only in this response — store it now.
        key: issued.plaintext,
        id: issued.id,
        scope: issued.scope,
        email: issued.email,
        expiresAt: issued.expiresAt.toISOString(),
      },
      201,
    );
  } catch (err) {
    if (err instanceof KeyServiceError) return jsonResponse({ error: err.message }, err.status);
    throw err;
  }
}
