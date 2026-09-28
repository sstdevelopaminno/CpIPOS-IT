import { readBoundedJson } from "@/lib/server/limited-json";
import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { provisionStore, StoreProvisioningError } from "@/lib/services/it-admin/store-provisioning-service";
import { appendAuditLog } from "@/lib/audit-log";
import { normalizePosSalesModes, type PosSalesModeMap } from "@/lib/pos-sales-modes";
import { buildStoreActivationEmail, customerEmailProblem, deliverCustomerEmail } from "@/lib/services/it-admin/customer-email-service";

export const dynamic = "force-dynamic";

const fields = "id,submission_key,store_name,business_type,owner_name,owner_email,owner_phone,package_id,sales_modes,custom_requirements,custom_terms,trial_days,source,status,tenant_id,created_at,updated_at,activated_at,last_error";
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
  custom_requirements?: string;
  custom_terms?: {
    monthly_price?: number;
    yearly_price?: number;
    monthly_discount_percent?: number;
    yearly_discount_percent?: number;
    max_branches?: number;
    max_devices?: number;
    max_users?: number;
    retention_months?: number;
    max_products?: number | null;
    monthly_bill_limit?: number | null;
    storage_limit_gb?: number | null;
    notes?: string;
  } | null;
  owner_code?: string;
  owner_pin?: string;
};
const uuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
const clean = (s: unknown, max: number) => typeof s === "string" ? s.trim().slice(0, max) : "";

type ApprovedCustomTerms = {
  monthly_price: number;
  yearly_price: number;
  monthly_discount_percent: number;
  yearly_discount_percent: number;
  max_branches: number;
  max_devices: number;
  max_users: number;
  retention_months: number;
  max_products: number | null;
  monthly_bill_limit: number | null;
  storage_limit_gb: number | null;
  feature_overrides: Record<string, boolean>;
  notes: string | null;
};

function finiteNumber(value: unknown, min: number, max: number, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ItAdminGuardError("invalid_custom_terms", `${label} ไม่ถูกต้อง`, 422);
  }
  return parsed;
}

function optionalPositiveInt(value: unknown, max: number, label: string) {
  if (value === null || value === undefined || value === "") return null;
  return Math.trunc(finiteNumber(value, 1, max, label));
}

function optionalPositive(value: unknown, max: number, label: string) {
  if (value === null || value === undefined || value === "") return null;
  return Number(finiteNumber(value, 0.01, max, label).toFixed(2));
}

function sanitizeCustomTerms(value: RecordInput["custom_terms"]): ApprovedCustomTerms {
  if (!value || typeof value !== "object") {
    throw new ItAdminGuardError("custom_terms_required", "กรุณากำหนดรายละเอียด CUSTOM ก่อนเปิดร้าน", 422);
  }
  const monthlyPrice = Number(finiteNumber(value.monthly_price, 0, 10_000_000, "ราคารายเดือน").toFixed(2));
  if (monthlyPrice <= 0) {
    throw new ItAdminGuardError("custom_monthly_price_required", "CUSTOM ต้องกำหนดราคารายเดือนมากกว่า 0", 422);
  }
  return {
    monthly_price: monthlyPrice,
    yearly_price: Number(finiteNumber(value.yearly_price ?? 0, 0, 100_000_000, "ราคารายปี").toFixed(2)),
    monthly_discount_percent: Number(finiteNumber(value.monthly_discount_percent ?? 0, 0, 100, "ส่วนลดรายเดือน").toFixed(2)),
    yearly_discount_percent: Number(finiteNumber(value.yearly_discount_percent ?? 0, 0, 100, "ส่วนลดรายปี").toFixed(2)),
    max_branches: Math.trunc(finiteNumber(value.max_branches, 1, 10_000, "จำนวนสาขา")),
    max_devices: Math.trunc(finiteNumber(value.max_devices, 1, 10_000, "จำนวนเครื่องขาย")),
    max_users: Math.trunc(finiteNumber(value.max_users, 1, 100_000, "จำนวนผู้ใช้งาน")),
    retention_months: Math.trunc(finiteNumber(value.retention_months, 1, 120, "ระยะเก็บข้อมูล")),
    max_products: optionalPositiveInt(value.max_products, 10_000_000, "จำนวนสินค้า"),
    monthly_bill_limit: optionalPositiveInt(value.monthly_bill_limit, 100_000_000, "จำนวนบิล"),
    storage_limit_gb: optionalPositive(value.storage_limit_gb, 1_000_000, "Storage"),
    feature_overrides: {},
    notes: clean(value.notes, 1000) || null
  };
}
function validateEdit(input: RecordInput) {
  const row = {
    store_name: clean(input.store_name, 180),
    business_type: clean(input.business_type, 100),
    owner_name: clean(input.owner_name, 180),
    owner_email: clean(input.owner_email, 254).toLowerCase(),
    owner_phone: clean(input.owner_phone, 40),
    package_id: input.package_id,
    sales_modes: normalizePosSalesModes(input.sales_modes),
    custom_requirements: clean(input.custom_requirements, 1500) || null
  };
  if (row.store_name.length < 2 || row.business_type.length < 2 || row.owner_name.length < 2 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.owner_email) || !/^[+0-9 ()-]{8,40}$/.test(row.owner_phone) ||
      !uuid(row.package_id) || !Object.values(row.sales_modes).some(Boolean)) {
    throw new ItAdminGuardError("invalid_registration", "ตรวจสอบชื่อร้าน ประเภทร้าน ข้อมูลติดต่อ แพ็กเกจ และโหมดขาย", 422);
  }
  const emailIssue = customerEmailProblem(row.owner_email);
  if (emailIssue) throw new ItAdminGuardError("invalid_owner_email", emailIssue, 422);
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
        .eq("is_active", true).eq("status", "active")
        .in("quota_mode", ["standard","custom"])
        .order("display_order", { ascending: true, nullsFirst: false }).order("name").limit(50)
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
    const input = await readBoundedJson<RecordInput | null>(req, 16_384);
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
      assertItSupportAction(ctx, "IT Admin ไม่มีสิทธิ์ลบคำขอเปิดร้าน; ใช้ IT Support สำหรับการลบ");
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
    const ownerEmailIssue = customerEmailProblem(row.owner_email);
    if (ownerEmailIssue) return fail("invalid_owner_email", ownerEmailIssue, 422);
    const pkg = await ctx.supabase.from("subscription_packages")
      .select("id,code,is_active,status,quota_mode,monthly_price,max_devices")
      .eq("id", row.package_id).maybeSingle();
    if (pkg.error) throw pkg.error;
    const isCustom = pkg.data?.quota_mode === "custom" || pkg.data?.code === "custom";
    if (!pkg.data || !pkg.data.is_active || pkg.data.status !== "active" ||
        !["standard","custom"].includes(pkg.data.quota_mode) ||
        (!isCustom && (Number(pkg.data.monthly_price) <= 0 || Number(pkg.data.max_devices ?? 0) < 1))) {
      return fail("package_unavailable", "แพ็กเกจไม่พร้อมเปิดทดลองใช้ กรุณาแก้ไขคำขอ", 409);
    }
    const approvedCustomTerms = isCustom ? sanitizeCustomTerms(input.custom_terms) : null;
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
      const now = new Date().toISOString();

      if (approvedCustomTerms) {
        const termsSave = await ctx.supabase.from("tenant_custom_package_terms")
          .upsert({
            tenant_id: result.tenant.id,
            package_id: row.package_id,
            status: "approved",
            ...approvedCustomTerms,
            approved_by: ctx.auth.userId,
            approved_at: now,
            updated_at: now
          }, { onConflict: "tenant_id" })
          .select("version")
          .single<{ version: number }>();
        if (termsSave.error) throw termsSave.error;

        const modeSave = await ctx.supabase.from("tenant_subscription_contracts")
          .update({
            max_branches: approvedCustomTerms.max_branches,
            branch_limit: approvedCustomTerms.max_branches,
            max_devices: approvedCustomTerms.max_devices,
            terminal_limit_per_branch: approvedCustomTerms.max_devices,
            max_users: approvedCustomTerms.max_users,
            metadata: {
              ...meta,
              sales_modes: modes,
              registration_request_id: row.id,
              custom_terms_version: termsSave.data.version,
              custom_registration_approved: true
            },
            updated_at: now
          })
          .eq("id", result.contract.id).eq("tenant_id", result.tenant.id);
        if (modeSave.error) throw modeSave.error;

        const branchPolicy = await ctx.supabase.from("branch_login_policies")
          .update({ max_devices: approvedCustomTerms.max_devices, updated_at: now })
          .eq("tenant_id", result.tenant.id).eq("branch_id", result.branch.id);
        if (branchPolicy.error) throw branchPolicy.error;

        const lifecycleResult = await ctx.supabase.from("tenant_data_lifecycle")
          .select("metadata").eq("tenant_id", result.tenant.id).maybeSingle<{ metadata: Record<string, unknown> | null }>();
        if (lifecycleResult.error) throw lifecycleResult.error;
        const lifecycleMeta = lifecycleResult.data?.metadata && typeof lifecycleResult.data.metadata === "object"
          ? lifecycleResult.data.metadata : {};
        const lifecycleSave = await ctx.supabase.from("tenant_data_lifecycle")
          .update({
            metadata: {
              ...lifecycleMeta,
              sales_retention_months: approvedCustomTerms.retention_months,
              custom_terms_version: termsSave.data.version
            },
            updated_at: now
          }).eq("tenant_id", result.tenant.id);
        if (lifecycleSave.error) throw lifecycleSave.error;
      } else {
        const modeSave = await ctx.supabase.from("tenant_subscription_contracts")
          .update({ metadata: { ...meta, sales_modes: modes, registration_request_id: row.id }, updated_at: now })
          .eq("id", result.contract.id).eq("tenant_id", result.tenant.id);
        if (modeSave.error) throw modeSave.error;
      }
      const activated = await ctx.supabase.from("store_registration_requests")
        .update({ status: "activated", tenant_id: result.tenant.id, approved_by: ctx.auth.userId,
          custom_terms: approvedCustomTerms, activated_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id).eq("status", "processing").select("id").maybeSingle();
      if (activated.error || !activated.data) throw new Error("registration_finalize_failed");
      await appendAuditLog({ tenantId: result.tenant.id, branchId: result.branch.id, actorUserId: ctx.auth.userId,
        actorRole: "it_admin", action: "store_registration_activated", targetTable: "store_registration_requests",
        targetId: row.id, module: "it_admin", metadata: {
          store_code: result.store_code, trial_days: 7, package_id: row.package_id, owner_code: ownerCode,
          package_mode: approvedCustomTerms ? "custom" : "standard",
          custom_retention_months: approvedCustomTerms?.retention_months ?? null,
          device_setup: "requires_real_device_pairing" } });

      let emailDelivery: { status: string; delivery_id?: string; message?: string } = {
        status: "failed",
        message: "ยังไม่ได้ส่งอีเมลเปิดระบบ"
      };
      try {
        const settings = await ctx.supabase.from("it_communication_settings")
          .select("support_email").eq("id", "default").maybeSingle<{ support_email: string }>();
        const message = buildStoreActivationEmail({
          storeName: result.tenant.name || row.store_name,
          storeCode: result.store_code,
          ownerName: row.owner_name,
          ownerCode,
          trialExpiresAt: result.lifecycle.trial_expires_at,
          supportEmail: settings.data?.support_email || "cuttingpointtech.support@gmail.com"
        });
        emailDelivery = await deliverCustomerEmail({
          db: ctx.supabase,
          eventType: "store_activation",
          sourceId: row.id,
          tenantId: result.tenant.id,
          to: row.owner_email,
          message,
          triggerMode: "automatic",
          actorUserId: ctx.auth.userId
        });
        await appendAuditLog({
          tenantId: result.tenant.id,
          branchId: result.branch.id,
          actorUserId: ctx.auth.userId,
          actorRole: "it_admin",
          action: "customer_activation_email_auto_attempt",
          targetTable: "customer_email_deliveries",
          targetId: emailDelivery.delivery_id,
          module: "it_admin",
          metadata: { registration_id: row.id, delivery_status: emailDelivery.status },
          ipAddress: ctx.requestMeta.ipAddress ?? undefined,
          userAgent: ctx.requestMeta.userAgent ?? undefined
        });
      } catch (emailError) {
        console.error("[it-mail] activation email failed without rolling back store activation",
          emailError instanceof Error ? emailError.message : emailError);
      }

      return ok({ id: row.id, status: "activated", result, email_delivery: emailDelivery });
    } catch (error) {
      const errorCode = error instanceof StoreProvisioningError ? error.code : "registration_activation_incomplete";
      await ctx.supabase.from("store_registration_requests")
        .update({ status: "failed", last_error: errorCode, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("status", "processing");
      return safely(error);
    }
  } catch (error) { return safely(error); }
}
