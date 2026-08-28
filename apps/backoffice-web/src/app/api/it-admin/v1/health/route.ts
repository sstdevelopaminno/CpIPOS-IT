import { readEnv } from "@/lib/env";
import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin, type ItAdminContext } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";

const REQUIRED_SERVER_ENV = [
  "CPIPOS_SUPABASE_URL",
  "CPIPOS_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "IT_SUPABASE_URL",
  "IT_SUPABASE_SERVICE_ROLE_KEY"
] as const;

const IT_INTEGRATION_TABLES = ["it_tenants", "it_devices", "it_device_health_latest", "it_device_commands"] as const;

type ProbeResult = { reachable: boolean; error_code: string | null };

function missingConfiguration(): ProbeResult {
  return { reachable: false, error_code: "server_configuration_missing" };
}

async function probeBusinessPlane(context: ItAdminContext, configured: boolean): Promise<ProbeResult> {
  if (!configured) return missingConfiguration();
  try {
    const { error } = await context.supabase.from("users_profiles").select("id", { count: "exact", head: true }).limit(1);
    return { reachable: !error, error_code: error?.code ?? null };
  } catch {
    return { reachable: false, error_code: "probe_failed" };
  }
}

async function probeItTable(context: ItAdminContext, table: (typeof IT_INTEGRATION_TABLES)[number], configured: boolean) {
  if (!configured) return [table, missingConfiguration()] as const;
  try {
    const { error } = await context.itSupabase.from(table).select("*", { count: "exact", head: true }).limit(1);
    return [table, { reachable: !error, error_code: error?.code ?? null }] as const;
  } catch {
    return [table, { reachable: false, error_code: "probe_failed" }] as const;
  }
}

export async function GET() {
  const startedAt = Date.now();

  try {
    const context = await requireItAdmin();
    const requiredEnv = Object.fromEntries(REQUIRED_SERVER_ENV.map((name) => [name, Boolean(readEnv(name))])) as Record<
      (typeof REQUIRED_SERVER_ENV)[number],
      boolean
    >;
    const productionUrl = readEnv("CPIPOS_PRODUCTION_URL") || "https://cp-ipos-web.vercel.app";
    const businessConfigured = requiredEnv.CPIPOS_SUPABASE_URL && requiredEnv.SUPABASE_SERVICE_ROLE_KEY;
    const itConfigured = requiredEnv.IT_SUPABASE_URL && requiredEnv.IT_SUPABASE_SERVICE_ROLE_KEY;

    const [authProbe, itTableResults] = await Promise.all([
      probeBusinessPlane(context, businessConfigured),
      Promise.all(IT_INTEGRATION_TABLES.map((table) => probeItTable(context, table, itConfigured)))
    ]);

    const itTables = Object.fromEntries(itTableResults);
    const envReady = Object.values(requiredEnv).every(Boolean);
    const authPlaneReady = authProbe.reachable;
    const itPlaneReady = itTableResults.every(([, result]) => result.reachable);
    const itPlaneErrorCode = itTableResults.find(([, result]) => !result.reachable)?.[1].error_code ?? null;

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
        auth_plane_error_code: authProbe.error_code,
        data_bridge_ready: itPlaneReady,
        data_bridge_error_code: itPlaneErrorCode,
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
