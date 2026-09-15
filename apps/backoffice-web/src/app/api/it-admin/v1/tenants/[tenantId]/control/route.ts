import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import {
  applyTenantControlAction,
  loadTenantControlCenter,
  type TenantControlInput
} from "@/lib/services/it-admin/tenant-control-service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ tenantId: string }> }) {
  const startedAt = Date.now();
  try {
    const admin = await requireItAdmin();
    const { tenantId: rawTenantId } = await context.params;
    const tenantId = parseTenantParam(rawTenantId);
    const data = await loadTenantControlCenter(admin, tenantId);
    const response = ok(data);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function POST(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  const startedAt = Date.now();
  try {
    const admin = await requireItAdmin();
    const { tenantId: rawTenantId } = await context.params;
    const tenantId = parseTenantParam(rawTenantId);

    const rateLimit = await enforceRateLimit({
      namespace: "it_admin_tenant_control",
      key: admin.auth.userId,
      max: 40,
      windowMs: 60_000
    });
    if (!rateLimit.ok) return fail("rate_limited", "Too many store control changes. Please wait and try again.", 429);

    const body = (await req.json().catch(() => null)) as TenantControlInput | null;
    if (!body || typeof body !== "object") return fail("invalid_body", "Request body is required.", 422);

    const data = await applyTenantControlAction(admin, tenantId, body);
    const response = ok(data);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
