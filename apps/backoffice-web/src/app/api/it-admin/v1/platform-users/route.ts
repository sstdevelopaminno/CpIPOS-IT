import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";

type PlatformRole = "it_admin" | "it_support" | "tenant_user";
type BranchRole = "owner" | "manager" | "staff";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  platform_role: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type RoleRow = {
  id: string;
  user_id: string;
  tenant_id: string;
  branch_id: string;
  role: string | null;
  is_default: boolean | null;
  created_at: string | null;
};

type TenantRow = { id: string; code: string | null; name: string | null };
type BranchRow = { id: string; tenant_id: string; code: string | null; name: string | null; is_active?: boolean | null };
type PosProfileRow = { tenant_id: string; user_id: string; employee_code: string | null; position_title: string | null; permission_role: string | null; updated_at: string | null };
type SessionRow = { id: string; tenant_id: string; branch_id: string; user_id: string; device_code: string | null; status: string | null; issued_at: string | null; expires_at: string | null };
type DeviceRow = { id: string; tenant_id: string; branch_id: string; device_code: string | null; device_name: string | null; status: string | null; last_seen_at: string | null };

const PLATFORM_ROLES: PlatformRole[] = ["it_admin", "it_support", "tenant_user"];
const BRANCH_ROLES: BranchRole[] = ["owner", "manager", "staff"];
const PIN_PATTERN = /^\d{4,8}$/;
const PASSWORD_PATTERN = /^.{8,128}$/;
const EMPLOYEE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;

function text(value: unknown, max = 180) {
  const next = typeof value === "string" ? value.trim() : "";
  return next ? next.slice(0, max) : "";
}

function email(value: unknown) {
  return text(value, 254).toLowerCase();
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseRole<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function parseBool(value: unknown, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function pageNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
}

function pageSize(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(10, Math.min(50, Math.trunc(parsed))) : 10;
}

function normalizeEmployeeCode(value: unknown) {
  return text(value, 32).toUpperCase().replace(/\s+/g, "");
}

function createPassword() {
  return `Cp!${crypto.randomBytes(9).toString("base64url")}9`;
}

async function safeQuery<T>(query: PromiseLike<{ data: T | null; error: { message?: string } | null }>, fallback: T): Promise<T> {
  const { data, error } = await query;
  if (error) {
    const message = String(error.message ?? "");
    if (/does not exist|Could not find|schema cache|relation/i.test(message)) return fallback;
    throw new Error(message || "Database query failed.");
  }
  return data ?? fallback;
}

async function loadLookups(supabase: any) {
  const [tenants, branches] = await Promise.all([
    safeQuery(supabase.from("tenants").select("id,code,name").order("name", { ascending: true }).limit(500), []),
    safeQuery(supabase.from("branches").select("id,tenant_id,code,name,is_active").order("name", { ascending: true }).limit(1000), [])
  ]);
  return { tenants, branches };
}

async function syncAuthUser(admin: any, userId: string, patch: { email?: string; password?: string; platformRole?: PlatformRole; isActive?: boolean; fullName?: string }) {
  const current = await admin.getUserById(userId);
  if (current.error || !current.data.user) {
    return {
      ok: false,
      code: "auth_user_missing",
      message: "บันทึกโปรไฟล์และสิทธิ์แล้ว แต่ไม่พบ Auth Login ของผู้ใช้นี้ จึงยังเปลี่ยนอีเมล Login หรือรีเซ็ตรหัสผ่านไม่ได้"
    };
  }
  const appMeta = current.data.user.app_metadata ?? {};
  const userMeta = current.data.user.user_metadata ?? {};
  const authPatch: Record<string, unknown> = {};
  if (patch.email) {
    authPatch.email = patch.email;
    authPatch.email_confirm = true;
  }
  if (patch.password) authPatch.password = patch.password;
  if (patch.platformRole) authPatch.app_metadata = { ...appMeta, platform_role: patch.platformRole };
  if (patch.fullName) authPatch.user_metadata = { ...userMeta, full_name: patch.fullName };
  if (typeof patch.isActive === "boolean") authPatch.ban_duration = patch.isActive ? "none" : "876000h";
  if (!Object.keys(authPatch).length) return { ok: true as const };
  const updated = await admin.updateUserById(userId, authPatch as never);
  if (updated.error) {
    throw new ItAdminGuardError("auth_user_update_failed", updated.error.message || "Unable to update authentication user.", 409);
  }
  return { ok: true as const };
}

async function bindUserToBranch(supabase: any, input: { userId: string; tenantId: string; branchId: string; role: BranchRole; isDefault: boolean; employeeCode?: string; positionTitle?: string; permissionRole?: string }) {
  const roleResult = await supabase
    .from("user_branch_roles")
    .upsert({ user_id: input.userId, tenant_id: input.tenantId, branch_id: input.branchId, role: input.role, is_default: input.isDefault }, { onConflict: "user_id,tenant_id,branch_id" })
    .select("id,user_id,tenant_id,branch_id,role,is_default,created_at")
    .single();
  if (roleResult.error) throw new Error(roleResult.error.message);

  if (input.employeeCode) {
    const posResult = await supabase.from("pos_user_profiles").upsert(
      {
        tenant_id: input.tenantId,
        user_id: input.userId,
        employee_code: input.employeeCode,
        position_title: input.positionTitle || null,
        permission_role: input.permissionRole || input.role,
        updated_at: new Date().toISOString()
      },
      { onConflict: "tenant_id,user_id" }
    );
    if (posResult.error) throw new Error(posResult.error.message);
  }

  return roleResult.data;
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const { supabase } = await requireItAdmin();
    const { searchParams } = new URL(request.url);
    const page = pageNumber(searchParams.get("page"));
    const limit = pageSize(searchParams.get("page_size"));
    const offset = (page - 1) * limit;
    const search = text(searchParams.get("search"), 120);
    const status = searchParams.get("status") === "active" || searchParams.get("status") === "inactive" ? searchParams.get("status") : "all";

    let profileQuery = supabase
      .from("users_profiles")
      .select("id,email,full_name,platform_role,is_active,created_at,updated_at", { count: "exact" })
      .order("updated_at", { ascending: false });

    if (status === "active") profileQuery = profileQuery.eq("is_active", true);
    if (status === "inactive") profileQuery = profileQuery.eq("is_active", false);
    if (search) {
      const escaped = search.replace(/[%_,]/g, "");
      profileQuery = profileQuery.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%,platform_role.ilike.%${escaped}%`);
    }

    const profileResult = await profileQuery.range(offset, offset + limit - 1);
    if (profileResult.error) throw new Error(profileResult.error.message);
    const profiles = profileResult.data ?? [];
    const userIds = profiles.map((row) => row.id);

    const [roles, posProfiles, sessions, lookups] = await Promise.all([
      userIds.length ? safeQuery(supabase.from("user_branch_roles").select("id,user_id,tenant_id,branch_id,role,is_default,created_at").in("user_id", userIds).order("created_at", { ascending: false }), []) : Promise.resolve([]),
      userIds.length ? safeQuery(supabase.from("pos_user_profiles").select("tenant_id,user_id,employee_code,position_title,permission_role,updated_at").in("user_id", userIds), []) : Promise.resolve([]),
      userIds.length ? safeQuery(supabase.from("pos_sessions").select("id,tenant_id,branch_id,user_id,device_code,status,issued_at,expires_at").in("user_id", userIds).order("issued_at", { ascending: false }).limit(600), []) : Promise.resolve([]),
      loadLookups(supabase)
    ]);

    const tenantById = new Map(lookups.tenants.map((row: TenantRow) => [row.id, row]));
    const branchById = new Map(lookups.branches.map((row: BranchRow) => [row.id, row]));
    const branchIds = Array.from(new Set(roles.map((row) => row.branch_id).filter(Boolean)));
    const deviceRows = branchIds.length
      ? await safeQuery(supabase.from("branch_devices").select("id,tenant_id,branch_id,device_code,device_name,status,last_seen_at").in("branch_id", branchIds).limit(800), [])
      : [];
    const deviceByScope = new Map(deviceRows.map((row) => [`${row.tenant_id}:${row.branch_id}:${row.device_code ?? ""}`, row]));
    const rolesByUser = new Map<string, RoleRow[]>();
    roles.forEach((row) => rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row]));
    const posByUserTenant = new Map(posProfiles.map((row) => [`${row.user_id}:${row.tenant_id}`, row]));
    const sessionsByUser = new Map<string, SessionRow[]>();
    sessions.forEach((row) => sessionsByUser.set(row.user_id, [...(sessionsByUser.get(row.user_id) ?? []), row]));
    const now = new Date().toISOString();

    const rows = profiles.map((profile) => {
      const assignments = (rolesByUser.get(profile.id) ?? []).map((roleRow) => {
        const tenant = tenantById.get(roleRow.tenant_id) as TenantRow | undefined;
        const branch = branchById.get(roleRow.branch_id) as BranchRow | undefined;
        const pos = posByUserTenant.get(`${profile.id}:${roleRow.tenant_id}`) as PosProfileRow | undefined;
        return {
          assignment_id: roleRow.id,
          tenant_id: roleRow.tenant_id,
          tenant_name: tenant?.name ?? null,
          tenant_code: tenant?.code ?? null,
          branch_id: roleRow.branch_id,
          branch_name: branch?.name ?? null,
          branch_code: branch?.code ?? null,
          role: roleRow.role,
          is_default: Boolean(roleRow.is_default),
          employee_code: pos?.employee_code ?? null,
          position_title: pos?.position_title ?? null,
          permission_role: pos?.permission_role ?? null
        };
      });
      const activeSessions = (sessionsByUser.get(profile.id) ?? []).filter((session) => session.status === "active" && (!session.expires_at || session.expires_at > now));
      const devices = activeSessions.slice(0, 4).map((session) => {
        const device = deviceByScope.get(`${session.tenant_id}:${session.branch_id}:${session.device_code ?? ""}`) as DeviceRow | undefined;
        return {
          tenant_id: session.tenant_id,
          branch_id: session.branch_id,
          device_code: session.device_code,
          device_name: device?.device_name ?? null,
          status: device?.status ?? session.status,
          last_seen_at: device?.last_seen_at ?? session.issued_at
        };
      });
      return {
        id: profile.id,
        email: profile.email ?? "",
        full_name: profile.full_name ?? "",
        platform_role: profile.platform_role ?? "tenant_user",
        is_active: Boolean(profile.is_active),
        created_at: profile.created_at,
        updated_at: profile.updated_at,
        tenant_count: new Set(assignments.map((item) => item.tenant_id)).size,
        branch_count: assignments.length,
        active_session_count: activeSessions.length,
        assignments,
        devices
      };
    });

    const response = ok({
      rows,
      tenants: lookups.tenants,
      branches: lookups.branches,
      page,
      page_size: limit,
      total: profileResult.count ?? rows.length,
      has_next: offset + rows.length < (profileResult.count ?? rows.length)
    });
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

export async function POST(request: Request) {
  try {
    const context = await requireItAdmin();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail("invalid_body", "Request body is required.", 422);
    const fullName = text(body.full_name, 160);
    const normalizedEmail = email(body.email);
    const platformRole = parseRole(body.platform_role, PLATFORM_ROLES, "tenant_user");
    const password = text(body.password, 128) || createPassword();
    const generatedPassword = !text(body.password, 128);
    const tenantId = text(body.tenant_id, 80);
    const branchId = text(body.branch_id, 80);
    const branchRole = parseRole(body.branch_role, BRANCH_ROLES, "staff");
    const employeeCode = normalizeEmployeeCode(body.employee_code);
    const posPin = text(body.pos_pin, 12);

    if (fullName.length < 2) return fail("user_name_required", "User name is required.", 422);
    if (!validEmail(normalizedEmail)) return fail("user_email_invalid", "User email is invalid.", 422);
    if (!PASSWORD_PATTERN.test(password)) return fail("user_password_invalid", "Password must be at least 8 characters.", 422);
    if (employeeCode && !EMPLOYEE_CODE_PATTERN.test(employeeCode)) return fail("employee_code_invalid", "Employee code is invalid.", 422);
    if (posPin && !PIN_PATTERN.test(posPin)) return fail("pos_pin_invalid", "POS PIN must contain 4 to 8 digits.", 422);

    const created = await context.supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      app_metadata: { platform_role: platformRole },
      user_metadata: { full_name: fullName, source: "it_admin_platform_users" }
    });
    if (created.error || !created.data.user) throw new ItAdminGuardError("auth_user_create_failed", created.error?.message || "Unable to create authentication user.", 409);
    const userId = created.data.user.id;
    const profile: Record<string, unknown> = { id: userId, email: normalizedEmail, full_name: fullName, platform_role: platformRole, is_active: true };
    if (posPin) profile.pin_hash = await bcrypt.hash(posPin, 12);
    const profileResult = await context.supabase.from("users_profiles").upsert(profile, { onConflict: "id" }).select("id,email,full_name,platform_role,is_active,created_at,updated_at").single();
    if (profileResult.error) throw new Error(profileResult.error.message);

    if (tenantId && branchId) {
      await bindUserToBranch(context.supabase, {
        userId,
        tenantId,
        branchId,
        role: branchRole,
        isDefault: parseBool(body.is_default, true),
        employeeCode,
        positionTitle: text(body.position_title, 120),
        permissionRole: text(body.permission_role, 80) || branchRole
      });
    }

    await appendAuditLog({
      tenantId: tenantId || undefined,
      branchId: branchId || undefined,
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: "platform_user_created",
      targetTable: "users_profiles",
      targetId: userId,
      targetUserId: userId,
      module: "it_admin",
      afterData: { ...profileResult.data, password_generated: generatedPassword, pin_configured: Boolean(posPin) },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({ user: profileResult.data, temporary_password: generatedPassword ? password : null }, 201);
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireItAdmin();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail("invalid_body", "Request body is required.", 422);
    const userId = text(body.user_id, 80);
    if (!userId) return fail("user_id_required", "user_id is required.", 422);

    const currentResult = await context.supabase.from("users_profiles").select("id,email,full_name,platform_role,is_active,created_at,updated_at").eq("id", userId).maybeSingle();
    if (currentResult.error) throw new Error(currentResult.error.message);
    if (!currentResult.data) return fail("user_not_found", "User profile was not found.", 404);

    const fullName = text(body.full_name, 160);
    const normalizedEmail = email(body.email);
    const platformRole = parseRole(body.platform_role, PLATFORM_ROLES, (currentResult.data.platform_role as PlatformRole) || "tenant_user");
    const nextActive = parseBool(body.is_active, Boolean(currentResult.data.is_active));
    const password = text(body.password, 128);
    const posPin = text(body.pos_pin, 12);
    const tenantId = text(body.tenant_id, 80);
    const branchId = text(body.branch_id, 80);
    const branchRole = parseRole(body.branch_role, BRANCH_ROLES, "staff");
    const employeeCode = normalizeEmployeeCode(body.employee_code);

    if (fullName && fullName.length < 2) return fail("user_name_required", "User name is required.", 422);
    if (normalizedEmail && !validEmail(normalizedEmail)) return fail("user_email_invalid", "User email is invalid.", 422);
    if (password && !PASSWORD_PATTERN.test(password)) return fail("user_password_invalid", "Password must be at least 8 characters.", 422);
    if (employeeCode && !EMPLOYEE_CODE_PATTERN.test(employeeCode)) return fail("employee_code_invalid", "Employee code is invalid.", 422);
    if (posPin && !PIN_PATTERN.test(posPin)) return fail("pos_pin_invalid", "POS PIN must contain 4 to 8 digits.", 422);

    const patch: Record<string, unknown> = {};
    if (fullName) patch.full_name = fullName;
    if (normalizedEmail) patch.email = normalizedEmail;
    if (platformRole) patch.platform_role = platformRole;
    if (typeof body.is_active === "boolean") patch.is_active = nextActive;
    if (posPin) patch.pin_hash = await bcrypt.hash(posPin, 12);
    if (Object.keys(patch).length) patch.updated_at = new Date().toISOString();

    let updated = currentResult.data;
    if (Object.keys(patch).length) {
      const updateResult = await context.supabase.from("users_profiles").update(patch).eq("id", userId).select("id,email,full_name,platform_role,is_active,created_at,updated_at").single();
      if (updateResult.error) throw new Error(updateResult.error.message);
      updated = updateResult.data;
    }

    if (tenantId && branchId) {
      await bindUserToBranch(context.supabase, {
        userId,
        tenantId,
        branchId,
        role: branchRole,
        isDefault: parseBool(body.is_default, true),
        employeeCode,
        positionTitle: text(body.position_title, 120),
        permissionRole: text(body.permission_role, 80) || branchRole
      });
    }

    const authSync = await syncAuthUser(context.supabase.auth.admin, userId, {
      email: normalizedEmail || undefined,
      password: password || undefined,
      platformRole,
      isActive: typeof body.is_active === "boolean" ? nextActive : undefined,
      fullName: fullName || undefined
    });

    if (typeof body.is_active === "boolean" && !nextActive) {
      await context.supabase.from("pos_sessions").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("user_id", userId).eq("status", "active");
    }

    await appendAuditLog({
      tenantId: tenantId || undefined,
      branchId: branchId || undefined,
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: password ? "platform_user_password_reset" : nextActive ? "platform_user_updated" : "platform_user_disabled",
      targetTable: "users_profiles",
      targetId: userId,
      targetUserId: userId,
      module: "it_admin",
      beforeData: currentResult.data,
      afterData: { ...updated, password_reset: Boolean(password), pin_changed: Boolean(posPin), reason: text(body.reason, 240) || null },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({ user: updated, auth_sync: authSync });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireItAdmin();
    const { searchParams } = new URL(request.url);
    const userId = text(searchParams.get("user_id"), 80);
    if (!userId) return fail("user_id_required", "user_id is required.", 422);
    if (userId === context.auth.userId) return fail("cannot_delete_self", "You cannot delete your own IT admin user.", 409);

    const currentResult = await context.supabase.from("users_profiles").select("id,email,full_name,platform_role,is_active,created_at,updated_at").eq("id", userId).maybeSingle();
    if (currentResult.error) throw new Error(currentResult.error.message);
    if (!currentResult.data) return fail("user_not_found", "User profile was not found.", 404);

    await context.supabase.from("pos_sessions").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("user_id", userId).eq("status", "active");
    await context.supabase.from("user_branch_roles").delete().eq("user_id", userId);
    await context.supabase.from("pos_user_profiles").delete().eq("user_id", userId);
    await context.supabase.from("users_profiles").delete().eq("id", userId);
    const authDelete = await context.supabase.auth.admin.deleteUser(userId);
    if (authDelete.error && !/not found|does not exist/i.test(authDelete.error.message ?? "")) {
      throw new ItAdminGuardError("auth_user_delete_failed", authDelete.error.message || "Unable to delete authentication user.", 409);
    }

    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: "platform_user_deleted",
      targetTable: "users_profiles",
      targetId: userId,
      targetUserId: userId,
      module: "it_admin",
      beforeData: currentResult.data,
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({ deleted: true, user_id: userId });
  } catch (error) {
    return guardItAdminError(error);
  }
}


