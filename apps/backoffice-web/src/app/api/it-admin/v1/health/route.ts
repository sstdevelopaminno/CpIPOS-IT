import { readEnv } from "@/lib/env";
import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";

const REQUIRED_SERVER_ENV = [
  "CPIPOS_SUPABASE_URL",
  "CPIPOS_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "IT_SUPABASE_URL",
  "IT_SUPABASE_SERVICE_ROLE_KEY"
] as const;

const IT_INTEGRATION_TABLES = ["it_tenants", "it_devices", "it_device_health_latest", "it_device_commands"] as const;

export async function GET() {
  const startedAt = Date.now();

  try {
    const { supabase, itSupabase } = await requireItAdmin();
    const requiredEnv = Object.fromEntries(REQUIRED_SERVER_ENV.map((name) => [name, Boolean(readEnv(name))]));
    const productionUrl = readEnv("CPIPOS_PRODUCTION_URL") || "https://cp-ipos-web.vercel.app";

    const [authProbe, ...itTableResults] = await Promise.all([
      supabase.from("users_profiles").select("id", { count: "exact", head: true }).limit(1).then(({ error }) => [
        "users_profiles",
        { reachable: !error, error_code: error?.code ?? null }
      ] as const),
      ...IT_INTEGRATION_TABLES.map(async (table) => {
        const { error } = await itSupabase.from(table).select("*", { count: "exact", head: true }).limit(1);
        return [table, { reachable: !error, error_code: error?.code ?? null }] as const;
      })
    ]);

    const itTables = Object.fromEntries(itTableResults);
    const envReady = Object.values(requiredEnv).every(Boolean);
    const authPlaneReady = authProbe[1].reachable;
    const itPlaneReady = itTableResults.every(([, result]) => result.reachable);

    const response = ok({
      status: envReady && authPlaneReady && itPlaneReady ? "ready" : "degraded",
      role: "it_control_plane",
      production_url: productionUrl,
      required_env: requiredEnv,
      integration: {
        mode: "split_supabase",
        auth_business_plane: "CpiPOS-001",
        it_operational_plane: "CpiPOS-002",
        pos_runtime: "CpIPOS",
        control_plane: "CpIPOS-IT",
        auth_plane_ready: authPlaneReady,
        data_bridge_ready: itPlaneReady,
        tables: itTables
      },
      checked_at: new Date().toISOString()
    });
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const guarded = guardItAdminError(error);
    guarded.headers.set("cache-control", "no-store");
    guarded.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return guarded;
  }
}
