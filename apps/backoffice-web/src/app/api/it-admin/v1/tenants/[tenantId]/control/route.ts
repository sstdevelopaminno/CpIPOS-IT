import { readBoundedJson } from "@/lib/server/limited-json";
import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, ItAdminGuardError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import {
  applyTenantControlAction,
  loadTenantControlCenter,
  type TenantControlInput
} from "@/lib/services/it-admin/tenant-control-service";

export const dynamic = "force-dynamic";

type DeleteReceipt = {
  deleted: boolean;
  already_deleted: boolean;
  storage_cleanup_pending: boolean;
};

// Read-only evidence: never infer a successful deletion from a missing tenant alone.
async function verifyCompletedDeletion(
  admin: Awaited<ReturnType<typeof requireItAdmin>>,
  tenantId: string,
  confirmationCode: string
): Promise<DeleteReceipt | null> {
  if (!/^[0-9a-z-]{4,80}$/i.test(confirmationCode)) return null;
  const [tenantResult, auditResult] = await Promise.all([
    admin.supabase.from("tenants").select("id").eq("id", tenantId).maybeSingle<{ id: string }>(),
    admin.supabase.from("audit_logs")
      .select("metadata,created_at")
      .eq("target_table", "tenants")
      .eq("target_id", tenantId)
      .eq("action", "tenant_permanently_deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ metadata: Record<string, unknown> | null; created_at: string }>()
  ]);
  if (tenantResult.error || auditResult.error) {
    throw new ItAdminGuardError("tenant_deletion_status_unavailable", "Unable to verify the store deletion receipt.", 503);
  }
  if (tenantResult.data || !auditResult.data) return null;
  if (String(auditResult.data.metadata?.store_code ?? "") !== confirmationCode) return null;
  const cleanup = await admin.supabase.from("it_tenant_deletion_cleanup")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .maybeSingle<{ status: string }>();
  if (cleanup.error) {
    throw new ItAdminGuardError("tenant_deletion_status_unavailable", "Unable to verify outstanding storage cleanup.", 503);
  }
  return { deleted: true, already_deleted: true, storage_cleanup_pending: Boolean(cleanup.data) };
}

export async function GET(_req: Request, context: { params: Promise<{ tenantId: string }> }) {
  const startedAt = Date.now();
  try {
    const admin = await requireItAdmin();
    const { tenantId: rawTenantId } = await context.params;
    const tenantId = parseTenantParam(rawTenantId);
    if (new URL(_req.url).searchParams.get("deletion_status") === "1") {
      assertItSupportAction(admin, "เฉพาะ IT Support เท่านั้นที่ตรวจสอบหลักฐานการลบถาวรได้");
      const confirmationCode = String(new URL(_req.url).searchParams.get("store_code") ?? "").trim();
      const receipt = await verifyCompletedDeletion(admin, tenantId, confirmationCode);
      const response = ok(receipt ?? { deleted: false, already_deleted: false, storage_cleanup_pending: false });
      response.headers.set("cache-control", "private, no-store");
      return response;
    }
    const data = await loadTenantControlCenter(admin, tenantId);
    const response = ok(data);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function POST(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  const startedAt = Date.now();
  try {
    const admin = await requireItAdmin();
    const { tenantId: rawTenantId } = await context.params;
    const tenantId = parseTenantParam(rawTenantId);

    const rateLimit = await enforceRateLimit({
      namespace: "it_admin_tenant_control",
      key: admin.auth.userId,
      max: 40,
      windowMs: 60_000
    });
    if (!rateLimit.ok) return fail("rate_limited", "Too many store control changes. Please wait and try again.", 429);

    const body = await readBoundedJson<TenantControlInput | null>(req, 32_768);
    if (!body || typeof body !== "object") return fail("invalid_body", "Request body is required.", 422);
    if (body.action === "delete_store") {
      assertItSupportAction(admin, "IT Admin ไม่มีสิทธิ์ลบร้านถาวร; ใช้ IT Support สำหรับรายการนี้");
    }

    let data: Awaited<ReturnType<typeof applyTenantControlAction>> | DeleteReceipt;
    try {
      data = await applyTenantControlAction(admin, tenantId, body);
    } catch (error) {
      if (
        body.action !== "delete_store" ||
        !(error instanceof ItAdminGuardError) ||
        error.code !== "tenant_not_found"
      ) throw error;

      // A previous request may have committed the transaction before the HTTP
      // response was lost. Reconcile only with a matching audit receipt.
      const confirmationCode = String(body.confirmation_code ?? "").trim();
      if (String(body.admin_reason ?? "").trim().length < 8) throw error;
      const receipt = await verifyCompletedDeletion(admin, tenantId, confirmationCode);
      if (!receipt) throw error;
      data = receipt;
    }
    const response = ok(data);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
