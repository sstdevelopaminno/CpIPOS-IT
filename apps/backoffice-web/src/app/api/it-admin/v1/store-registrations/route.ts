import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { provisionStore, StoreProvisioningError } from "@/lib/services/it-admin/store-provisioning-service";
import { appendAuditLog } from "@/lib/audit-log";
import { normalizePosSalesModes, type PosSalesModeMap } from "@/lib/pos-sales-modes";

export const dynamic = "force-dynamic";

const fields = "id,submission_key,store_name,business_type,owner_name,owner_email,owner_phone,package_id,sales_modes,trial_days,source,status,tenant_id,created_at,updated_at,activated_at,last_error";
type RecordInput = {
  action?: "edit" | "delete" | "activate";
  id?: string;
  store_name?: string;
  business_type?: string;
  owner_name?: string;
  owner_email?: string;
  owner_phone?: string;
  package_id?: string;
  sales_modes?: Partial<PosSalesModeMap>;
  owner_code?: string;
  owner_pin?: string;
};
const uuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(s);
const clean = (s: unknown, max: number) => typeof s === "string" ? s.trim().slice(0, max) : "";
function validateEdit(input: RecordInput) {
  const row = {
    store_name: clean(input.store_name, 180),
    business_type: clean(input.business_type, 100),
    owner_name: clean(input.owner_name, 180),
    owner_email: clean(input.owner_email, 254).toLowerCase(),
    owner_phone: clean(input.owner_phone, 40),
    package_id: input.package_id,
    sales_modes: normalizePosSalesModes(input.sales_modes)
  };
  if (row.store_name.length < 2 || row.business_type.length < 2 || row.owner_name.length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.owner_email) || !/^[+0-9 ()-]{8,40}$/.test(row.owner_phone) ||
      !uuid(row.package_id) || !Object.values(row.sales_modes).some(Boolean)) {
    throw new ItAdminGuardError("invalid_registration", "ตรวจสอบชื่อร้าน ประเภทร้าน ข้อมูลติดต่อ แพ็กเกจ และโหมดขาย", 422);
  }
  return { ...row, package_id: row.package_id as string };
}
function safely(error: unknown) {
  if (error instanceof StoreProvisioningError) return fail(error.code, error.message, error.status);
  return guardItAdminError(error);
}

export async function GET() {
  try {
    const ctx = await requireItAdmin();
    const [requests, packages] = await Promise.all([
      ctx.supabase.from("store_registration_requests").select(fields).neq("status", "deleted")
        .order("created_at", { ascending: false }).limit(200),
      ctx.supabase.from("subscription_packages")
        .select("id,code,name,status,is_active,quota_mode,monthly_price,max_branches,max_devices,max_users")
        .eq("is_active", true).eq("status", "active").eq("quota_mode", "standard")
        .order("name").limit(50)
    ]);
    if (requests.error) throw requests.error;
    if (packages.error) throw packages.error;
    const response = ok({ requests: requests.data ?? [], packages: packages.data ?? [], truncated: (requests.data?.length ?? 0) === 200 });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return safely(error); }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireItAdmin();
    const rl = await enforceRateLimit({
      namespace: "it_store_registration_actions", key: ctx.auth.userId, max: 20, windowMs: 60_000
    });
    if (!rl.ok) return fail("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);
    const input = await req.json().catch(() => null) as RecordInput | null;
    if (!input || !uuid(input.id) || !["edit", "delete", "activate"].includes(input.action ?? "")) {
      return fail("invalid_registration_action", "คำขอไม่ถูกต้อง", 422);
    }
    const { data: row, error: lookupError } = await ctx.supabase.from("store_registration_requests")
      .select("*").eq("id", input.id).maybeSingle();
    if (lookupError) throw lookupError;
    if (!row || row.status === "deleted") return fail("registration_not_found", "ไม่พบคำขอ", 404);
    if (row.status === "activated") return fail("already_activated", "คำขอนี้เปิดร้านแล้ว ห้ามสร้างร้านซ้ำ", 409);
    if (row.status === "processing") return fail("registration_processing", "กำลังเปิดร้าน โปรดรอตรวจสอบสถานะ", 409);

    if (input.action === "edit") {
      if (row.status === "failed") {
        const prior = await ctx.supabase.from("it_store_provisioning_requests")
          .select("id").eq("request_key", row.provision_request_key).limit(1);
        if (prior.error) throw prior.error;
        if (prior.data?.length) return fail("edit_after_provision_started", "เริ่มสร้างร้านแล้ว แก้คำขอไม่ได้ กรุณาติดต่อผู้ดูแลเพื่อกู้คืน", 409);
      }
      const patch = validateEdit(input);
      const { data, error } = await ctx.supabase.from("store_registration_requests")
        .update({ ...patch, status: "pending", last_error: null, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("status", row.status).select(fields).maybeSingle();
      if (error) throw error;
      if (!data) return fail("registration_changed", "คำขอถูกแก้ไขจากหน้าต่างอื่นแล้ว", 409);
      await appendAuditLog({ actorUserId: ctx.auth.userId, actorRole: "it_admin",
        action: "store_registration_edited", targetTable: "store_registration_requests", targetId: row.id, module: "it_admin" });
      return ok(data);
    }
    if (input.action === "delete") {
      const prior = await ctx.supabase.from("it_store_provisioning_requests").select("id")
        .eq("request_key", row.provision_request_key).limit(1);
      if (prior.error) throw prior.error;
      if (prior.data?.length) return fail("registration_provision_started", "เริ่มสร้างร้านแล้ว ไม่สามารถลบคำขอที่ผูกกับร้านจริงได้", 409);
      const { data, error } = await ctx.supabase.from("store_registration_requests")
        .update({ status: "deleted", deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("status", row.status).select("id").maybeSingle();
      if (error) throw error;
      if (!data) return fail("registration_changed", "คำขอถูกเปลี่ยนสถานะแล้ว", 409);
      await appendAuditLog({ actorUserId: ctx.auth.userId, actorRole: "it_admin",
        action: "store_registration_deleted", targetTable: "store_registration_requests", targetId: row.id, module: "it_admin" });
      return ok({ id: row.id, status: "deleted" });
    }

    const ownerCode = clean(input.owner_code, 6), pin = clean(input.owner_pin, 6);
    if (!/^\d{6}$/.test(ownerCode) || !/^\d{6}$/.test(pin)) {
      return fail("invalid_owner_credentials", "รหัสเจ้าของร้านและ PIN ต้องเป็นตัวเลข 6 หลัก", 422);
    }
    const pkg = await ctx.supabase.from("subscription_packages")
      .select("id,is_active,status,quota_mode,monthly_price,max_devices")
      .eq("id", row.package_id).maybeSingle();
    if (pkg.error) throw pkg.error;
    if (!pkg.data || !pkg.data.is_active || pkg.data.status !== "active" ||
        pkg.data.quota_mode !== "standard" || Number(pkg.data.monthly_price) <= 0 || pkg.data.max_devices < 1) {
      return fail("package_unavailable", "แพ็กเกจไม่พร้อมเปิดทดลองใช้ กรุณาแก้ไขคำขอ", 409);
    }
    const claimed = await ctx.supabase.from("store_registration_requests")
      .update({ status: "processing", last_error: null, updated_at: new Date().toISOString() })
      .eq("id", row.id).eq("status", row.status).select("id").maybeSingle();
    if (claimed.error) throw claimed.error;
    if (!claimed.data) return fail("registration_changed", "คำขอนี้กำลังถูกดำเนินการจากหน้าต่างอื่น", 409);

    try {
      const result = await provisionStore(ctx, {
        request_id: row.provision_request_key,
        store: { name: row.store_name, owner_phone: row.owner_phone },
        package_id: row.package_id,
        contract: { status: "trial", billing_interval: "monthly" },
        initial_branch: { code: "001", name: "สาขาหลัก" },
        owner: { name: row.owner_name, email: row.owner_email, phone: row.owner_phone, employee_code: ownerCode, pin }
      });
      const modes = normalizePosSalesModes(row.sales_modes);
      const contractRow = await ctx.supabase.from("tenant_subscription_contracts")
        .select("id,metadata").eq("id", result.contract.id).eq("tenant_id", result.tenant.id).single();
      if (contractRow.error) throw contractRow.error;
      const meta = contractRow.data?.metadata && typeof contractRow.data.metadata === "object" && !Array.isArray(contractRow.data.metadata)
        ? contractRow.data.metadata as Record<string, unknown> : {};
      const modeSave = await ctx.supabase.from("tenant_subscription_contracts")
        .update({ metadata: { ...meta, sales_modes: modes, registration_request_id: row.id }, updated_at: new Date().toISOString() })
        .eq("id", result.contract.id).eq("tenant_id", result.tenant.id);
      if (modeSave.error) throw modeSave.error;
      const activated = await ctx.supabase.from("store_registration_requests")
        .update({ status: "activated", tenant_id: result.tenant.id, approved_by: ctx.auth.userId,
          activated_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id).eq("status", "processing").select("id").maybeSingle();
      if (activated.error || !activated.data) throw new Error("registration_finalize_failed");
      await appendAuditLog({ tenantId: result.tenant.id, branchId: result.branch.id, actorUserId: ctx.auth.userId,
        actorRole: "it_admin", action: "store_registration_activated", targetTable: "store_registration_requests",
        targetId: row.id, module: "it_admin", metadata: {
          store_code: result.store_code, trial_days: 7, package_id: row.package_id, owner_code: ownerCode,
          device_setup: "requires_real_device_pairing" } });
      return ok({ id: row.id, status: "activated", result });
    } catch (error) {
      const errorCode = error instanceof StoreProvisioningError ? error.code : "registration_activation_incomplete";
      await ctx.supabase.from("store_registration_requests")
        .update({ status: "failed", last_error: errorCode, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("status", "processing");
      return safely(error);
    }
  } catch (error) { return safely(error); }
}
