import { jsonResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lightweight liveness probe for Zeabur / uptime checks. Reports which
// instances are configured (OAuth client credentials present) without
// revealing any secrets.
export function GET(): Response {
  const configured = (i: "FR" | "SA") =>
    Boolean(
      process.env[`SIMORG_${i}_BASE_URL`] &&
        process.env[`SIMORG_${i}_CLIENT_ID`] &&
        process.env[`SIMORG_${i}_CLIENT_SECRET`] &&
        (process.env[`SIMORG_${i}_TOKEN_URL`] || process.env.SIMORG_TOKEN_URL),
    );
  return jsonResponse({ status: "ok", instances: { FR: configured("FR"), SA: configured("SA") } });
}
