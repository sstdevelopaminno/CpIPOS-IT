import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { getCpiposAiTenantDetail, updateCpiposAiTenantQuota } from "@/lib/services/it-admin/cpipos-ai-admin-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    const detail = await getCpiposAiTenantDetail(admin, tenantId);
    if (!detail) return fail("tenant_not_found", "ไม่พบร้านค้า", 404);
    const response = ok(detail);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail("invalid_payload", "กรุณาระบุ AI Quota ของร้าน", 422);
    const saved = await updateCpiposAiTenantQuota(admin, tenantId, body);
    return ok(saved);
  } catch (error) {
    return guardItAdminError(error);
  }
}
