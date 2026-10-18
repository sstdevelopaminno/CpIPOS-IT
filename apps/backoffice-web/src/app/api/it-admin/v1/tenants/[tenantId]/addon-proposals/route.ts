import { ok, fail } from "@/lib/http";
import { appendAuditLog } from "@/lib/audit-log";
import { guardItAdminError, requireItAdmin, ItAdminGuardError } from "@/lib/it-admin-guard";
import { readBoundedJson } from "@/lib/server/limited-json";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tenantId: string }> };
type Input = {
  action?: "draft" | "approve" | "cancel"; id?: string;
  addon_type?: "quota" | "feature"; addon_code?: string;
  quantity?: number; unit_price?: number; billing_interval?: string;
  reason?: string;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const quotaAddons = new Set(["extra_branch", "extra_device", "extra_user", "extra_storage_gb"]);
function id(v: unknown) {
  if (typeof v !== "string" || !uuid.test(v)) throw new ItAdminGuardError("invalid_identifier", "Invalid UUID.", 422);
  return v;
}
function onlyAdmin(role: string | null) {
  if (role !== "it_admin") throw new ItAdminGuardError("it_admin_only", "ต้องใช้บัญชี IT Admin เพื่อสร้าง/อนุมัติ Add-on", 403);
}
type Proposal = {
  id: string; tenant_id: string; contract_id: string; addon_type: "quota" | "feature";
  addon_code: string; quantity: number; currency: string; billing_interval: string;
  unit_price: number; total_price: number; state: string; reason: string;
  created_at: string; approved_at: string | null;
};
export async function GET(_req: Request, context: Context) {
  try {
    const admin = await requireItAdmin();
    const tenantId = id((await context.params).tenantId);
    const [tenant, existing, catalog, contract] = await Promise.all([
      admin.supabase.from("tenants").select("id,name").eq("id", tenantId).maybeSingle(),
      admin.supabase.from("it_tenant_addon_proposals").select("*").eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(100).returns<Proposal[]>(),
      admin.supabase.from("package_feature_catalog")
        .select("code,name,is_active,default_monthly_price,default_yearly_price")
        .eq("is_active", true).order("name").limit(100),
      admin.supabase.from("tenant_subscription_contracts").select("currency")
        .eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(1).maybeSingle()
    ]);
    for (const result of [tenant,existing,catalog,contract]) if (result.error) throw result.error;
    if (!tenant.data) return fail("tenant_not_found", "ไม่พบร้าน", 404);
    return ok({ tenant: tenant.data, proposals: existing.data ?? [], features: catalog.data ?? [], contract_currency: contract.data?.currency ?? null,
      note: "Only proposals: no payment, quota or feature entitlement is granted." });
  } catch (error) { return guardItAdminError(error); }
}
export async function POST(req: Request, context: Context) {
  try {
    const admin = await requireItAdmin();
    onlyAdmin(admin.profile.platform_role);
    const tenantId = id((await context.params).tenantId);
    const input = await readBoundedJson<Input>(req, 4096);
    if (input.action === "draft") {
      const tenant = await admin.supabase.from("tenants").select("id,is_active").eq("id",tenantId).maybeSingle();
      if (tenant.error) throw tenant.error;
      if (!tenant.data?.is_active) return fail("inactive_tenant", "ร้านต้องเปิดใช้งานก่อนเตรียมข้อเสนอ", 409);
      const contract = await admin.supabase.from("tenant_subscription_contracts")
        .select("id,status,package_id,currency").eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (contract.error) throw contract.error;
      if (!contract.data || !["trial","active"].includes(contract.data.status)) {
        return fail("contract_not_eligible", "ร้านไม่มีสัญญาที่สามารถเสนอ Add-on ได้", 409);
      }
      const addonType = input.addon_type;
      const code = String(input.addon_code ?? "");
      if (addonType === "quota") {
        if (!quotaAddons.has(code)) return fail("unsupported_quota_addon", "ไม่รองรับประเภทโควตานี้", 422);
      } else if (addonType === "feature") {
        const feature = await admin.supabase.from("package_feature_catalog")
          .select("code,is_active").eq("code", code).maybeSingle();
        if (feature.error) throw feature.error;
        if (!feature.data?.is_active) return fail("feature_not_available", "ไม่พบฟีเจอร์ที่เปิดใช้งาน", 422);
        // Privileged/runtime-sensitive permissions must not be sold by generic add-on approval.
        if (code.startsWith("pos.") || ["core_pos_sales","pin_login","user_management","device_management","branch_management"].includes(code)) {
          return fail("protected_feature", "สิทธิ์แกนหลักต้องจัดการจากสิทธิ์ระบบ ไม่ใช่ Add-on", 403);
        }
      } else return fail("invalid_addon_type", "เลือกประเภท Add-on ให้ถูกต้อง", 422);
      if (!Number.isSafeInteger(input.quantity) || Number(input.quantity) < 1 || Number(input.quantity) > 10000) {
        return fail("invalid_quantity", "จำนวนต้องเป็นเลขจำนวนเต็ม 1-10000", 422);
      }
      if (typeof input.unit_price !== "number" || !Number.isFinite(input.unit_price) || input.unit_price < 0 ||
          input.unit_price > 100000000 || Math.round(input.unit_price * 100) !== input.unit_price * 100) {
        return fail("invalid_unit_price", "ราคา Add-on ต้องเป็นจำนวนเงินตั้งแต่ 0 และไม่เกิน 2 ตำแหน่งทศนิยม", 422);
      }
      if (!["monthly","yearly","one_time"].includes(String(input.billing_interval))) {
        return fail("invalid_billing_interval", "รอบคิดราคาไม่ถูกต้อง", 422);
      }
      const reason = String(input.reason ?? "").trim();
      if (reason.length < 5 || reason.length > 1000) return fail("reason_required", "ระบุรายละเอียด 5-1000 ตัวอักษร", 422);
      const saved = await admin.supabase.from("it_tenant_addon_proposals")
        .insert({
          tenant_id: tenantId, contract_id: contract.data.id, addon_type: addonType,
          addon_code: code, feature_code: addonType === "feature" ? code : null,
          quantity: input.quantity, unit_price: input.unit_price, billing_interval: input.billing_interval,
          currency: contract.data.currency, state: "draft", reason, created_by: admin.auth.userId,
          effective_after_payment: true
        }).select().single<Proposal>();
      if (saved.error) throw saved.error;
      const audit = await appendAuditLog({
        tenantId, actorUserId: admin.auth.userId, actorRole: admin.auth.platformRole,
        action: "it_addon_proposal_drafted", targetTable: "it_tenant_addon_proposals", targetId: saved.data.id,
        afterData: { addon_type: addonType, addon_code: code, quantity: input.quantity, unit_price: input.unit_price,
          billing_interval: input.billing_interval, currency: contract.data.currency },
        metadata: { no_payment: true, no_entitlement: true },
        ipAddress: admin.requestMeta.ipAddress ?? undefined, userAgent: admin.requestMeta.userAgent ?? undefined
      });
      return ok({ proposal: saved.data, audited: audit.inserted }, 201);
    }
    if (input.action === "approve" || input.action === "cancel") {
      const proposalId = id(input.id);
      const current = await admin.supabase.from("it_tenant_addon_proposals")
        .select("*").eq("id", proposalId).eq("tenant_id",tenantId).maybeSingle<Proposal>();
      if (current.error) throw current.error;
      if (!current.data || current.data.state !== "draft") return fail("proposal_changed", "ข้อเสนอนี้ไม่อยู่ในสถานะร่างแล้ว", 409);
      if (input.action === "approve") {
        const contract = await admin.supabase.from("tenant_subscription_contracts")
          .select("id,status").eq("id",current.data.contract_id).eq("tenant_id",tenantId).maybeSingle();
        if (contract.error) throw contract.error;
        if (!contract.data || !["trial","active"].includes(contract.data.status)) {
          return fail("contract_changed", "สัญญาเดิมไม่พร้อมใช้งาน กรุณาสร้างข้อเสนอใหม่", 409);
        }
      }
      const next = input.action === "approve" ? "approved" : "cancelled";
      const patch = next === "approved"
        ? { state: next, approved_by: admin.auth.userId, approved_at: new Date().toISOString() }
        : { state: next };
      const saved = await admin.supabase.from("it_tenant_addon_proposals")
        .update(patch).eq("id",proposalId).eq("tenant_id",tenantId).eq("state","draft")
        .select().maybeSingle<Proposal>();
      if (saved.error) throw saved.error;
      if (!saved.data) return fail("proposal_conflict", "ข้อเสนอถูกเปลี่ยนสถานะแล้ว", 409);
      const audit = await appendAuditLog({
        tenantId, actorUserId: admin.auth.userId, actorRole: admin.auth.platformRole,
        action: next === "approved" ? "it_addon_quote_approved" : "it_addon_quote_cancelled",
        targetTable: "it_tenant_addon_proposals", targetId: proposalId,
        beforeData: { state:"draft" }, afterData: { state: next },
        metadata: { no_payment: true, no_entitlement: true },
        ipAddress: admin.requestMeta.ipAddress ?? undefined, userAgent: admin.requestMeta.userAgent ?? undefined
      });
      return ok({ proposal: saved.data, audited: audit.inserted });
    }
    return fail("invalid_action", "Action must be draft, approve or cancel.", 422);
  } catch (error) { return guardItAdminError(error); }
}
