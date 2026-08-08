import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin, type ItAdminContext } from "@/lib/it-admin-guard";
import {
  createTenant,
  listTenantSummaries,
  type TenantCreateInput,
  type TenantSummaryStatus
} from "@/lib/services/it-admin/tenant-admin-service";

type AccessCodeRow = {
  tenant_id: string;
  access_code: string;
  purpose: string;
  is_active: boolean;
};

type LifecycleRow = {
  tenant_id: string;
  lifecycle_status: string;
  data_home: string;
  desired_data_home: string;
  migration_status: string;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  grace_until: string | null;
  routing_version: number;
};

function parseError(error: unknown) {
  const message = error instanceof Error ? error.message : "Internal server error.";
  const [code, detail] = message.includes(":") ? message.split(/:(.*)/s).map((part) => part.trim()) : ["it_admin_tenant_failed", message];
  if (code === "invalid_tenant_payload") return fail(code, detail || message, 422);
  if (code === "tenant_code_duplicate") return fail(code, detail || message, 409);
  return guardItAdminError(error);
}

function createInternalTenantCode() {
  return `T-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}

async function loadTenantControlPlane(context: ItAdminContext, tenantIds: string[]) {
  if (!tenantIds.length) {
    return {
      accessByTenant: new Map<string, AccessCodeRow>(),
      lifecycleByTenant: new Map<string, LifecycleRow>()
    };
  }

  const [{ data: accessRows, error: accessError }, { data: lifecycleRows, error: lifecycleError }] = await Promise.all([
    context.supabase
      .from("tenant_access_codes")
      .select("tenant_id,access_code,purpose,is_active")
      .in("tenant_id", tenantIds)
      .eq("is_active", true)
      .returns<AccessCodeRow[]>(),
    context.supabase
      .from("tenant_data_lifecycle")
      .select("tenant_id,lifecycle_status,data_home,desired_data_home,migration_status,trial_started_at,trial_expires_at,grace_until,routing_version")
      .in("tenant_id", tenantIds)
      .returns<LifecycleRow[]>()
  ]);

  if (accessError) throw new Error(`tenant_access_code_lookup_failed:${accessError.message}`);
  if (lifecycleError) throw new Error(`tenant_lifecycle_lookup_failed:${lifecycleError.message}`);

  return {
    accessByTenant: new Map((accessRows ?? []).map((row) => [row.tenant_id, row])),
    lifecycleByTenant: new Map((lifecycleRows ?? []).map((row) => [row.tenant_id, row]))
  };
}

export async function GET(req: Request) {
  const startedAt = Date.now();

  try {
    const context = await requireItAdmin();
    const { searchParams } = new URL(req.url);
    const result = await listTenantSummaries(context, {
      limit: Number(searchParams.get("limit") ?? 50),
      cursor: searchParams.get("cursor"),
      search: searchParams.get("search"),
      status: (searchParams.get("status") ?? "all") as TenantSummaryStatus,
      packageCode: searchParams.get("package_code")
    });

    const tenantIds = result.tenants.map((tenant) => tenant.id);
    const { accessByTenant, lifecycleByTenant } = await loadTenantControlPlane(context, tenantIds);
    const tenants = result.tenants.map((tenant) => {
      const access = accessByTenant.get(tenant.id) ?? null;
      const lifecycle = lifecycleByTenant.get(tenant.id) ?? null;
      return {
        ...tenant,
        store_code: access?.access_code ?? null,
        store_code_purpose: access?.purpose ?? null,
        lifecycle_status: lifecycle?.lifecycle_status ?? null,
        data_home: lifecycle?.data_home ?? "primary",
        desired_data_home: lifecycle?.desired_data_home ?? "primary",
        migration_status: lifecycle?.migration_status ?? "idle",
        trial_started_at: lifecycle?.trial_started_at ?? null,
        trial_expires_at: lifecycle?.trial_expires_at ?? null,
        grace_until: lifecycle?.grace_until ?? null,
        routing_version: lifecycle?.routing_version ?? 0
      };
    });

    const response = ok({ ...result, tenants });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    response.headers.set("x-summary-source", result.source);
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    const context = await requireItAdmin();
    const rawBody = await req.json().catch(() => ({}));
    const body = (rawBody && typeof rawBody === "object" ? { ...(rawBody as Record<string, unknown>) } : {}) as TenantCreateInput;

    // `tenants.code` is now an internal compatibility identifier. New onboarding
    // does not require an operator to invent a long store code; the DB trigger
    // allocates the immutable six-digit customer-facing code atomically.
    if (typeof body.code !== "string" || !body.code.trim()) {
      body.code = createInternalTenantCode();
    }

    const created = await createTenant(context, body);
    const { accessByTenant, lifecycleByTenant } = await loadTenantControlPlane(context, [created.tenant.id]);
    const access = accessByTenant.get(created.tenant.id) ?? null;
    const lifecycle = lifecycleByTenant.get(created.tenant.id) ?? null;

    if (!access?.access_code || !lifecycle) {
      throw new Error("tenant_control_plane_provision_failed: Store code or lifecycle state was not provisioned.");
    }

    const response = ok(
      {
        ...created,
        store_code: access.access_code,
        store_code_purpose: access.purpose,
        lifecycle: {
          status: lifecycle.lifecycle_status,
          data_home: lifecycle.data_home,
          desired_data_home: lifecycle.desired_data_home,
          migration_status: lifecycle.migration_status,
          trial_started_at: lifecycle.trial_started_at,
          trial_expires_at: lifecycle.trial_expires_at,
          grace_until: lifecycle.grace_until,
          routing_version: lifecycle.routing_version
        }
      },
      201
    );
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = parseError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
