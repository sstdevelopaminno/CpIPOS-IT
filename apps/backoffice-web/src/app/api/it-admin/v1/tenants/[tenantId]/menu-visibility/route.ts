/** Backward-compatible adapter for early POS menu-control clients.
 * POS and IT now share tenant_pos_menu_policies as the sole authority.
 * Do NOT write tenant_subscription_contracts.metadata.pos_menu_visibility here.
 */
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { POS_MENU_GROUPS, POS_MENU_POLICY_KEYS, normalizePosMenuVisibility } from "@/lib/pos-menu-visibility";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
type ContractRow = { id: string; updated_at: string; status: string };
type RequestBody = { visibility?: Record<string, unknown>; expected_updated_at?: unknown };
type PolicyRow = { menu_key: string; is_enabled: boolean; updated_at: string };
const COMPAT_KEYS: Record<string, string> = {
  sales: "main.sales", sales_list: "main.sales_list",
  kitchen: "main.kitchen", shift: "main.shift",
  more: "main.more", payments: "main.payments", settings: "main.settings",
  sales_summary: "more.sales_summary", receipts: "more.receipts",
  tables: "more.tables", kitchen_manage: "more.kitchen_manage",
  stock: "more.stock", buffet_pricing: "more.buffet",
  members: "more.members", tax_invoices: "more.tax_invoices",
  product_sales: "more.product_sales",
  store: "settings.store", branches: "settings.branches",
  devices: "settings.devices", printers: "settings.printers",
  activity: "settings.activity", settings_payments: "settings.payments",
  inet_nops: "settings.inet_nops", taxes: "settings.taxes",
  notifications: "settings.notifications", users: "settings.users",
  language: "settings.language", menu_placement: "settings.placement",
  display: "settings.display", receipt_alerts: "settings.order_kitchen",
  table_qr: "settings.table_qr"
};
function toLegacy(rows: PolicyRow[]) {
  const byKey = new Map(rows.map(row => [row.menu_key, row.is_enabled]));
  return Object.fromEntries(POS_MENU_POLICY_KEYS.map(key => [
    key, byKey.get(COMPAT_KEYS[key]) !== false
  ]));
}
function version(rows: PolicyRow[], contractUpdatedAt: string) {
  return rows.map(row => row.updated_at).sort().at(-1) ?? contractUpdatedAt;
}
async function load(admin: Awaited<ReturnType<typeof requireItAdmin>>, tenantId: string) {
  const [contract, policies] = await Promise.all([
    admin.supabase.from("tenant_subscription_contracts")
      .select("id,updated_at,status").eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle<ContractRow>(),
    admin.supabase.from("tenant_pos_menu_policies").select("menu_key,is_enabled,updated_at")
      .eq("tenant_id", tenantId).returns<PolicyRow[]>()
  ]);
  if (contract.error) throw contract.error;
  if (policies.error) throw policies.error;
  return { contract: contract.data, rows: policies.data ?? [] };
}

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    const { contract, rows } = await load(admin, tenantId);
    if (!contract) return fail("contract_required", "ร้านนี้ยังไม่มีสัญญาแพ็กเกจให้ตั้งค่านโยบายเมนู", 409);
    const response = ok({
      groups: POS_MENU_GROUPS, visibility: toLegacy(rows),
      updated_at: version(rows, contract.updated_at), contract_status: contract.status
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    const rate = await enforceRateLimit({
      namespace: "it_pos_menu_visibility", key: admin.auth.userId, max: 18, windowMs: 60_000
    });
    if (!rate.ok) return fail("rate_limited", "โปรดลองใหม่อีกครั้งในภายหลัง", 429);
    const body = (await request.json().catch(() => null)) as RequestBody | null;
    if (!body?.visibility || typeof body.visibility !== "object" || Array.isArray(body.visibility)) {
      return fail("invalid_menu_policy", "ต้องส่ง visibility เป็นรายการ boolean ของเมนู", 422);
    }
    if (Object.keys(body.visibility).some(key => !POS_MENU_POLICY_KEYS.includes(key))) {
      return fail("unknown_menu_key", "พบรหัสเมนูที่ระบบ POS ไม่รองรับ", 422);
    }
    if (Object.values(body.visibility).some(value => typeof value !== "boolean") ||
      typeof body.expected_updated_at !== "string" || !body.expected_updated_at) {
      return fail("invalid_menu_value", "สถานะเมนูและเวอร์ชันต้องถูกต้อง", 422);
    }
    const { contract, rows } = await load(admin, tenantId);
    if (!contract) return fail("contract_required", "ไม่พบสัญญาร้านนี้", 409);
    if (version(rows, contract.updated_at) !== body.expected_updated_at) {
      return fail("menu_policy_conflict", "ข้อมูลถูกเปลี่ยน กรุณารีเฟรชแล้วบันทึกใหม่", 409);
    }
    const before = toLegacy(rows);
    const after = normalizePosMenuVisibility({ ...before, ...body.visibility });
    const now = new Date().toISOString();
    const changes = POS_MENU_POLICY_KEYS
      .filter(key => before[key] !== after[key])
      .map(key => ({
        tenant_id: tenantId, menu_key: COMPAT_KEYS[key], is_enabled: after[key],
        updated_by: admin.auth.userId, updated_at: now
      }));
    if (changes.length) {
      const save = await admin.supabase.from("tenant_pos_menu_policies")
        .upsert(changes, { onConflict: "tenant_id,menu_key" });
      if (save.error) throw save.error;
      await appendAuditLog({
        tenantId, actorUserId: admin.auth.userId, actorRole: "it_admin",
        action: "it_pos_menu_visibility_changed", targetTable: "tenant_pos_menu_policies",
        beforeData: { visibility: before }, afterData: { visibility: after },
        metadata: { source: "it_legacy_menu_visibility_adapter" },
        ipAddress: admin.requestMeta.ipAddress ?? undefined,
        userAgent: admin.requestMeta.userAgent ?? undefined
      });
    }
    return ok({ visibility: after, updated_at: changes.length ? now : version(rows, contract.updated_at) });
  } catch (error) { return guardItAdminError(error); }
}
