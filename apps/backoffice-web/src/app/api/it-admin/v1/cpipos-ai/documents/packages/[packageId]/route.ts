import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { updateCpiposAiDocumentPackagePolicy } from "@/lib/services/it-admin/cpipos-ai-document-admin-service";

export async function PATCH(request: Request, context: { params: Promise<{ packageId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const packageId = String((await context.params).packageId ?? "").trim();
    if (!packageId) return fail("missing_package_id", "packageId is required.", 422);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail("invalid_payload", "กรุณาระบุนโยบายพื้นที่เอกสาร AI", 422);
    return ok(await updateCpiposAiDocumentPackagePolicy(admin, packageId, body));
  } catch (error) {
    return guardItAdminError(error);
  }
}
