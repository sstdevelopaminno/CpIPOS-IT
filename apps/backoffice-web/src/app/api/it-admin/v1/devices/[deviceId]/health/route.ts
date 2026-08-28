import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

type ItDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  device_type: string | null;
  status: string;
  is_locked: boolean | null;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
};

type HealthLatestRow = {
  id: string;
  pos_device_id: string | null;
  device_code: string;
  status: string;
  summary: Record<string, unknown> | null;
  identity: Record<string, unknown> | null;
  connectivity: Record<string, unknown> | null;
  system_health: Record<string, unknown> | null;
  runtime_health: Record<string, unknown> | null;
  peripheral_health: Record<string, unknown> | null;
  offline_sale_health: Record<string, unknown> | null;
  security_signals: Record<string, unknown> | null;
  machine_id: string | null;
  hostname: string | null;
  app_version: string | null;
  runtime_version: string | null;
  last_error: string | null;
  last_seen_at: string | null;
  captured_at: string | null;
};

type IncidentRow = {
  id: string;
  code: string;
  severity: string;
  title: string;
  message: string;
  detected_at: string;
  resolved_at: string | null;
  metadata: Record<string, unknown> | null;
};

type CommandRow = {
  id: string;
  command_type: string;
  status: string;
  issued_at: string;
  delivered_at: string | null;
  expires_at: string;
  result: Record<string, unknown> | null;
};

export async function GET(_req: Request, context: { params: Promise<{ deviceId: string }> }) {
  const startedAt = Date.now();

  try {
    const { itSupabase } = await requireItAdmin();
    const { deviceId } = await context.params;
    const id = String(deviceId ?? "").trim();
    if (!id) return fail("invalid_device_id", "Device id is required.", 422);

    const { data: device, error: deviceError } = await itSupabase
      .from("it_devices")
      .select("id,tenant_id,branch_id,device_code,device_name,device_type,status,is_locked,last_seen_at,metadata")
      .eq("id", id)
      .maybeSingle<ItDeviceRow>();
    if (deviceError) throw new Error(`it_device_query_failed:${deviceError.message}`);
    if (!device) return fail("device_not_found", "Device was not found.", 404);

    const [healthResult, incidentResult, commandResult] = await Promise.all([
      itSupabase
        .from("it_device_health_latest")
        .select(
          "id,pos_device_id,device_code,status,summary,identity,connectivity,system_health,runtime_health,peripheral_health,offline_sale_health,security_signals,machine_id,hostname,app_version,runtime_version,last_error,last_seen_at,captured_at"
        )
        .eq("tenant_id", device.tenant_id)
        .eq("branch_id", device.branch_id)
        .eq("device_code", device.device_code)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle<HealthLatestRow>(),
      itSupabase
        .from("it_device_incidents")
        .select("id,code,severity,title,message,detected_at,resolved_at,metadata")
        .eq("tenant_id", device.tenant_id)
        .eq("branch_id", device.branch_id)
        .eq("device_code", device.device_code)
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

    const health = healthResult.data ?? null;
    const response = ok({
      device,
      health,
      telemetry_state: health?.last_seen_at ? "reporting" : "awaiting_heartbeat",
      incidents: incidentResult.data ?? [],
      commands: commandResult.data ?? [],
      integration: {
        mode: "split_supabase",
        operational_plane: "CpiPOS-002",
        heartbeat_writer: "cpipos_pos_runtime",
        ack_contract: "device_command.result.execution_status"
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
