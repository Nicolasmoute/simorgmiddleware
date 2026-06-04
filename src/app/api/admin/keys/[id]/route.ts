import { requireAdmin } from "@/lib/admin-auth";
import { jsonResponse } from "@/lib/http";
import { revokeKey, setKeyBlocked, setKeyScope, KeyServiceError } from "@/lib/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH  /api/admin/keys/:id  → { scope?: "READ"|"WRITE", blocked?: boolean }
// DELETE /api/admin/keys/:id  → revoke (delete) the key

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Context): Promise<Response> {
  const admin = requireAdmin(req);
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status);

  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Request body must be valid JSON." }, 400);
  }

  if (body.scope === undefined && body.blocked === undefined) {
    return jsonResponse({ error: "Provide at least one of: scope, blocked." }, 400);
  }

  try {
    if (body.scope !== undefined) await setKeyScope(id, String(body.scope));
    if (body.blocked !== undefined) await setKeyBlocked(id, Boolean(body.blocked));
    return jsonResponse({ ok: true, id });
  } catch (err) {
    if (err instanceof KeyServiceError) return jsonResponse({ error: err.message }, err.status);
    throw err;
  }
}

export async function DELETE(req: Request, ctx: Context): Promise<Response> {
  const admin = requireAdmin(req);
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status);

  const { id } = await ctx.params;
  try {
    await revokeKey(id);
    return jsonResponse({ ok: true, id, revoked: true });
  } catch (err) {
    if (err instanceof KeyServiceError) return jsonResponse({ error: err.message }, err.status);
    throw err;
  }
}
