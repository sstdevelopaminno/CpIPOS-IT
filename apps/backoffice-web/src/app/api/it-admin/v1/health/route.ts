import { readEnv } from "@/lib/env";
import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin, type ItAdminContext } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";

const REQUIRED_SERVER_ENV = [
  "CPIPOS_SUPABASE_URL",
  "CPIPOS_SUPABASE_PUBLISHABLE_KEY",
  "CPIPOS_SUPABASE_SERVICE_ROLE_KEY"
] as const;

const POS_INTEGRATION_TABLES = ["tenants", "branch_devices", "pos_device_health_latest", "device_commands", "mdm_devices", "mdm_commands"] as const;

type ProbeResult = { reachable: boolean; error_code: string | null };

function missingConfiguration(): ProbeResult {
  return { reachable: false, error_code: "server_configuration_missing" };
}

async function probePrimaryTable(
  context: ItAdminContext,
  table: (typeof POS_INTEGRATION_TABLES)[number],
  configured: boolean
) {
  if (!configured) return [table, missingConfiguration()] as const;
  try {
    const { error } = await context.supabase.from(table).select("*", { count: "exact", head: true }).limit(1);
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
    const primaryConfigured = Object.values(requiredEnv).every(Boolean);
    const tableResults = await Promise.all(
      POS_INTEGRATION_TABLES.map((table) => probePrimaryTable(context, table, primaryConfigured))
    );
    const tables = Object.fromEntries(tableResults);
    const primaryReady = primaryConfigured && tableResults.every(([, result]) => result.reachable);
    const primaryErrorCode = tableResults.find(([, result]) => !result.reachable)?.[1].error_code ?? null;

    const response = ok({
      status: primaryReady ? "ready" : "degraded",
      role: "it_control_plane",
      production_url: productionUrl,
      required_env: requiredEnv,
      integration: {
        mode: "single_pos_database",
        authoritative_plane: "CpiPOS-001",
        pos_runtime: "CpIPOS",
        control_plane: "CpIPOS-IT",
        primary_plane_ready: primaryReady,
        primary_plane_error_code: primaryErrorCode,
        reserved_operational_database_is_pos_dependency: false,
        tables
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
