import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItSupport } from "@/lib/it-admin-guard";
import { getSupportCenterSnapshot } from "@/lib/services/it-admin/support-center-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();

  try {
    const { supabase } = await requireItSupport();
    const url = new URL(request.url);
    const code = String(url.searchParams.get("code") ?? "").trim();

    if (!code) {
      throw new ItAdminGuardError("missing_store_code", "Store code is required.", 422);
    }

    if (code.length > 64 || !/^[A-Za-z0-9_-]+$/.test(code)) {
      throw new ItAdminGuardError("invalid_store_code", "Store code format is invalid.", 422);
    }

    const snapshot = await getSupportCenterSnapshot(supabase, code);
    if (!snapshot) {
      return fail("store_not_found", "No active customer store matches this code.", 404);
    }

    const response = ok({ snapshot });
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const guarded = guardItAdminError(error);
    guarded.headers.set("cache-control", "no-store");
    guarded.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return guarded;
  }
}
