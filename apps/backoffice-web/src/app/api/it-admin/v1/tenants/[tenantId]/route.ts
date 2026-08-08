import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { getTenantDetail, setTenantOperationalState, updateTenant } from "@/lib/services/it-admin/tenant-admin-service";

function parseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Internal server error.";
  const [code, detail] = message.includes(":") ? message.split(/:(.*)/s).map((part) => part.trim()) : ["it_admin_tenant_failed", message];
  if (code === "empty_patch") return fail(code, detail || message, 422);
  return guardItAdminError(error);
}

export async function GET(_req: Request, context: { params: Promise<{ tenantId: string }> }) {
  const startedAt = Date.now();

  try {
    const adminContext = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const detail = await getTenantDetail(adminContext, tenantId);
    if (!detail) return fail("tenant_not_found", "Tenant was not found.", 404);

    const response = ok(detail);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  const startedAt = Date.now();

  try {
    const adminContext = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = await req.json().catch(() => ({}));
    const tenant = await updateTenant(adminContext, tenantId, body);
    if (!tenant) return fail("tenant_not_found", "Tenant was not found.", 404);

    const response = ok({ tenant });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  const startedAt = Date.now();

  try {
    const adminContext = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = await req.json().catch(() => ({})) as { confirm_code?: string; reason?: string | null };
    const detail = await getTenantDetail(adminContext, tenantId);
    if (!detail) return fail("tenant_not_found", "Tenant was not found.", 404);
    if (String(body.confirm_code ?? "").trim().toUpperCase() !== detail.tenant.code.toUpperCase()) {
      return fail("confirmation_required", "confirm_code must match the tenant code.", 422);
    }

    const tenant = await setTenantOperationalState(adminContext, tenantId, "soft_delete", body.reason);
    const response = ok({ tenant, deleted: false, soft_deleted: true });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

