import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { getPosPlatformStatusReport } from "@/lib/it-admin-pos-platform-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    await requireItAdmin();
    const report = await getPosPlatformStatusReport();
    const response = ok(report);
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const guarded = guardItAdminError(error);
    guarded.headers.set("Cache-Control", "no-store, max-age=0");
    guarded.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return guarded;
  }
}
