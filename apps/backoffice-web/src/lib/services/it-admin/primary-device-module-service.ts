import "server-only";

import type { ItAdminContext } from "@/lib/it-admin-guard";
import type { ItAdminModulePayload } from "@/lib/services/it-admin/control-plane-module-service";

type DeviceRow = {
  id: string; tenant_id: string; branch_id: string; device_code: string;
  device_name: string; device_type: string; status: string; is_active: boolean;
  is_locked: boolean; last_seen_at: string | null; metadata: Record<string, unknown> | null
};
type HealthRow = { pos_device_id: string | null; status: string; app_version: string | null;
  runtime_version: string | null; last_seen_at: string; last_error: string | null };
type MdmRow = { tenant_id: string; device_id: string; is_device_owner: boolean;
  is_full_mdm_eligible: boolean; app_version: string; last_heartbeat_at: string | null };
type EnrollmentRow = { tenant_id: string; device_code: string; enrollment_status: string };

export async function loadPrimaryDeviceModule(context: ItAdminContext): Promise<ItAdminModulePayload> {
  // POS and IT share CpiPOS-001 as device, enrollment, health and Full MDM
  // authority. CpiPOS-002 is optional, never a prerequisite for this screen.
  const db = context.supabase;
  const [devices, health, mdm, enrollments, tenants, branches] = await Promise.all([
    db.from("branch_devices")
      .select("id,tenant_id,branch_id,device_code,device_name,device_type,status,is_active,is_locked,last_seen_at,metadata")
      .order("updated_at", { ascending: false }).limit(500).returns<DeviceRow[]>(),
    db.from("pos_device_health_latest")
      .select("pos_device_id,status,app_version,runtime_version,last_seen_at,last_error")
      .order("last_seen_at", { ascending: false }).limit(1000).returns<HealthRow[]>(),
    db.from("mdm_devices")
      .select("tenant_id,device_id,is_device_owner,is_full_mdm_eligible,app_version,last_heartbeat_at")
      .limit(500).returns<MdmRow[]>(),
    db.from("device_enrollments")
      .select("tenant_id,device_code,enrollment_status")
      .order("updated_at", { ascending: false }).limit(500).returns<EnrollmentRow[]>(),
    db.from("tenants").select("id,name").limit(500),
    db.from("branches").select("id,name").limit(500)
  ]);
  for (const item of [devices, health, mdm, enrollments, tenants, branches]) {
    if (item.error) throw new Error(`primary_device_module_query_failed:${item.error.message}`);
  }
  const nameByTenant = new Map((tenants.data ?? []).map(t => [String(t.id), String(t.name)]));
  const nameByBranch = new Map((branches.data ?? []).map(b => [String(b.id), String(b.name)]));
  const healthByDevice = new Map<string, HealthRow>();
  for (const item of health.data ?? []) {
    if (item.pos_device_id && !healthByDevice.has(item.pos_device_id)) healthByDevice.set(item.pos_device_id, item);
  }
  const mdmByDevice = new Map((mdm.data ?? []).map(item => [`${item.tenant_id}:${item.device_id}`, item]));
  const enrollmentByDevice = new Map<string, EnrollmentRow>();
  for (const item of enrollments.data ?? []) {
    const key = `${item.tenant_id}:${item.device_code}`;
    if (!enrollmentByDevice.has(key)) enrollmentByDevice.set(key, item);
  }
  const rows = (devices.data ?? []).map(item => {
    const latest = healthByDevice.get(item.id);
    const mdmDevice = mdmByDevice.get(`${item.tenant_id}:${item.id}`);
    const enrollment = enrollmentByDevice.get(`${item.tenant_id}:${item.device_code}`);
    const metadata = item.metadata ?? {};
    return {
      id: item.id, tenant_id: item.tenant_id, branch_id: item.branch_id,
      tenant: nameByTenant.get(item.tenant_id) ?? item.tenant_id,
      branch: nameByBranch.get(item.branch_id) ?? item.branch_id,
      device: item.device_name || item.device_code, device_code: item.device_code,
      registry_status: item.is_active ? item.status : "inactive",
      health: latest?.status ?? "Not reported",
      app_version: mdmDevice?.app_version ?? latest?.app_version ?? "—",
      runtime_version: latest?.runtime_version ?? "—",
      last_seen_at: latest?.last_seen_at ?? item.last_seen_at,
      mdm_status: enrollment?.enrollment_status ?? "not_enrolled",
      device_owner: mdmDevice?.is_device_owner ?? false,
      full_mdm: mdmDevice?.is_full_mdm_eligible ?? false,
      dual_screen_enabled: metadata.android_dual_screen_enabled !== false,
      locked: item.is_locked
    };
  });
  return {
    plane: "primary", module: "devices", checked_at: new Date().toISOString(),
    summary: {
      total: rows.length,
      active: rows.filter(row => row.registry_status === "active").length,
      health_reported: rows.filter(row => row.health !== "Not reported").length,
      mdm_connected: rows.filter(row => row.mdm_status === "active").length,
      locked: rows.filter(row => row.locked).length
    },
    rows,
    note: "CpiPOS-001: POS registry, heartbeat and approved MDM identity. Registry active does not mean online; Full MDM requires verified Android Device Owner and native capabilities."
  };
}
