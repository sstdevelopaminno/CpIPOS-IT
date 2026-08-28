import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { syncLegacyDeviceCompatibility } from "@/lib/legacy-mdm-compat";

type ItDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  status: string;
  last_seen_at: string | null;
};

type HealthLatestRow = {
  id: string;
  status: string;
  summary: unknown;
  identity: unknown;
  connectivity: unknown;
  system_health: unknown;
  runtime_health: unknown;
  peripheral_health: unknown;
  offline_sale_health: unknown;
  security_signals: unknown;
  metadata: unknown;
  last_error: string | null;
  machine_id: string;
  app_version: string | null;
  runtime_version: string | null;
  last_seen_at: string;
  captured_at: string;
  synced_at: string | null;
};

type IncidentRow = {
  id: string;
  code: string;
  severity: string;
  title: string;
  message: string;
  detected_at: string;
  resolved_at: string | null;
};

type CommandRow = {
  id: string;
  command_type: string;
  status: string;
  issued_at: string;
  delivered_at: string | null;
  expires_at: string;
  result: unknown;
};

function isNativeAgentHealth(row: HealthLatestRow) {
  const runtime = String(row.runtime_version ?? "").toLowerCase();
  const machine = String(row.machine_id ?? "").toLowerCase();
  return runtime.includes("android") || runtime.includes("mdm") || machine.startsWith("and-");
}

export async function GET(_req: Request, context: { params: Promise<{ deviceId: string }> }) {
  const startedAt = Date.now();

  try {
    const { supabase, itSupabase } = await requireItAdmin();
    const { deviceId } = await context.params;
    const id = String(deviceId ?? "").trim();
    if (!id) return fail("invalid_device_id", "Device id is required.", 422);

    const { data: device, error: deviceError } = await itSupabase
      .from("it_devices")
      .select("id,tenant_id,branch_id,device_code,device_name,status,last_seen_at")
      .eq("id", id)
      .maybeSingle<ItDeviceRow>();
    if (deviceError) throw new Error(`it_device_query_failed:${deviceError.message}`);
    if (!device) return fail("device_not_found", "Device was not found.", 404);

    let compatibility: Record<string, unknown> = { mode: "native_it_plane", attempted: false };
    try {
      const sync = await syncLegacyDeviceCompatibility({ supabase, itSupabase }, device);
      compatibility = {
        mode: sync.health.source === "CpiPOS-001" ? "legacy_bridge" : "native_it_plane",
        attempted: true,
        ...sync
      };
    } catch (compatError) {
      console.error("[it-admin-mdm] legacy compatibility sync failed", compatError);
      compatibility = {
        mode: "native_it_plane",
        attempted: true,
        warning: compatError instanceof Error ? compatError.message : "legacy_compatibility_sync_failed"
      };
    }

    const [healthResult, incidentResult, commandResult] = await Promise.all([
      itSupabase
        .from("it_device_health_latest")
        .select(
          "id,status,summary,identity,connectivity,system_health,runtime_health,peripheral_health,offline_sale_health,security_signals,metadata,last_error,machine_id,app_version,runtime_version,last_seen_at,captured_at,synced_at"
        )
        .eq("tenant_id", device.tenant_id)
        .eq("branch_id", device.branch_id)
        .eq("pos_device_id", device.id)
        .order("last_seen_at", { ascending: false })
        .limit(20)
        .returns<HealthLatestRow[]>(),
      itSupabase
        .from("it_device_incidents")
        .select("id,code,severity,title,message,detected_at,resolved_at")
        .eq("tenant_id", device.tenant_id)
        .eq("branch_id", device.branch_id)
        .eq("pos_device_id", device.id)
        .order("detected_at", { ascending: false })
        .limit(20)
        .returns<IncidentRow[]>(),
      itSupabase
        .from("it_device_commands")
        .select("id,command_type,status,issued_at,delivered_at,expires_at,result")
        .eq("tenant_id", device.tenant_id)
        .eq("branch_id", device.branch_id)
        .eq("pos_device_id", device.id)
        .order("issued_at", { ascending: false })
        .limit(20)
        .returns<CommandRow[]>()
    ]);

    if (healthResult.error) throw new Error(`device_health_query_failed:${healthResult.error.message}`);
    if (incidentResult.error) throw new Error(`device_incidents_query_failed:${incidentResult.error.message}`);
    if (commandResult.error) throw new Error(`device_commands_query_failed:${commandResult.error.message}`);

    const healthRows = healthResult.data ?? [];
    const latestHeartbeat = healthRows[0] ?? null;
    const nativeHealth = healthRows.find(isNativeAgentHealth) ?? latestHeartbeat;

    const response = ok({
      device,
      health: nativeHealth,
      latest_heartbeat: latestHeartbeat,
      health_sources: healthRows.map((row) => ({
        machine_id: row.machine_id,
        runtime_version: row.runtime_version,
        app_version: row.app_version,
        last_seen_at: row.last_seen_at,
        native_agent: isNativeAgentHealth(row)
      })),
      incidents: incidentResult.data ?? [],
      commands: commandResult.data ?? [],
      integration: {
        mode: "split_supabase",
        operational_plane: "CpiPOS-002",
        heartbeat_writer: "cpipos_pos_runtime",
        compatibility
      }
    });
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
