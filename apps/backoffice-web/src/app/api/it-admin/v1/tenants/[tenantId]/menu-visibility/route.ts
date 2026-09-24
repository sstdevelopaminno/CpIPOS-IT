import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { POS_MENU_GROUPS, POS_MENU_POLICY_KEYS, normalizePosMenuVisibility } from "@/lib/pos-menu-visibility";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
type ContractRow = { id: string; metadata: Record<string, unknown> | null; updated_at: string; status: string };
type RequestBody = { visibility?: Record<string, unknown>; expected_updated_at?: unknown };

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    const result = await admin.supabase.from("tenant_subscription_contracts")
      .select("id,metadata,updated_at,status").eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle<ContractRow>();
    if (result.error) throw result.error;
    if (!result.data) return fail("contract_required", "ร้านนี้ยังไม่มีสัญญาแพ็กเกจให้ตั้งค่านโยบายเมนู", 409);
    const response = ok({
      groups: POS_MENU_GROUPS, visibility: normalizePosMenuVisibility(result.data.metadata?.pos_menu_visibility),
      updated_at: result.data.updated_at, contract_status: result.data.status
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
    if (Object.values(body.visibility).some(value => typeof value !== "boolean")) {
      return fail("invalid_menu_value", "สถานะของทุกเมนูต้องเป็น boolean", 422);
    }
    if (typeof body.expected_updated_at !== "string" || !body.expected_updated_at) {
      return fail("menu_policy_version_required", "กรุณารีเฟรชข้อมูลก่อนบันทึก", 422);
    }
    const result = await admin.supabase.from("tenant_subscription_contracts")
      .select("id,metadata,updated_at").eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle<ContractRow>();
    if (result.error) throw result.error;
    if (!result.data) return fail("contract_required", "ไม่พบสัญญาร้านนี้", 409);
    if (result.data.updated_at !== body.expected_updated_at) {
      return fail("menu_policy_conflict", "สัญญาร้านนี้มีการเปลี่ยนแปลง กรุณารีเฟรชแล้วบันทึกใหม่", 409);
    }
    const before = normalizePosMenuVisibility(result.data.metadata?.pos_menu_visibility);
    const after = normalizePosMenuVisibility(body.visibility);
    const now = new Date().toISOString();
    const update = await admin.supabase.from("tenant_subscription_contracts")
      .update({
        metadata: { ...(result.data.metadata ?? {}), pos_menu_visibility: after },
        updated_at: now
      }).eq("id", result.data.id).eq("tenant_id", tenantId)
      .eq("updated_at", result.data.updated_at)
      .select("id,updated_at").maybeSingle<{ id: string; updated_at: string }>();
    if (update.error) throw update.error;
    if (!update.data) return fail("menu_policy_conflict", "ข้อมูลถูกเปลี่ยนโดยผู้ดูแลอีกคน กรุณารีเฟรชแล้วบันทึกใหม่", 409);
    await appendAuditLog({
      tenantId, actorUserId: admin.auth.userId, actorRole: "it_admin",
      action: "it_pos_menu_visibility_changed", targetTable: "tenant_subscription_contracts",
      targetId: result.data.id, beforeData: { visibility: before },
      afterData: { visibility: after },
      metadata: { policy: "pos_menu_visibility", source: "it_store_control_center" },
      ipAddress: admin.requestMeta.ipAddress ?? undefined,
      userAgent: admin.requestMeta.userAgent ?? undefined
    });
    return ok({ visibility: after, updated_at: update.data.updated_at });
  } catch (error) { return guardItAdminError(error); }
}
