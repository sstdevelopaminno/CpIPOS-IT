import "server-only";

import type { ItAdminContext } from "@/lib/it-admin-guard";

type CompatContext = Pick<ItAdminContext, "supabase" | "itSupabase">;

export type CompatDevice = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
};

type LegacyDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
};

type LegacyHealthRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  pos_device_id: string;
  pos_session_id: string | null;
  device_code: string;
  machine_id: string | null;
  hostname: string | null;
  windows_username: string | null;
  runtime_version: string | null;
  app_version: string | null;
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
  captured_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

type LegacyIncidentRow = {
  id: string;
  pos_session_id: string | null;
  device_code: string;
  machine_id: string | null;
  code: string;
  severity: string;
  title: string;
  message: string;
  metadata: unknown;
  detected_at: string;
  resolved_at: string | null;
  created_at: string;
};

type ItCommandRow = {
  id: string;
  command_type: string;
  status: string;
  issued_by_user_id: string | null;
  issued_at: string;
  expires_at: string;
  delivered_at: string | null;
  result: unknown;
  metadata: unknown;
};

type LegacyCommandRow = {
  id: string;
  status: string;
  delivered_at: string | null;
  result: unknown;
  metadata: unknown;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function hasMeaningfulResult(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

async function resolveLegacyDevice(context: CompatContext, device: CompatDevice): Promise<LegacyDeviceRow | null> {
  const { data, error } = await context.supabase
    .from("branch_devices")
    .select("id,tenant_id,branch_id,device_code")
    .eq("tenant_id", device.tenant_id)
    .eq("branch_id", device.branch_id)
    .eq("device_code", device.device_code)
    .maybeSingle<LegacyDeviceRow>();

  if (error) throw new Error(`legacy_device_query_failed:${error.message}`);
  return data ?? null;
}

export async function syncLegacyDeviceHealth(context: CompatContext, device: CompatDevice) {
  const legacyDevice = await resolveLegacyDevice(context, device);
  if (!legacyDevice) {
    return { source: "none", mirroredHealthRows: 0, mirroredIncidents: 0, skippedRowsWithoutMachineId: 0 };
  }

  const [{ data: healthRows, error: healthError }, { data: incidentRows, error: incidentError }] = await Promise.all([
    context.supabase
      .from("pos_device_health_latest")
      .select(
        "id,tenant_id,branch_id,pos_device_id,pos_session_id,device_code,machine_id,hostname,windows_username,runtime_version,app_version,status,summary,identity,connectivity,system_health,runtime_health,peripheral_health,offline_sale_health,security_signals,metadata,last_error,captured_at,last_seen_at,created_at,updated_at"
      )
      .eq("tenant_id", device.tenant_id)
      .eq("branch_id", device.branch_id)
      .eq("pos_device_id", legacyDevice.id)
      .order("last_seen_at", { ascending: false })
      .limit(20)
      .returns<LegacyHealthRow[]>(),
    context.supabase
      .from("pos_device_incidents")
      .select("id,pos_session_id,device_code,machine_id,code,severity,title,message,metadata,detected_at,resolved_at,created_at")
      .eq("tenant_id", device.tenant_id)
      .eq("branch_id", device.branch_id)
      .eq("pos_device_id", legacyDevice.id)
      .order("detected_at", { ascending: false })
      .limit(50)
      .returns<LegacyIncidentRow[]>()
  ]);

  if (healthError) throw new Error(`legacy_health_query_failed:${healthError.message}`);
  if (incidentError) throw new Error(`legacy_incident_query_failed:${incidentError.message}`);

  const syncedAt = new Date().toISOString();
  const validHealthRows = (healthRows ?? []).filter((row) => typeof row.machine_id === "string" && row.machine_id.trim().length > 0);
  const skippedRowsWithoutMachineId = (healthRows ?? []).length - validHealthRows.length;

  if (validHealthRows.length > 0) {
    const payload = validHealthRows.map((row) => ({
      tenant_id: device.tenant_id,
      branch_id: device.branch_id,
      pos_device_id: device.id,
      pos_session_id: row.pos_session_id,
      device_code: device.device_code,
      machine_id: row.machine_id,
      hostname: row.hostname,
      windows_username: row.windows_username,
      runtime_version: row.runtime_version,
      app_version: row.app_version,
      status: row.status,
      summary: row.summary,
      identity: row.identity,
      connectivity: row.connectivity,
      system_health: row.system_health,
      runtime_health: row.runtime_health,
      peripheral_health: row.peripheral_health,
      offline_sale_health: row.offline_sale_health,
      security_signals: row.security_signals,
      metadata: {
        ...asObject(row.metadata),
        compat_source: "CpiPOS-001.pos_device_health_latest",
        legacy_health_id: row.id,
        legacy_pos_device_id: legacyDevice.id,
        compat_synced_at: syncedAt
      },
      last_error: row.last_error,
      captured_at: row.captured_at,
      last_seen_at: row.last_seen_at,
      source_created_at: row.created_at,
      source_updated_at: row.updated_at,
      synced_at: syncedAt
    }));

    const { error } = await context.itSupabase
      .from("it_device_health_latest")
      .upsert(payload, { onConflict: "tenant_id,branch_id,pos_device_id,machine_id" });
    if (error) throw new Error(`it_health_mirror_failed:${error.message}`);

    const newestSeenAt = validHealthRows
      .map((row) => row.last_seen_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    if (newestSeenAt) {
      const { error: deviceUpdateError } = await context.itSupabase
        .from("it_devices")
        .update({ last_seen_at: newestSeenAt, synced_at: syncedAt })
        .eq("id", device.id)
        .eq("tenant_id", device.tenant_id)
        .eq("branch_id", device.branch_id);
      if (deviceUpdateError) throw new Error(`it_device_last_seen_mirror_failed:${deviceUpdateError.message}`);
    }
  }

  if ((incidentRows ?? []).length > 0) {
    const incidentPayload = (incidentRows ?? []).map((row) => ({
      id: row.id,
      latest_id: null,
      snapshot_id: null,
      tenant_id: device.tenant_id,
      branch_id: device.branch_id,
      pos_device_id: device.id,
      pos_session_id: row.pos_session_id,
      device_code: device.device_code,
      machine_id: row.machine_id,
      code: row.code,
      severity: row.severity,
      title: row.title,
      message: row.message,
      metadata: {
        ...asObject(row.metadata),
        compat_source: "CpiPOS-001.pos_device_incidents",
        legacy_incident_id: row.id,
        legacy_pos_device_id: legacyDevice.id,
        compat_synced_at: syncedAt
      },
      detected_at: row.detected_at,
      resolved_at: row.resolved_at,
      source_created_at: row.created_at,
      synced_at: syncedAt
    }));

    const { error } = await context.itSupabase.from("it_device_incidents").upsert(incidentPayload, { onConflict: "id" });
    if (error) throw new Error(`it_incident_mirror_failed:${error.message}`);
  }

  return {
    source: "CpiPOS-001",
    legacyPosDeviceId: legacyDevice.id,
    mirroredHealthRows: validHealthRows.length,
    mirroredIncidents: (incidentRows ?? []).length,
    skippedRowsWithoutMachineId
  };
}

export async function mirrorLegacyDeviceCommand(
  context: CompatContext,
  device: CompatDevice,
  command: {
    id: string;
    command_type: string;
    issued_by_user_id: string;
    issued_at: string;
    expires_at: string;
    result?: unknown;
    metadata?: unknown;
  }
) {
  const legacyDevice = await resolveLegacyDevice(context, device);
  if (!legacyDevice) throw new Error("legacy_device_not_found");

  const { error } = await context.supabase.from("device_commands").upsert(
    {
      id: command.id,
      tenant_id: device.tenant_id,
      branch_id: device.branch_id,
      pos_device_id: legacyDevice.id,
      command_type: command.command_type,
      status: "pending",
      issued_by_user_id: command.issued_by_user_id,
      issued_at: command.issued_at,
      expires_at: command.expires_at,
      delivered_at: null,
      result: command.result ?? {},
      metadata: {
        ...asObject(command.metadata),
        compat_source: "CpIPOS-IT.it_device_commands",
        it_command_id: command.id,
        it_pos_device_id: device.id
      }
    },
    { onConflict: "id" }
  );

  if (error) throw new Error(`legacy_command_mirror_failed:${error.message}`);
  return { source: "CpiPOS-001", legacyPosDeviceId: legacyDevice.id };
}

export async function reconcileLegacyDeviceCommands(context: CompatContext, device: CompatDevice) {
  const legacyDevice = await resolveLegacyDevice(context, device);
  if (!legacyDevice) return { reconciled: 0, source: "none" };

  const { data: itCommands, error: itCommandError } = await context.itSupabase
    .from("it_device_commands")
    .select("id,command_type,status,issued_by_user_id,issued_at,expires_at,delivered_at,result,metadata")
    .eq("tenant_id", device.tenant_id)
    .eq("branch_id", device.branch_id)
    .eq("pos_device_id", device.id)
    .order("issued_at", { ascending: false })
    .limit(50)
    .returns<ItCommandRow[]>();

  if (itCommandError) throw new Error(`it_command_query_failed:${itCommandError.message}`);
  if (!itCommands || itCommands.length === 0) return { reconciled: 0, source: "CpiPOS-001" };

  const ids = itCommands.map((command) => command.id);
  const { data: legacyCommands, error: legacyCommandError } = await context.supabase
    .from("device_commands")
    .select("id,status,delivered_at,result,metadata")
    .eq("tenant_id", device.tenant_id)
    .eq("branch_id", device.branch_id)
    .eq("pos_device_id", legacyDevice.id)
    .in("id", ids)
    .returns<LegacyCommandRow[]>();

  if (legacyCommandError) throw new Error(`legacy_command_query_failed:${legacyCommandError.message}`);

  const itById = new Map(itCommands.map((command) => [command.id, command]));
  let reconciled = 0;
  for (const legacy of legacyCommands ?? []) {
    const current = itById.get(legacy.id);
    if (!current) continue;

    const legacyHasResult = hasMeaningfulResult(legacy.result);
    let nextStatus = legacy.status;
    if (legacyHasResult && (legacy.status === "pending" || legacy.status === "delivered")) {
      nextStatus = "acknowledged";
    }

    const nextMetadata = {
      ...asObject(current.metadata),
      compat_source: "CpiPOS-001.device_commands",
      legacy_pos_device_id: legacyDevice.id,
      legacy_command_status: legacy.status,
      compat_inferred_ack: legacyHasResult && legacy.status !== "acknowledged",
      compat_reconciled_at: new Date().toISOString()
    };

    const changed =
      nextStatus !== current.status ||
      (legacy.delivered_at ?? null) !== (current.delivered_at ?? null) ||
      JSON.stringify(legacy.result ?? {}) !== JSON.stringify(current.result ?? {});
    if (!changed) continue;

    const { error: updateError } = await context.itSupabase
      .from("it_device_commands")
      .update({
        status: nextStatus,
        delivered_at: legacy.delivered_at,
        result: legacy.result ?? {},
        metadata: nextMetadata
      })
      .eq("id", legacy.id)
      .eq("tenant_id", device.tenant_id)
      .eq("branch_id", device.branch_id)
      .eq("pos_device_id", device.id);

    if (updateError) throw new Error(`it_command_reconcile_failed:${updateError.message}`);
    reconciled += 1;
  }

  return { reconciled, source: "CpiPOS-001" };
}

export async function syncLegacyDeviceCompatibility(context: CompatContext, device: CompatDevice) {
  const [health, commands] = await Promise.all([
    syncLegacyDeviceHealth(context, device),
    reconcileLegacyDeviceCommands(context, device)
  ]);
  return { health, commands };
}
