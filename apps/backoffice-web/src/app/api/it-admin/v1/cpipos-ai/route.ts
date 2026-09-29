import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { listCpiposAiPackageQuotas, listCpiposAiStores } from "@/lib/services/it-admin/cpipos-ai-admin-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireItAdmin();
    const [stores, packages] = await Promise.all([
      listCpiposAiStores(context),
      listCpiposAiPackageQuotas(context)
    ]);
    const response = ok({ stores, packages });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}
