import { ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { clearCpiposAiHistory } from "@/lib/services/it-admin/cpipos-ai-admin-service";

export async function DELETE(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    const body = (await request.json().catch(() => ({}))) as { user_id?: unknown; branch_id?: unknown };
    const userId = typeof body.user_id === "string" && body.user_id.trim() ? body.user_id.trim() : null;
    const branchId = typeof body.branch_id === "string" && body.branch_id.trim() ? body.branch_id.trim() : null;
    const result = await clearCpiposAiHistory(admin, tenantId, userId, branchId);
    return ok(result);
  } catch (error) {
    return guardItAdminError(error);
  }
}
