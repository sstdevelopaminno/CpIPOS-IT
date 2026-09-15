import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

type OwnerRoleRow = {
  user_id: string;
  branch_id: string;
  created_at: string;
};

type OwnerProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type TenantOwnerRow = {
  owner_name: string | null;
  owner_phone: string | null;
};

type OwnerUpdateBody = {
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function loadPrimaryOwner(admin: Awaited<ReturnType<typeof requireItAdmin>>, tenantId: string) {
  const roles = await admin.supabase
    .from("user_branch_roles")
    .select("user_id,branch_id,created_at")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(100)
    .returns<OwnerRoleRow[]>();

  if (roles.error) throw new Error(`primary_owner_roles_query_failed:${roles.error.message}`);
  const firstRole = roles.data?.[0] ?? null;
  if (!firstRole) return null;

  const [profileResult, tenantResult] = await Promise.all([
    admin.supabase
      .from("users_profiles")
      .select("id,email,full_name,is_active,created_at,updated_at")
      .eq("id", firstRole.user_id)
      .maybeSingle<OwnerProfileRow>(),
    admin.supabase
      .from("tenants")
      .select("owner_name,owner_phone")
      .eq("id", tenantId)
      .maybeSingle<TenantOwnerRow>()
  ]);

  if (profileResult.error) throw new Error(`primary_owner_profile_query_failed:${profileResult.error.message}`);
  if (tenantResult.error) throw new Error(`primary_owner_tenant_query_failed:${tenantResult.error.message}`);
  if (!profileResult.data) throw new ItAdminGuardError("primary_owner_profile_missing", "Primary owner profile was not found.", 409);

  const branchIds = new Set(
    (roles.data ?? [])
      .filter((row) => row.user_id === firstRole.user_id)
      .map((row) => row.branch_id)
      .filter(Boolean)
  );

  return {
    user_id: profileResult.data.id,
    full_name: profileResult.data.full_name ?? tenantResult.data?.owner_name ?? "",
    email: profileResult.data.email ?? "",
    phone: tenantResult.data?.owner_phone ?? "",
    is_active: profileResult.data.is_active,
    created_at: profileResult.data.created_at,
    role_created_at: firstRole.created_at,
    owner_branch_count: branchIds.size
  };
}

export async function GET(_req: Request, context: { params: Promise<{ tenantId: string }> }) {
  const startedAt = Date.now();
  try {
    const admin = await requireItAdmin();
    const { tenantId: rawTenantId } = await context.params;
    const tenantId = parseTenantParam(rawTenantId);
    const primaryOwner = await loadPrimaryOwner(admin, tenantId);
    const response = ok({ primary_owner: primaryOwner });
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
      namespace: "it_admin_primary_owner",
      key: admin.auth.userId,
      max: 20,
      windowMs: 60_000
    });
    if (!rateLimit.ok) return fail("rate_limited", "Too many owner profile changes. Please wait and try again.", 429);

    const body = (await req.json().catch(() => null)) as OwnerUpdateBody | null;
    if (!body || typeof body !== "object") return fail("invalid_body", "Request body is required.", 422);

    const fullName = text(body.full_name, 160);
    const email = text(body.email, 320).toLowerCase();
    const phone = text(body.phone, 40);
    if (fullName.length < 2) return fail("owner_name_required", "Owner name is required.", 422);
    if (!validEmail(email)) return fail("owner_email_invalid", "Owner email is invalid.", 422);

    const before = await loadPrimaryOwner(admin, tenantId);
    if (!before) throw new ItAdminGuardError("primary_owner_missing", "This store does not have a primary owner user yet.", 409);

    const beforeProfile = await admin.supabase
      .from("users_profiles")
      .select("email,full_name,is_active,updated_at")
      .eq("id", before.user_id)
      .maybeSingle<{ email: string | null; full_name: string | null; is_active: boolean; updated_at: string }>();
    if (beforeProfile.error || !beforeProfile.data) throw new Error(`primary_owner_profile_before_failed:${beforeProfile.error?.message ?? "missing"}`);

    const beforeTenant = await admin.supabase
      .from("tenants")
      .select("owner_name,owner_phone,updated_at")
      .eq("id", tenantId)
      .maybeSingle<{ owner_name: string | null; owner_phone: string | null; updated_at: string }>();
    if (beforeTenant.error || !beforeTenant.data) throw new Error(`primary_owner_tenant_before_failed:${beforeTenant.error?.message ?? "missing"}`);

    const now = new Date().toISOString();
    const profilePatch = { full_name: fullName, email, updated_at: now };
    const tenantPatch = { owner_name: fullName, owner_phone: phone || null, updated_at: now };

    const profileUpdate = await admin.supabase.from("users_profiles").update(profilePatch).eq("id", before.user_id);
    if (profileUpdate.error) throw new Error(`primary_owner_profile_update_failed:${profileUpdate.error.message}`);

    const tenantUpdate = await admin.supabase.from("tenants").update(tenantPatch).eq("id", tenantId);
    if (tenantUpdate.error) {
      await admin.supabase.from("users_profiles").update(beforeProfile.data).eq("id", before.user_id);
      throw new Error(`primary_owner_tenant_update_failed:${tenantUpdate.error.message}`);
    }

    if ((beforeProfile.data.email ?? "").toLowerCase() !== email) {
      const authUpdate = await admin.supabase.auth.admin.updateUserById(before.user_id, { email });
      if (authUpdate.error) {
        await Promise.all([
          admin.supabase.from("users_profiles").update(beforeProfile.data).eq("id", before.user_id),
          admin.supabase.from("tenants").update(beforeTenant.data).eq("id", tenantId)
        ]);
        throw new ItAdminGuardError("owner_auth_email_update_failed", authUpdate.error.message || "Unable to update owner login email.", 409);
      }
    }

    await appendAuditLog({
      tenantId,
      actorUserId: admin.auth.userId,
      actorRole: admin.auth.platformRole,
      action: "tenant_primary_owner_updated",
      targetTable: "users_profiles",
      targetId: before.user_id,
      targetUserId: before.user_id,
      module: "it_admin",
      beforeData: { full_name: before.full_name, email: before.email, phone: before.phone },
      afterData: { full_name: fullName, email, phone },
      metadata: { source: "store_control_center", primary_owner: true },
      ipAddress: admin.requestMeta.ipAddress ?? undefined,
      userAgent: admin.requestMeta.userAgent ?? undefined
    });

    const primaryOwner = await loadPrimaryOwner(admin, tenantId);
    const response = ok({ primary_owner: primaryOwner });
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
