import { handleProxy } from "@/lib/proxy";

// The catch-all SimOrg proxy. Every HTTP method maps to the same handler,
// which enforces auth + scope and forwards to the selected instance.
// Must run on the Node.js runtime (Prisma + Node crypto) and never be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ path: string[] }> };

async function handler(req: Request, ctx: Context): Promise<Response> {
  const { path } = await ctx.params;
  return handleProxy(req, path ?? []);
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
  handler as HEAD,
  handler as OPTIONS,
};
