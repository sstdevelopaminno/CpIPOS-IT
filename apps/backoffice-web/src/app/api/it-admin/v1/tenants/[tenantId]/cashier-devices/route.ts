import { appendAuditLog } from "@/lib/audit-log";
import { enforceQuota, getTenantLimits } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, parseTenantParam, requireItAdmin, type ItAdminContext } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

type CashierRow = {
  id: string; tenant_id: string; branch_id: string; device_code: string; device_name: string;
  device_type: string; status: string; is_active: boolean; is_locked: boolean;
  last_seen_at: string | null; metadata: Record<string, unknown> | null; updated_at: string;
};
type Payload = { id?: unknown; branch_id?: unknown; device_code?: unknown; device_name?: unknown;
  counter_name?: unknown; location?: unknown; enabled?: unknown };
const SELECT = "id,tenant_id,branch_id,device_code,device_name,device_type,status,is_active,is_locked,last_seen_at,metadata,updated_at";
const DEVICE_CODE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

function stringValue(value: unknown, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function archived(row: CashierRow) {
  return Boolean(row.metadata?.it_cashier_archived_at);
}
function serialize(row: CashierRow) {
  return {
    id: row.id, branch_id: row.branch_id, device_code: row.device_code,
    device_name: row.device_name, status: row.status,
    enabled: row.status === "active" && row.is_active && !archived(row),
    counter_name: stringValue(row.metadata?.counter_name),
    location: stringValue(row.metadata?.location),
    last_seen_at: row.last_seen_at, updated_at: row.updated_at
  };
}
async function ensureBranch(admin: ItAdminContext, tenantId: string, branchId: string, requireActive: boolean) {
  if (!branchId) throw new ItAdminGuardError("branch_required", "กรุณาเลือกสาขา", 422);
  const result = await admin.supabase.from("branches")
    .select("id,is_active").eq("tenant_id", tenantId).eq("id", branchId)
    .maybeSingle<{ id: string; is_active: boolean }>();
  if (result.error) throw result.error;
  if (!result.data) throw new ItAdminGuardError("branch_not_found", "ไม่พบสาขาของร้านนี้", 404);
  if (requireActive && !result.data.is_active) throw new ItAdminGuardError("inactive_branch", "ต้องเปิดสาขาก่อนจึงจะเปิดเครื่องได้", 409);
}
async function getCashier(admin: ItAdminContext, tenantId: string, id: string) {
  if (!id) throw new ItAdminGuardError("device_id_required", "กรุณาเลือกเครื่องแคชเชียร์", 422);
  const result = await admin.supabase.from("branch_devices")
    .select(SELECT).eq("tenant_id", tenantId).eq("id", id).eq("device_type", "pos_terminal")
    .maybeSingle<CashierRow>();
  if (result.error) throw result.error;
  if (!result.data || archived(result.data)) {
    throw new ItAdminGuardError("cashier_not_found", "ไม่พบเครื่องแคชเชียร์ของร้านนี้", 404);
  }
  return result.data;
}
async function revokePosSessions(admin: ItAdminContext, device: CashierRow) {
  const now = new Date().toISOString();
  const byId = await admin.supabase.from("pos_sessions")
    .update({ status: "revoked", revoked_at: now })
    .eq("tenant_id", device.tenant_id).eq("branch_id", device.branch_id)
    .eq("device_id", device.id).eq("status", "active");
  if (byId.error) throw byId.error;
  const byCode = await admin.supabase.from("pos_sessions")
    .update({ status: "revoked", revoked_at: now })
    .eq("tenant_id", device.tenant_id).eq("branch_id", device.branch_id)
    .eq("device_code", device.device_code).eq("status", "active");
  if (byCode.error) throw byCode.error;
}
async function audit(admin: ItAdminContext, device: CashierRow, action: string,
  metadata: Record<string, unknown>) {
  await appendAuditLog({
    tenantId: device.tenant_id, branchId: device.branch_id,
    actorUserId: admin.auth.userId, actorRole: "it_admin",
    action, targetTable: "branch_devices", targetId: device.id,
    metadata: { device_code: device.device_code, ...metadata },
    ipAddress: admin.requestMeta.ipAddress ?? undefined,
    userAgent: admin.requestMeta.userAgent ?? undefined
  });
}
async function checkRate(admin: ItAdminContext) {
  const rate = await enforceRateLimit({
    namespace: "it_cashier_devices", key: admin.auth.userId, max: 30, windowMs: 60_000
  });
  if (!rate.ok) throw new ItAdminGuardError("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);
}

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    const [devicesResult, branchesResult, limits] = await Promise.all([
      admin.supabase.from("branch_devices").select(SELECT).eq("tenant_id", tenantId)
        .eq("device_type", "pos_terminal").order("updated_at", { ascending: false })
        .limit(500).returns<CashierRow[]>(),
      admin.supabase.from("branches").select("id,name,code,is_active")
        .eq("tenant_id", tenantId).order("code"),
      getTenantLimits(tenantId)
    ]);
    if (devicesResult.error) throw devicesResult.error;
    if (branchesResult.error) throw branchesResult.error;
    const devices = (devicesResult.data ?? []).filter(row => !archived(row)).map(serialize);
    const response = ok({
      devices, branches: branchesResult.data ?? [],
      quota_per_branch: limits.maxDevices, contract_status: limits.contractStatus,
      active: devices.filter(row => row.enabled).length,
      total: devices.length,
      package_usage: limits.usage.devices
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    await checkRate(admin);
    const tenantId = parseTenantParam((await context.params).tenantId);
    const body = await request.json().catch(() => null) as Payload | null;
    const branchId = stringValue(body?.branch_id, 50);
    const code = stringValue(body?.device_code, 32).toUpperCase();
    const name = stringValue(body?.device_name, 100);
    const counter = stringValue(body?.counter_name, 100);
    const location = stringValue(body?.location, 160);
    if (!DEVICE_CODE.test(code) || !name) {
      return fail("cashier_invalid_data", "กรุณากรอกรหัสเครื่อง 2–32 ตัว (อังกฤษ ตัวเลข _ -) และชื่อเครื่อง", 422);
    }
    if (typeof body?.enabled !== "boolean") return fail("enabled_required", "enabled ต้องเป็น boolean", 422);
    await ensureBranch(admin, tenantId, branchId, body.enabled);
    if (body.enabled) await enforceQuota(tenantId, "devices", branchId);
    const result = await admin.supabase.from("branch_devices")
      .insert({
        tenant_id: tenantId, branch_id: branchId, device_code: code,
        device_name: name, device_type: "pos_terminal",
        status: body.enabled ? "active" : "inactive",
        is_active: body.enabled, is_locked: !body.enabled,
        metadata: {
          counter_name: counter || null, location: location || null,
          provisioned_from: "it_cashier_control"
        }
      }).select(SELECT).single<CashierRow>();
    if (result.error?.code === "23505") {
      return fail("cashier_code_duplicate", "รหัสเครื่องนี้มีอยู่แล้วในสาขา กรุณาใช้รหัสอื่น", 409);
    }
    if (result.error || !result.data) throw result.error ?? new Error("cashier_create_failed");
    await audit(admin, result.data, "it_cashier_device_created",
      { status: result.data.status, counter_name: counter, location });
    return ok({ device: serialize(result.data) }, 201);
  } catch (error) { return guardItAdminError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    await checkRate(admin);
    const tenantId = parseTenantParam((await context.params).tenantId);
    const body = await request.json().catch(() => null) as Payload | null;
    const current = await getCashier(admin, tenantId, stringValue(body?.id, 50));
    const patch: Record<string, unknown> = {};
    if (body && Object.prototype.hasOwnProperty.call(body, "device_name")) {
      const name = stringValue(body.device_name, 100);
      if (!name) return fail("device_name_required", "ชื่อเครื่องต้องไม่ว่าง", 422);
      patch.device_name = name;
    }
    const metadata = { ...(current.metadata ?? {}) };
    if (body && Object.prototype.hasOwnProperty.call(body, "counter_name")) {
      metadata.counter_name = stringValue(body.counter_name, 100) || null;
      patch.metadata = metadata;
    }
    if (body && Object.prototype.hasOwnProperty.call(body, "location")) {
      metadata.location = stringValue(body.location, 160) || null;
      patch.metadata = metadata;
    }
    if (typeof body?.enabled === "boolean") {
      if (body.enabled && (current.status !== "active" || !current.is_active)) {
        await ensureBranch(admin, tenantId, current.branch_id, true);
        await enforceQuota(tenantId, "devices", current.branch_id);
      }
      patch.status = body.enabled ? "active" : "inactive";
      patch.is_active = body.enabled;
      patch.is_locked = !body.enabled;
    }
    if (!Object.keys(patch).length) return fail("cashier_empty_update", "ยังไม่มีข้อมูลที่ต้องเปลี่ยน", 422);
    // Disconnect sessions before disabling, so no new bill can run under this cashier.
    if (body?.enabled === false && (current.is_active || current.status === "active")) {
      await revokePosSessions(admin, current);
    }
    const result = await admin.supabase.from("branch_devices")
      .update(patch).eq("tenant_id", tenantId).eq("id", current.id)
      .eq("device_type", "pos_terminal").select(SELECT).single<CashierRow>();
    if (result.error || !result.data) throw result.error ?? new Error("cashier_update_failed");
    await audit(admin, result.data, "it_cashier_device_updated", {
      before_status: current.status, after_status: result.data.status,
      before_name: current.device_name, after_name: result.data.device_name
    });
    return ok({ device: serialize(result.data) });
  } catch (error) { return guardItAdminError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    await checkRate(admin);
    const tenantId = parseTenantParam((await context.params).tenantId);
    const body = await request.json().catch(() => null) as Payload | null;
    const current = await getCashier(admin, tenantId, stringValue(body?.id, 50));
    // Never discard sale/shift history or silently close a live cash drawer.
    const openShifts = await admin.supabase.from("shifts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("branch_id", current.branch_id)
      .eq("device_code", current.device_code).eq("status", "open");
    if (openShifts.error) throw openShifts.error;
    if ((openShifts.count ?? 0) > 0) {
      return fail("cashier_open_shift", "เครื่องยังมีกะเปิดอยู่ กรุณาปิดกะก่อนลบเครื่อง", 409);
    }
    const now = new Date().toISOString();
    const result = await admin.supabase.from("branch_devices")
      .update({
        status: "inactive", is_active: false, is_locked: true,
        metadata: {
          ...(current.metadata ?? {}), it_cashier_archived_at: now,
          it_cashier_archived_by: admin.auth.userId
        }
      })
      .eq("tenant_id", tenantId).eq("id", current.id)
      .eq("device_type", "pos_terminal").select(SELECT).single<CashierRow>();
    if (result.error || !result.data) throw result.error ?? new Error("cashier_archive_failed");
    await revokePosSessions(admin, current);
    await audit(admin, result.data, "it_cashier_device_archived", {
      device_name: current.device_name, archived_at: now,
      preserved_history: true
    });
    return ok({ deleted: true, archived: true, id: current.id });
  } catch (error) { return guardItAdminError(error); }
}
