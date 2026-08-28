import { readEnv } from "@/lib/env";
import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";

const REQUIRED_SERVER_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

const INTEGRATION_TABLES = ["tenants", "branch_devices", "pos_device_health_latest", "device_commands"] as const;

export async function GET() {
  const startedAt = Date.now();

  try {
    const { supabase } = await requireItAdmin();
    const requiredEnv = Object.fromEntries(REQUIRED_SERVER_ENV.map((name) => [name, Boolean(readEnv(name))]));
    const productionUrl = readEnv("CPIPOS_PRODUCTION_URL") || "https://cp-ipos-web.vercel.app";

    const tableResults = await Promise.all(
      INTEGRATION_TABLES.map(async (table) => {
        const { error } = await supabase.from(table).select("*", { count: "exact", head: true }).limit(1);
        return [table, { reachable: !error, error_code: error?.code ?? null }] as const;
      })
    );
    const integrationTables = Object.fromEntries(tableResults);
    const envReady = Object.values(requiredEnv).every(Boolean);
    const dataBridgeReady = tableResults.every(([, result]) => result.reachable);

    const response = ok({
      status: envReady && dataBridgeReady ? "ready" : "degraded",
      role: "it_control_plane",
      production_url: productionUrl,
      required_env: requiredEnv,
      integration: {
        mode: "shared_supabase",
        pos_runtime: "CpIPOS",
        control_plane: "CpIPOS-IT",
        data_bridge_ready: dataBridgeReady,
        tables: integrationTables
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
