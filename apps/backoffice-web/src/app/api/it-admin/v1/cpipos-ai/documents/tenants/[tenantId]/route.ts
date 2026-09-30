import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { clearCpiposAiDocumentsForTenant } from "@/lib/services/it-admin/cpipos-ai-document-admin-service";

export async function DELETE(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = String((await context.params).tenantId ?? "").trim();
    if (!tenantId) return fail("missing_tenant_id", "tenantId is required.", 422);
    return ok(await clearCpiposAiDocumentsForTenant(admin, tenantId));
  } catch (error) {
    return guardItAdminError(error);
  }
}
