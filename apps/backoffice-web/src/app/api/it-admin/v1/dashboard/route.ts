import { ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { readThroughRuntimeCache } from "@/lib/route-runtime-cache";
import { loadDashboardOverview } from "@/lib/services/it-admin/dashboard-overview-service";
import { getVerifiedSupabaseAccessToken } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
const DASHBOARD_CACHE_TTL_MS = 30_000;

export async function GET() {
  const startedAt = Date.now();

  try {
    const context = await requireItAdmin();
    const accessToken = await getVerifiedSupabaseAccessToken(context.auth.userId);
    if (!accessToken) {
      throw new ItAdminGuardError("unauthorized", "Authentication is required.", 401);
    }

    const { value: payload, source } = await readThroughRuntimeCache({
      key: `it-admin-dashboard:${context.auth.userId}`,
      ttlMs: DASHBOARD_CACHE_TTL_MS,
      loader: () => loadDashboardOverview(accessToken)
    });
    const response = ok(payload);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-it-admin-dashboard-cache", source);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    response.headers.set("x-dashboard-status", payload.status);
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
