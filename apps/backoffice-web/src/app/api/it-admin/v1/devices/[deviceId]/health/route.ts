import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

type BranchDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  status: string;
};

type HealthLatestRow = {
  id: string;
  status: string;
  summary: unknown;
  machine_id: string;
  app_version: string | null;
  runtime_version: string | null;
  last_seen_at: string;
  captured_at: string;
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

export async function GET(_req: Request, context: { params: Promise<{ deviceId: string }> }) {
  const startedAt = Date.now();

  try {
    const { supabase } = await requireItAdmin();
    const { deviceId } = await context.params;
    const id = String(deviceId ?? "").trim();
    if (!id) return fail("invalid_device_id", "Device id is required.", 422);

    const { data: device, error: deviceError } = await supabase
      .from("branch_devices")
      .select("id,tenant_id,branch_id,device_code,device_name,status")
      .eq("id", id)
      .maybeSingle<BranchDeviceRow>();
    if (deviceError) throw new Error(`branch_device_query_failed:${deviceError.message}`);
    if (!device) return fail("device_not_found", "Device was not found.", 404);

    const [healthResult, incidentResult, commandResult] = await Promise.all([
      supabase
        .from("pos_device_health_latest")
        .select("id,status,summary,machine_id,app_version,runtime_version,last_seen_at,captured_at")
        .eq("tenant_id", device.tenant_id)
        .eq("branch_id", device.branch_id)
        .eq("pos_device_id", device.id)
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle<HealthLatestRow>(),
      supabase
        .from("pos_device_incidents")
        .select("id,code,severity,title,message,detected_at,resolved_at")
        .eq("tenant_id", device.tenant_id)
        .eq("branch_id", device.branch_id)
        .eq("pos_device_id", device.id)
        .order("detected_at", { ascending: false })
        .limit(20)
        .returns<IncidentRow[]>(),
      supabase
        .from("device_commands")
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

    const response = ok({
      device,
      health: healthResult.data ?? null,
      incidents: incidentResult.data ?? [],
      commands: commandResult.data ?? [],
      integration: {
        mode: "shared_supabase",
        heartbeat_writer: "cpipos_pos_runtime"
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
