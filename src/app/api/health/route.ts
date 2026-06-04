import { jsonResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight liveness probe for Zeabur / uptime checks. Reports which
// instances are configured without revealing any secrets.
export function GET(): Response {
  const instances = {
    FR: Boolean(process.env.SIMORG_FR_BASE_URL && process.env.SIMORG_FR_TOKEN),
    SA: Boolean(process.env.SIMORG_SA_BASE_URL && process.env.SIMORG_SA_TOKEN),
  };
  return jsonResponse({ status: "ok", instances });
}
