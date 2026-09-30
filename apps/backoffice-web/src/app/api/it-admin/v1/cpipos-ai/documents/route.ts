import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { listCpiposAiDocumentStores } from "@/lib/services/it-admin/cpipos-ai-admin-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireItAdmin();
    const result = await listCpiposAiDocumentStores(context);
    const response = ok(result);
    response.headers.set("cache-control","private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}
