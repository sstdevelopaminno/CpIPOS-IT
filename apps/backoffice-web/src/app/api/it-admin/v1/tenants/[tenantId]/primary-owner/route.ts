import bcrypt from "bcryptjs";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const OWNER_PIN_PATTERN = /^\d{4,6}$/;
const OWNER_PIN_BCRYPT_ROUNDS = 12;
const EMPLOYEE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{2,31}$/;

type OwnerRoleRow = {
  user_id: string;
  branch_id: string;
  created_at: string;
  is_default: boolean;
};

type OwnerProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  platform_role: string | null;
  pin_hash: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type TenantOwnerRow = {
  owner_name: string | null;
  owner_phone: string | null;
};

type OwnerPosProfileRow = {
  tenant_id: string;
  user_id: string;
  employee_code: string | null;
  position_title: string | null;
  permission_role: string | null;
  created_at: string;
  updated_at: string;
};

type OwnerUpdateBody = {
  full_name?: unknown;
  email?: unknown;
  phone?: unknown;
  employee_code?: unknown;
  owner_pin?: unknown;
};

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmployeeCode(value: unknown) {
  return text(value, 32).toUpperCase().replace(/\s+/g, "");
}

function readOwnerPin(value: unknown) {
  const pin = typeof value === "string" ? value.trim() : "";
  if (!pin) return null;
  if (!OWNER_PIN_PATTERN.test(pin)) {
    throw new ItAdminGuardError("owner_pin_invalid", "Owner PIN must contain 4 to 6 digits.", 422);
  }
  return pin;
}

async function loadPrimaryOwner(admin: Awaited<ReturnType<typeof requireItAdmin>>, tenantId: string) {
  const roles = await admin.supabase
    .from("user_branch_roles")
    .select("user_id,branch_id,created_at,is_default")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(100)
    .returns<OwnerRoleRow[]>();

  if (roles.error) throw new Error(`primary_owner_roles_query_failed:${roles.error.message}`);
  if (!roles.data?.length) return null;

  const ownerUserIds = Array.from(new Set(roles.data.map((row) => row.user_id).filter(Boolean)));
  const profilesResult = await admin.supabase
    .from("users_profiles")
    .select("id,email,full_name,platform_role,pin_hash,is_active,created_at,updated_at")
    .in("id", ownerUserIds)
    .returns<OwnerProfileRow[]>();
  if (profilesResult.error) throw new Error(`primary_owner_profiles_query_failed:${profilesResult.error.message}`);

  const profilesByUser = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const canonicalResult = await admin.supabase.from("tenants")
    .select("primary_owner_user_id").eq("id", tenantId)
    .maybeSingle<{ primary_owner_user_id: string | null }>();
  if (canonicalResult.error || !canonicalResult.data) {
    throw new Error("primary_owner_reference_query_failed");
  }
  const canonicalId = canonicalResult.data.primary_owner_user_id;
  if (canonicalId && !roles.data.some((role) => role.user_id === canonicalId)) {
    throw new ItAdminGuardError("primary_owner_assignment_missing", "The protected first Owner has no Owner role; ask IT to repair the assignment.", 409);
  }
  const rankedRoles = [...roles.data].sort((left, right) => {
    if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
    const leftProfile = profilesByUser.get(left.user_id);
    const rightProfile = profilesByUser.get(right.user_id);
    const leftIsTenantUser = leftProfile?.platform_role !== "it_admin";
    const rightIsTenantUser = rightProfile?.platform_role !== "it_admin";
    if (leftIsTenantUser !== rightIsTenantUser) return leftIsTenantUser ? -1 : 1;
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });

  const firstRole = (canonicalId
    ? rankedRoles.find((row) => row.user_id === canonicalId && profilesByUser.has(row.user_id))
    : rankedRoles.find((row) => profilesByUser.has(row.user_id))) ?? null;
  if (!firstRole) throw new ItAdminGuardError("primary_owner_profile_missing", "Primary owner profile was not found.", 409);
  const profile = profilesByUser.get(firstRole.user_id);
  if (!profile) throw new ItAdminGuardError("primary_owner_profile_missing", "Primary owner profile was not found.", 409);

  const [tenantResult, posProfileResult] = await Promise.all([
    admin.supabase
      .from("tenants")
      .select("owner_name,owner_phone")
      .eq("id", tenantId)
      .maybeSingle<TenantOwnerRow>(),
    admin.supabase
      .from("pos_user_profiles")
      .select("tenant_id,user_id,employee_code,position_title,permission_role,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .eq("user_id", firstRole.user_id)
      .maybeSingle<OwnerPosProfileRow>()
  ]);

  if (tenantResult.error) throw new Error(`primary_owner_tenant_query_failed:${tenantResult.error.message}`);
  if (posProfileResult.error) throw new Error(`primary_owner_pos_profile_query_failed:${posProfileResult.error.message}`);

  const branchIds = new Set(
    roles.data
      .filter((row) => row.user_id === firstRole.user_id)
      .map((row) => row.branch_id)
      .filter(Boolean)
  );
  const employeeCode = normalizeEmployeeCode(posProfileResult.data?.employee_code ?? "");
  const pinConfigured = Boolean(profile.pin_hash);

  return {
    user_id: profile.id,
    full_name: profile.full_name ?? tenantResult.data?.owner_name ?? "",
    email: profile.email ?? "",
    phone: tenantResult.data?.owner_phone ?? "",
    employee_code: employeeCode,
    pos_profile_configured: Boolean(posProfileResult.data && employeeCode),
    is_active: profile.is_active,
    pin_configured: pinConfigured,
    login_ready: Boolean(profile.is_active && employeeCode && pinConfigured),
    created_at: profile.created_at,
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
    const employeeCode = normalizeEmployeeCode(body.employee_code);
    const ownerPin = readOwnerPin(body.owner_pin);
    if (fullName.length < 2) return fail("owner_name_required", "Owner name is required.", 422);
    if (!validEmail(email)) return fail("owner_email_invalid", "Owner email is invalid.", 422);
    if (!employeeCode) return fail("owner_employee_code_required", "POS employee code is required before the owner can sign in.", 422);
    if (!EMPLOYEE_CODE_PATTERN.test(employeeCode)) {
      return fail("owner_employee_code_invalid", "POS employee code must be 3 to 32 characters using letters, numbers, dot, underscore, or dash.", 422);
    }

    const before = await loadPrimaryOwner(admin, tenantId);
    if (!before) throw new ItAdminGuardError("primary_owner_missing", "This store does not have a primary owner user yet.", 409);

    const [beforeProfile, beforeTenant, beforePosProfile, duplicateCode] = await Promise.all([
      admin.supabase
        .from("users_profiles")
        .select("email,full_name,pin_hash,is_active,updated_at")
        .eq("id", before.user_id)
        .maybeSingle<{ email: string | null; full_name: string | null; pin_hash: string | null; is_active: boolean; updated_at: string }>(),
      admin.supabase
        .from("tenants")
        .select("owner_name,owner_phone,updated_at")
        .eq("id", tenantId)
        .maybeSingle<{ owner_name: string | null; owner_phone: string | null; updated_at: string }>(),
      admin.supabase
        .from("pos_user_profiles")
        .select("tenant_id,user_id,employee_code,position_title,permission_role,created_at,updated_at")
        .eq("tenant_id", tenantId)
        .eq("user_id", before.user_id)
        .maybeSingle<OwnerPosProfileRow>(),
      admin.supabase
        .from("pos_user_profiles")
        .select("user_id")
        .eq("tenant_id", tenantId)
        .eq("employee_code", employeeCode)
        .neq("user_id", before.user_id)
        .limit(1)
        .returns<Array<{ user_id: string }>>()
    ]);

    if (beforeProfile.error || !beforeProfile.data) throw new Error(`primary_owner_profile_before_failed:${beforeProfile.error?.message ?? "missing"}`);
    if (beforeTenant.error || !beforeTenant.data) throw new Error(`primary_owner_tenant_before_failed:${beforeTenant.error?.message ?? "missing"}`);
    if (beforePosProfile.error) throw new Error(`primary_owner_pos_profile_before_failed:${beforePosProfile.error.message}`);
    if (duplicateCode.error) throw new Error(`primary_owner_employee_code_check_failed:${duplicateCode.error.message}`);
    if ((duplicateCode.data ?? []).length > 0) {
      return fail("owner_employee_code_conflict", "This POS employee code is already assigned to another user in the store.", 409);
    }

    const now = new Date().toISOString();
    const profilePatch: Record<string, unknown> = { full_name: fullName, email, updated_at: now };
    if (ownerPin) profilePatch.pin_hash = await bcrypt.hash(ownerPin, OWNER_PIN_BCRYPT_ROUNDS);
    const tenantPatch = { owner_name: fullName, owner_phone: phone || null, updated_at: now };
    const posProfilePatch = {
      tenant_id: tenantId,
      user_id: before.user_id,
      employee_code: employeeCode,
      position_title: beforePosProfile.data?.position_title || "เจ้าของร้าน",
      permission_role: "owner",
      updated_at: now,
      ...(beforePosProfile.data ? {} : { created_at: now })
    };

    const restorePosProfile = async () => {
      if (beforePosProfile.data) {
        await admin.supabase.from("pos_user_profiles").upsert(beforePosProfile.data, { onConflict: "tenant_id,user_id" });
      } else {
        await admin.supabase.from("pos_user_profiles").delete().eq("tenant_id", tenantId).eq("user_id", before.user_id);
      }
    };

    const profileUpdate = await admin.supabase.from("users_profiles").update(profilePatch).eq("id", before.user_id);
    if (profileUpdate.error) throw new Error(`primary_owner_profile_update_failed:${profileUpdate.error.message}`);

    const tenantUpdate = await admin.supabase.from("tenants").update(tenantPatch).eq("id", tenantId);
    if (tenantUpdate.error) {
      await admin.supabase.from("users_profiles").update(beforeProfile.data).eq("id", before.user_id);
      throw new Error(`primary_owner_tenant_update_failed:${tenantUpdate.error.message}`);
    }

    const posProfileUpdate = await admin.supabase
      .from("pos_user_profiles")
      .upsert(posProfilePatch, { onConflict: "tenant_id,user_id" });
    if (posProfileUpdate.error) {
      await Promise.all([
        admin.supabase.from("users_profiles").update(beforeProfile.data).eq("id", before.user_id),
        admin.supabase.from("tenants").update(beforeTenant.data).eq("id", tenantId)
      ]);
      throw new Error(`primary_owner_pos_profile_update_failed:${posProfileUpdate.error.message}`);
    }

    if ((beforeProfile.data.email ?? "").toLowerCase() !== email) {
      const authUpdate = await admin.supabase.auth.admin.updateUserById(before.user_id, { email });
      if (authUpdate.error) {
        await Promise.all([
          admin.supabase.from("users_profiles").update(beforeProfile.data).eq("id", before.user_id),
          admin.supabase.from("tenants").update(beforeTenant.data).eq("id", tenantId),
          restorePosProfile()
        ]);
        throw new ItAdminGuardError("owner_auth_email_update_failed", authUpdate.error.message || "Unable to update owner login email.", 409);
      }
    }

    const employeeCodeChanged = normalizeEmployeeCode(before.employee_code) !== employeeCode;
    await appendAuditLog({
      tenantId,
      actorUserId: admin.auth.userId,
      actorRole: admin.auth.platformRole,
      action: ownerPin
        ? "tenant_primary_owner_identity_and_pin_updated"
        : employeeCodeChanged
          ? "tenant_primary_owner_login_identity_updated"
          : "tenant_primary_owner_updated",
      targetTable: "users_profiles",
      targetId: before.user_id,
      targetUserId: before.user_id,
      module: "it_admin",
      beforeData: {
        full_name: before.full_name,
        email: before.email,
        phone: before.phone,
        employee_code: before.employee_code,
        pin_configured: before.pin_configured,
        login_ready: before.login_ready
      },
      afterData: {
        full_name: fullName,
        email,
        phone,
        employee_code: employeeCode,
        pin_configured: ownerPin ? true : before.pin_configured,
        login_ready: Boolean(before.is_active && employeeCode && (ownerPin || before.pin_configured))
      },
      metadata: {
        source: "store_control_center",
        primary_owner: true,
        pin_changed: Boolean(ownerPin),
        employee_code_changed: employeeCodeChanged,
        pos_identity_repaired: !before.pos_profile_configured
      },
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
