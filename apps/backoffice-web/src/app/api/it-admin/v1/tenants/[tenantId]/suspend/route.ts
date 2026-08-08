import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { setTenantOperationalState } from "@/lib/services/it-admin/tenant-admin-service";

export async function POST(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  const startedAt = Date.now();

  try {
    const adminContext = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = await req.json().catch(() => ({})) as { reason?: string | null };
    const tenant = await setTenantOperationalState(adminContext, tenantId, "suspend", body.reason);
    if (!tenant) return fail("tenant_not_found", "Tenant was not found.", 404);

    const response = ok({ tenant });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

