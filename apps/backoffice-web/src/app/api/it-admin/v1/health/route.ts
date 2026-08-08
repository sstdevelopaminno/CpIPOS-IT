import { readEnv } from "@/lib/env";
import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

const REQUIRED_SERVER_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "POS_SESSION_HANDOFF_SECRET",
  "TABLE_QR_SIGNING_SECRET"
] as const;

export async function GET() {
  const startedAt = Date.now();

  try {
    const { supabase } = await requireItAdmin();
    const env = Object.fromEntries(REQUIRED_SERVER_ENV.map((name) => [name, Boolean(readEnv(name))]));

    const { error } = await supabase.from("tenants").select("id", { count: "exact", head: true }).limit(1);
    const response = ok({
      status: error ? "degraded" : "ready",
      production_url: "https://cp-ipos-web.vercel.app",
      supabase_reachable: !error,
      required_env: env,
      table_qr_signing_configured: Boolean(readEnv("TABLE_QR_SIGNING_SECRET")),
      checked_at: new Date().toISOString()
    });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const guarded = guardItAdminError(error);
    guarded.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return guarded;
  }
}
