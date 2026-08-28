import { ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { loadDashboardOverview } from "@/lib/services/it-admin/dashboard-overview-service";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();

  try {
    const context = await requireItAdmin();
    const supabase = await getSupabaseServerClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const session = sessionData.session;

    if (sessionError || !session?.access_token || session.user.id !== context.auth.userId) {
      throw new ItAdminGuardError("unauthorized", "Authentication is required.", 401);
    }

    const payload = await loadDashboardOverview(session.access_token);
    const response = ok(payload);
    response.headers.set("cache-control", "no-store");
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
