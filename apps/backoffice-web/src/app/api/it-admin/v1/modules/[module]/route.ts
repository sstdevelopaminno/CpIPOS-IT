import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { loadItAdminModule, parseItAdminModule } from "@/lib/services/it-admin/control-plane-module-service";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ module: string }> }) {
  const startedAt = Date.now();
  try {
    const { module: rawModule } = await params;
    const moduleName = parseItAdminModule(rawModule);
    if (!moduleName) return fail("unknown_it_admin_module", "Unknown IT Admin module.", 404);

    const context = await requireItAdmin();
    const supabase = await getSupabaseServerClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (sessionError || !session?.access_token || session.user.id !== context.auth.userId) {
      throw new ItAdminGuardError("unauthorized", "Authentication is required.", 401);
    }

    const payload = await loadItAdminModule(moduleName, session.access_token);
    const response = ok(payload);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    response.headers.set("x-it-admin-plane", payload.plane);
    return response;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("module_bridge_")) {
      const response = fail("it_admin_module_unavailable", "Module data is temporarily unavailable.", 503);
      response.headers.set("cache-control", "no-store");
      response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
      return response;
    }
    const response = guardItAdminError(error);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
