import "server-only";

import type { ItAdminContext } from "@/lib/it-admin-guard";

type CompatContext = Pick<ItAdminContext, "supabase" | "itSupabase">;

export type CompatDevice = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  last_seen_at?: string | null;
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
  status: string;
  delivered_at: string | null;
  result: unknown;
  metadata: unknown;
};

type PrimaryCommandRow = {
  id: string;
  status: string;
  delivered_at: string | null;
  result: unknown;
  metadata: unknown;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function primaryCommandId(value: unknown): string | null {
  const id = asObject(value).primary_command_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

async function resolveLegacyDevice(context: CompatContext, device: CompatDevice): Promise<LegacyDeviceRow | null> {
  const [{ data: activeEnrollment, error: enrollmentError }, { data, error }] = await Promise.all([
    context.supabase
      .from("device_enrollments")
      .select("id")
      .eq("tenant_id", device.tenant_id)
      .eq("branch_id", device.branch_id)
      .eq("device_code", device.device_code)
      .eq("enrollment_status", "active")
      .limit(1)
      .maybeSingle<{ id: string }>(),
    context.supabase
      .from("branch_devices")
      .select("id,tenant_id,branch_id,device_code")
      .eq("tenant_id", device.tenant_id)
      .eq("branch_id", device.branch_id)
      .eq("device_code", device.device_code)
      .maybeSingle<LegacyDeviceRow>()
  ]);

  if (enrollmentError) throw new Error(`device_enrollment_query_failed:${enrollmentError.message}`);
  if (error) throw new Error(`legacy_device_query_failed:${error.message}`);
  if (activeEnrollment) return null;
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
      .select("id,tenant_id,branch_id,pos_device_id,pos_session_id,device_code,machine_id,hostname,windows_username,runtime_version,app_version,status,summary,identity,connectivity,system_health,runtime_health,peripheral_health,offline_sale_health,security_signals,metadata,last_error,captured_at,last_seen_at,created_at,updated_at")
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

    const { error: upsertError } = await context.itSupabase
      .from("it_device_health_latest")
      .upsert(payload, { onConflict: "tenant_id,branch_id,pos_device_id,machine_id" });
    if (upsertError) throw new Error(`it_health_mirror_failed:${upsertError.message}`);

    const newestSeenAt = validHealthRows.map((row) => row.last_seen_at).filter(Boolean).sort().slice(-1)[0];
    const currentSeenMs = device.last_seen_at ? Date.parse(device.last_seen_at) : Number.NaN;
    const sourceSeenMs = newestSeenAt ? Date.parse(newestSeenAt) : Number.NaN;
    if (newestSeenAt && Number.isFinite(sourceSeenMs) && (!Number.isFinite(currentSeenMs) || sourceSeenMs > currentSeenMs)) {
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

    const { error: incidentUpsertError } = await context.itSupabase.from("it_device_incidents").upsert(incidentPayload, { onConflict: "id" });
    if (incidentUpsertError) throw new Error(`it_incident_mirror_failed:${incidentUpsertError.message}`);
  }

  return {
    source: "CpiPOS-001",
    legacyPosDeviceId: legacyDevice.id,
    mirroredHealthRows: validHealthRows.length,
    mirroredIncidents: (incidentRows ?? []).length,
    skippedRowsWithoutMachineId
  };
}

export async function reconcilePrimaryDeviceCommands(context: CompatContext, device: CompatDevice) {
  const { data: mirrorRows, error: mirrorError } = await context.itSupabase
    .from("it_device_commands")
    .select("id,status,delivered_at,result,metadata")
    .eq("tenant_id", device.tenant_id)
    .eq("branch_id", device.branch_id)
    .eq("pos_device_id", device.id)
    .order("issued_at", { ascending: false })
    .limit(50)
    .returns<ItCommandRow[]>();

  if (mirrorError) throw new Error(`it_command_query_failed:${mirrorError.message}`);
  const mirrors = mirrorRows ?? [];
  const primaryIds = mirrors.map((row) => primaryCommandId(row.metadata)).filter((id): id is string => Boolean(id));
  if (primaryIds.length === 0) return { reconciled: 0, source: "CpiPOS-001.device_commands" };

  const { data: primaryRows, error: primaryError } = await context.supabase
    .from("device_commands")
    .select("id,status,delivered_at,result,metadata")
    .eq("tenant_id", device.tenant_id)
    .eq("branch_id", device.branch_id)
    .eq("pos_device_id", device.id)
    .in("id", [...new Set(primaryIds)])
    .returns<PrimaryCommandRow[]>();

  if (primaryError) throw new Error(`primary_command_query_failed:${primaryError.message}`);
  const primaryById = new Map((primaryRows ?? []).map((row) => [row.id, row]));
  let reconciled = 0;

  for (const mirror of mirrors) {
    const primaryId = primaryCommandId(mirror.metadata);
    if (!primaryId) continue;
    const primary = primaryById.get(primaryId);
    if (!primary) continue;

    const changed =
      primary.status !== mirror.status ||
      (primary.delivered_at ?? null) !== (mirror.delivered_at ?? null) ||
      JSON.stringify(primary.result ?? {}) !== JSON.stringify(mirror.result ?? {});
    if (!changed) continue;

    const { error: updateError } = await context.itSupabase
      .from("it_device_commands")
      .update({
        status: primary.status,
        delivered_at: primary.delivered_at,
        result: primary.result ?? {},
        metadata: {
          ...asObject(mirror.metadata),
          delivery_authority: "CpiPOS-001.device_commands",
          primary_command_id: primary.id,
          primary_command_status: primary.status,
          primary_command_metadata: asObject(primary.metadata),
          reconciled_at: new Date().toISOString()
        }
      })
      .eq("id", mirror.id)
      .eq("tenant_id", device.tenant_id)
      .eq("branch_id", device.branch_id)
      .eq("pos_device_id", device.id);

    if (updateError) throw new Error(`it_command_reconcile_failed:${updateError.message}`);
    reconciled += 1;
  }

  return { reconciled, source: "CpiPOS-001.device_commands" };
}

export async function syncLegacyDeviceCompatibility(context: CompatContext, device: CompatDevice) {
  const [health, commands] = await Promise.all([
    syncLegacyDeviceHealth(context, device),
    reconcilePrimaryDeviceCommands(context, device)
  ]);
  return { health, commands };
}
