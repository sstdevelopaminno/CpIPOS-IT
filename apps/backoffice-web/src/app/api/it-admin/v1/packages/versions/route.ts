import { ok, fail } from "@/lib/http";
import { appendAuditLog } from "@/lib/audit-log";
import { guardItAdminError, requireItAdmin, ItAdminGuardError } from "@/lib/it-admin-guard";
import { readBoundedJson } from "@/lib/server/limited-json";
export const dynamic = "force-dynamic";

type CatalogVersion = {
  id: string; package_id: string; version_no: number; state: string;
  effective_at: string; proposed_terms: Record<string, unknown>; reason: string;
  created_by: string; approved_by: string | null; created_at: string;
};
type Input = {
  action?: "draft" | "approve" | "retire";
  id?: string; package_id?: string; reason?: string; effective_at?: string;
  monthly_price?: number; yearly_price?: number | null;
  max_branches?: number; max_devices?: number; max_users?: number;
  retention_months?: number | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireId(id: unknown) {
  if (typeof id !== "string" || !uuid.test(id)) throw new ItAdminGuardError("invalid_id", "Invalid catalog identifier.", 422);
  return id;
}
function requireReason(value: unknown) {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length < 5 || reason.length > 1000) throw new ItAdminGuardError("reason_required", "ระบุเหตุผล 5-1000 ตัวอักษร", 422);
  return reason;
}
function money(value: unknown, field: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100000000) {
    throw new ItAdminGuardError("invalid_catalog_price", field + " is invalid.", 422);
  }
  return Number(value.toFixed(2));
}
function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100000) {
    throw new ItAdminGuardError("invalid_catalog_quota", field + " is invalid.", 422);
  }
  return Number(value);
}
function onlyAdmin(role: string | null) {
  if (role !== "it_admin") throw new ItAdminGuardError("it_admin_only", "รายการนี้ต้องใช้บัญชี IT Admin", 403);
}
export async function GET(req: Request) {
  try {
    const admin = await requireItAdmin();
    const packageId = new URL(req.url).searchParams.get("package_id");
    if (packageId) requireId(packageId);
    let query = admin.supabase.from("it_package_catalog_versions")
      .select("id,package_id,version_no,state,effective_at,proposed_terms,reason,created_by,approved_by,created_at")
      .order("created_at", { ascending: false }).limit(100);
    if (packageId) query = query.eq("package_id", packageId);
    const rows = await query.returns<CatalogVersion[]>();
    if (rows.error) throw rows.error;
    return ok({ versions: rows.data ?? [], note: "Approved versions are documentary only; not live catalog prices." });
  } catch (error) { return guardItAdminError(error); }
}
export async function POST(req: Request) {
  try {
    const admin = await requireItAdmin();
    onlyAdmin(admin.profile.platform_role);
    const input = await readBoundedJson<Input>(req, 4096);
    if (input.action === "draft") {
      const packageId = requireId(input.package_id);
      const reason = requireReason(input.reason);
      const start = new Date(String(input.effective_at ?? ""));
      if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) {
        throw new ItAdminGuardError("invalid_effective_date", "วันเริ่มมีผลต้องเป็นเวลาในอนาคต", 422);
      }
      const packageRow = await admin.supabase.from("subscription_packages")
        .select("id,code,quota_mode,name,monthly_price,yearly_price,max_branches,max_devices,max_users,retention_months,monthly_discount_percent,yearly_discount_percent")
        .eq("id", packageId).maybeSingle();
      if (packageRow.error) throw packageRow.error;
      if (!packageRow.data || packageRow.data.quota_mode !== "standard") {
        throw new ItAdminGuardError("standard_catalog_only", "CUSTOM ต้องเสนอราคาต่อร้าน และแพ็กเกจนี้ไม่ใช่มาตรฐาน", 422);
      }
      const current = packageRow.data;
      const monthly = money(input.monthly_price ?? Number(current.monthly_price), "monthly_price");
      const yearly = money(input.yearly_price === undefined ? (current.yearly_price === null ? null : Number(current.yearly_price)) : input.yearly_price, "yearly_price", true);
      if (!monthly || monthly <= 0) throw new ItAdminGuardError("monthly_price_required", "แพ็กเกจมาตรฐานต้องมีราคารายเดือนมากกว่า 0", 422);
      const terms = {
        code: current.code, name: current.name,
        monthly_price: monthly, yearly_price: yearly,
        max_branches: positiveInteger(input.max_branches ?? current.max_branches, "max_branches"),
        max_devices: positiveInteger(input.max_devices ?? current.max_devices ?? 1, "max_devices"),
        max_users: positiveInteger(input.max_users ?? current.max_users ?? 1, "max_users"),
        retention_months: input.retention_months === null ? null :
          positiveInteger(input.retention_months ?? current.retention_months ?? 6, "retention_months"),
        monthly_discount_percent: Number(current.monthly_discount_percent),
        yearly_discount_percent: Number(current.yearly_discount_percent)
      };
      const latest = await admin.supabase.from("it_package_catalog_versions")
        .select("version_no").eq("package_id", packageId).order("version_no", { ascending: false }).limit(1).maybeSingle();
      if (latest.error) throw latest.error;
      const nextVersion = (latest.data?.version_no ?? 0) + 1;
      const saved = await admin.supabase.from("it_package_catalog_versions")
        .insert({ package_id: packageId, version_no: nextVersion, state: "draft",
          effective_at: start.toISOString(), proposed_terms: terms, reason, created_by: admin.auth.userId })
        .select().single<CatalogVersion>();
      if (saved.error?.code === "23505") return fail("version_conflict", "มีการสร้างเวอร์ชันใหม่พร้อมกัน กรุณารีเฟรช", 409);
      if (saved.error) throw saved.error;
      const audit = await appendAuditLog({
        actorUserId: admin.auth.userId, actorRole: admin.auth.platformRole,
        action: "catalog_version_drafted", targetTable: "it_package_catalog_versions", targetId: saved.data.id,
        afterData: terms, metadata: { version: nextVersion, effective_at: start.toISOString(), no_live_package_change: true },
        ipAddress: admin.requestMeta.ipAddress ?? undefined, userAgent: admin.requestMeta.userAgent ?? undefined
      });
      return ok({ version: saved.data, audited: audit.inserted }, 201);
    }
    if (input.action === "approve" || input.action === "retire") {
      const id = requireId(input.id);
      const existing = await admin.supabase.from("it_package_catalog_versions")
        .select().eq("id", id).maybeSingle<CatalogVersion>();
      if (existing.error) throw existing.error;
      if (!existing.data || existing.data.state !== "draft") {
        return fail("draft_not_found", "ดำเนินการได้เฉพาะร่างที่ยังไม่ได้อนุมัติ", 409);
      }
      const nextState = input.action === "approve" ? "approved" : "retired";
      const patch = nextState === "approved"
        ? { state: nextState, approved_by: admin.auth.userId, approved_at: new Date().toISOString() }
        : { state: nextState };
      const saved = await admin.supabase.from("it_package_catalog_versions")
        .update(patch).eq("id", id).eq("state", "draft")
        .select().maybeSingle<CatalogVersion>();
      if (saved.error) throw saved.error;
      if (!saved.data) return fail("catalog_version_conflict", "ร่างถูกแก้ไขโดยผู้ใช้อื่น", 409);
      const audit = await appendAuditLog({
        actorUserId: admin.auth.userId, actorRole: admin.auth.platformRole,
        action: nextState === "approved" ? "catalog_version_approved" : "catalog_version_retired",
        targetTable: "it_package_catalog_versions", targetId: id,
        beforeData: { state: existing.data.state },
        afterData: { state: nextState, version: existing.data.version_no },
        metadata: { no_live_package_change: true, no_customer_repricing: true },
        ipAddress: admin.requestMeta.ipAddress ?? undefined, userAgent: admin.requestMeta.userAgent ?? undefined
      });
      return ok({ version: saved.data, audited: audit.inserted });
    }
    return fail("invalid_action", "Action must be draft, approve or retire.", 422);
  } catch (error) { return guardItAdminError(error); }
}
