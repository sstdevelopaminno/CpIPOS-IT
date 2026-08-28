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
  is_active: boolean | null;
  last_seen_at: string | null;
  metadata: Record<string, unknown> | null;
};

type HealthRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  pos_device_id: string | null;
  device_code: string;
  machine_id: string | null;
  hostname: string | null;
  app_version: string | null;
  runtime_version: string | null;
  status: string | null;
  summary: Record<string, unknown> | null;
  identity: Record<string, unknown> | null;
  connectivity: Record<string, unknown> | null;
  system_health: Record<string, unknown> | null;
  runtime_health: Record<string, unknown> | null;
  peripheral_health: Record<string, unknown> | null;
  offline_sale_health: Record<string, unknown> | null;
  security_signals: Record<string, unknown> | null;
  last_error: string | null;
  captured_at: string | null;
  last_seen_at: string | null;
};

type EnrollmentRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  device_code: string;
  device_type: string;
  enrollment_status: string;
  trust_level: string;
  approved_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  updated_at: string;
};

type CommandRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  pos_device_id: string;
  command_type: string;
  status: string;
  issued_at: string;
  delivered_at: string | null;
  expires_at: string;
  result: Record<string, unknown> | null;
};

function textParam(value: string | null) {
  return value?.trim() || null;
}

export async function GET(request: Request) {
  const startedAt = Date.now();

  try {
    const { supabase, itSupabase } = await requireItAdmin();
    const { searchParams } = new URL(request.url);
    const tenantId = textParam(searchParams.get("tenant_id"));
    const branchId = textParam(searchParams.get("branch_id"));

    let deviceQuery = itSupabase
      .from("it_devices")
      .select(
        "id,tenant_id,branch_id,device_code,device_name,device_type,status,is_locked,is_active,last_seen_at,metadata"
      )
      .order("last_seen_at", { ascending: false, nullsFirst: false })
      .limit(500);

    if (tenantId) deviceQuery = deviceQuery.eq("tenant_id", tenantId);
    if (branchId) deviceQuery = deviceQuery.eq("branch_id", branchId);

    const { data: deviceData, error: deviceError } = await deviceQuery.returns<ItDeviceRow[]>();
    if (deviceError) throw new Error(`it_devices_query_failed:${deviceError.message}`);

    const devices = deviceData ?? [];
    if (devices.length === 0) {
      const response = ok({
        devices: [],
        generated_at: new Date().toISOString(),
        integration: { identity_plane: "CpiPOS-001", operational_plane: "CpiPOS-002" }
      });
      response.headers.set("cache-control", "no-store");
      response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
      return response;
    }

    const deviceCodes = Array.from(new Set(devices.map((row) => row.device_code).filter(Boolean)));
    const deviceIds = Array.from(new Set(devices.map((row) => row.id).filter(Boolean)));

    const [healthResult, enrollmentResult, commandResult] = await Promise.all([
      itSupabase
        .from("it_device_health_latest")
        .select(
          "id,tenant_id,branch_id,pos_device_id,device_code,machine_id,hostname,app_version,runtime_version,status,summary,identity,connectivity,system_health,runtime_health,peripheral_health,offline_sale_health,security_signals,last_error,captured_at,last_seen_at"
        )
        .in("device_code", deviceCodes)
        .order("last_seen_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(deviceCodes.length * 3, 50))
        .returns<HealthRow[]>(),
      supabase
        .from("device_enrollments")
        .select(
          "id,tenant_id,branch_id,device_code,device_type,enrollment_status,trust_level,approved_at,revoked_at,last_seen_at,updated_at"
        )
        .in("device_code", deviceCodes)
        .order("updated_at", { ascending: false })
        .limit(Math.max(deviceCodes.length * 3, 50))
        .returns<EnrollmentRow[]>(),
      itSupabase
        .from("it_device_commands")
        .select(
          "id,tenant_id,branch_id,pos_device_id,command_type,status,issued_at,delivered_at,expires_at,result"
        )
        .in("pos_device_id", deviceIds)
        .order("issued_at", { ascending: false })
        .limit(Math.max(deviceIds.length * 5, 100))
        .returns<CommandRow[]>()
    ]);

    if (healthResult.error) throw new Error(`it_device_health_query_failed:${healthResult.error.message}`);
    if (enrollmentResult.error) throw new Error(`device_enrollment_query_failed:${enrollmentResult.error.message}`);
    if (commandResult.error) throw new Error(`it_device_command_query_failed:${commandResult.error.message}`);

    const healthByKey = new Map<string, HealthRow>();
    for (const row of healthResult.data ?? []) {
      const key = `${row.tenant_id}:${row.branch_id}:${row.device_code}`;
      if (!healthByKey.has(key)) healthByKey.set(key, row);
    }

    const enrollmentByKey = new Map<string, EnrollmentRow>();
    for (const row of enrollmentResult.data ?? []) {
      const key = `${row.tenant_id}:${row.branch_id ?? ""}:${row.device_code}`;
      if (!enrollmentByKey.has(key)) enrollmentByKey.set(key, row);
    }

    const commandByDevice = new Map<string, CommandRow>();
    for (const row of commandResult.data ?? []) {
      if (!commandByDevice.has(row.pos_device_id)) commandByDevice.set(row.pos_device_id, row);
    }

    const response = ok({
      devices: devices.map((device) => {
        const scopeKey = `${device.tenant_id}:${device.branch_id}:${device.device_code}`;
        const health = healthByKey.get(scopeKey) ?? null;
        const enrollment = enrollmentByKey.get(scopeKey) ?? null;
        const lastCommand = commandByDevice.get(device.id) ?? null;
        return {
          ...device,
          health,
          enrollment,
          last_command: lastCommand,
          telemetry_state: health?.last_seen_at ? "reporting" : "awaiting_heartbeat",
          pairing_state: enrollment?.enrollment_status ?? "not_enrolled"
        };
      }),
      generated_at: new Date().toISOString(),
      integration: {
        identity_plane: "CpiPOS-001",
        operational_plane: "CpiPOS-002",
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
