import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { loadCpiposAiDocumentAdmin } from "@/lib/services/it-admin/cpipos-ai-document-admin-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireItAdmin();
    const data = await loadCpiposAiDocumentAdmin(context);
    const response = ok(data);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}
