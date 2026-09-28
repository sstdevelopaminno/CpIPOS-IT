import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItSupport } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";

type ItRole = "it_admin" | "it_support";

type ItUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  platform_role: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

const IT_ROLES: ItRole[] = ["it_admin", "it_support"];
const PASSWORD_PATTERN = /^.{8,128}$/;
const SECURITY_PIN_PATTERN = /^\d{4,12}$/;

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

function parseRole(value: unknown, fallback: ItRole): ItRole {
  return IT_ROLES.includes(value as ItRole) ? (value as ItRole) : fallback;
}

function createPassword() {
  return `Cp!${crypto.randomBytes(9).toString("base64url")}9`;
}

async function syncAuthUser(
  admin: any,
  userId: string,
  patch: { email?: string; password?: string; platformRole?: ItRole; isActive?: boolean; fullName?: string }
) {
  const current = await admin.getUserById(userId);
  if (current.error || !current.data.user) {
    throw new ItAdminGuardError("auth_user_missing", "ไม่พบ Auth Login ของผู้ใช้ IT รายนี้", 404);
  }
  const authPatch: Record<string, unknown> = {};
  if (patch.email) {
    authPatch.email = patch.email;
    authPatch.email_confirm = true;
  }
  if (patch.password) authPatch.password = patch.password;
  if (patch.platformRole) {
    authPatch.app_metadata = { ...(current.data.user.app_metadata ?? {}), platform_role: patch.platformRole };
  }
  if (patch.fullName) {
    authPatch.user_metadata = { ...(current.data.user.user_metadata ?? {}), full_name: patch.fullName };
  }
  if (typeof patch.isActive === "boolean") {
    authPatch.ban_duration = patch.isActive ? "none" : "876000h";
  }
  if (!Object.keys(authPatch).length) return;
  const result = await admin.updateUserById(userId, authPatch as never);
  if (result.error) {
    throw new ItAdminGuardError("auth_user_update_failed", result.error.message || "แก้ไข Auth Login ไม่สำเร็จ", 409);
  }
}

export async function GET(request: Request) {
  try {
    const context = await requireItSupport();
    const { searchParams } = new URL(request.url);
    const search = text(searchParams.get("search"), 120);
    const status = searchParams.get("status");
    const role = searchParams.get("role");

    let query = context.supabase
      .from("users_profiles")
      .select("id,email,full_name,platform_role,is_active,created_at,updated_at")
      .in("platform_role", IT_ROLES)
      .is("archived_at", null)
      .order("updated_at", { ascending: false });

    if (status === "active") query = query.eq("is_active", true);
    if (status === "inactive") query = query.eq("is_active", false);
    if (role === "it_admin" || role === "it_support") query = query.eq("platform_role", role);
    if (search) {
      const escaped = search.replace(/[%_,]/g, "");
      query = query.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%`);
    }

    const result = await query.limit(200);
    if (result.error) throw new Error(result.error.message);
    const rows = (result.data ?? []) as ItUserRow[];

    const response = ok({
      rows: rows.map((row) => ({
        id: row.id,
        email: row.email ?? "",
        full_name: row.full_name ?? "",
        platform_role: row.platform_role as ItRole,
        is_active: row.is_active === true,
        created_at: row.created_at,
        updated_at: row.updated_at
      })),
      actor_role: context.auth.platformRole
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireItSupport();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail("invalid_body", "กรุณากรอกข้อมูลผู้ใช้ IT", 422);

    const fullName = text(body.full_name, 160);
    const normalizedEmail = email(body.email);
    const platformRole = parseRole(body.platform_role, "it_admin");
    const suppliedPassword = text(body.password, 128);
    const password = suppliedPassword || createPassword();
    const securityPin = text(body.security_pin, 12);

    if (fullName.length < 2) return fail("user_name_required", "กรุณาระบุชื่อผู้ใช้", 422);
    if (!validEmail(normalizedEmail)) return fail("user_email_invalid", "อีเมล Login ไม่ถูกต้อง", 422);
    if (!PASSWORD_PATTERN.test(password)) return fail("user_password_invalid", "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร", 422);
    if (securityPin && !SECURITY_PIN_PATTERN.test(securityPin)) return fail("security_pin_invalid", "Security PIN ต้องเป็นตัวเลข 4–12 หลัก", 422);
    const pinHash = securityPin ? await bcrypt.hash(securityPin, 12) : null;

    const created = await context.supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      app_metadata: { platform_role: platformRole },
      user_metadata: { full_name: fullName, source: "cpipos_it_user_settings" }
    });
    if (created.error || !created.data.user) {
      throw new ItAdminGuardError("auth_user_create_failed", created.error?.message || "สร้างบัญชี IT ไม่สำเร็จ", 409);
    }

    const userId = created.data.user.id;
    const profile = await context.supabase.from("users_profiles").upsert({
      id: userId,
      email: normalizedEmail,
      full_name: fullName,
      platform_role: platformRole,
      is_active: true,
      ...(pinHash ? { pin_hash: pinHash } : {}),
      updated_at: new Date().toISOString()
    }, { onConflict: "id" }).select("id,email,full_name,platform_role,is_active,created_at,updated_at").single();

    if (profile.error) {
      await context.supabase.auth.admin.deleteUser(userId).catch(() => null);
      throw new Error(profile.error.message);
    }

    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: "it_system_user_created",
      targetTable: "users_profiles",
      targetId: userId,
      targetUserId: userId,
      module: "it_admin",
      afterData: { ...profile.data, password_generated: !suppliedPassword, security_pin_set: Boolean(pinHash) },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({
      user: profile.data,
      temporary_password: suppliedPassword ? null : password,
      pin_changed: Boolean(pinHash)
    }, 201);
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireItSupport();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail("invalid_body", "กรุณากรอกข้อมูลผู้ใช้ IT", 422);

    const userId = text(body.user_id, 80);
    if (!userId) return fail("user_id_required", "ไม่พบ user_id", 422);

    const current = await context.supabase.from("users_profiles")
      .select("id,email,full_name,platform_role,is_active,created_at,updated_at")
      .eq("id", userId)
      .in("platform_role", IT_ROLES)
      .is("archived_at", null)
      .maybeSingle<ItUserRow>();

    if (current.error) throw new Error(current.error.message);
    if (!current.data) return fail("it_user_not_found", "ไม่พบบัญชีผู้ใช้ระบบ IT", 404);

    const fullName = text(body.full_name, 160);
    const normalizedEmail = email(body.email);
    const platformRole = parseRole(body.platform_role, current.data.platform_role === "it_support" ? "it_support" : "it_admin");
    const password = text(body.password, 128);
    const securityPin = text(body.security_pin, 12);
    const isActive = typeof body.is_active === "boolean" ? body.is_active : current.data.is_active === true;

    if (fullName && fullName.length < 2) return fail("user_name_required", "กรุณาระบุชื่อผู้ใช้", 422);
    if (normalizedEmail && !validEmail(normalizedEmail)) return fail("user_email_invalid", "อีเมล Login ไม่ถูกต้อง", 422);
    if (password && !PASSWORD_PATTERN.test(password)) return fail("user_password_invalid", "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร", 422);
    if (securityPin && !SECURITY_PIN_PATTERN.test(securityPin)) return fail("security_pin_invalid", "Security PIN ต้องเป็นตัวเลข 4–12 หลัก", 422);
    const pinHash = securityPin ? await bcrypt.hash(securityPin, 12) : null;
    if (userId === context.auth.userId && !isActive) {
      return fail("cannot_disable_self", "ไม่สามารถปิดใช้งานบัญชีที่กำลัง Login อยู่", 409);
    }

    const patch = {
      full_name: fullName || current.data.full_name,
      email: normalizedEmail || current.data.email,
      platform_role: platformRole,
      is_active: isActive,
      ...(pinHash ? { pin_hash: pinHash } : {}),
      updated_at: new Date().toISOString()
    };

    const updated = await context.supabase.from("users_profiles")
      .update(patch)
      .eq("id", userId)
      .in("platform_role", IT_ROLES)
      .is("archived_at", null)
      .select("id,email,full_name,platform_role,is_active,created_at,updated_at")
      .single();

    if (updated.error) throw new Error(updated.error.message);

    await syncAuthUser(context.supabase.auth.admin, userId, {
      email: normalizedEmail || undefined,
      password: password || undefined,
      platformRole,
      isActive: typeof body.is_active === "boolean" ? isActive : undefined,
      fullName: fullName || undefined
    });

    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: password ? "it_system_user_password_reset" : "it_system_user_updated",
      targetTable: "users_profiles",
      targetId: userId,
      targetUserId: userId,
      module: "it_admin",
      beforeData: current.data,
      afterData: {
        ...updated.data,
        password_reset: Boolean(password),
        security_pin_changed: Boolean(pinHash),
        reason: text(body.reason, 240) || null
      },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({
      user: updated.data,
      password_changed: Boolean(password),
      pin_changed: Boolean(pinHash),
      reauth_required: Boolean(password && userId === context.auth.userId)
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const context = await requireItSupport();
    const { searchParams } = new URL(request.url);
    const userId = text(searchParams.get("user_id"), 80);
    if (!userId) return fail("user_id_required", "ไม่พบ user_id", 422);
    if (userId === context.auth.userId) return fail("cannot_delete_self", "ไม่สามารถลบบัญชีที่กำลัง Login อยู่", 409);

    const current = await context.supabase.from("users_profiles")
      .select("id,email,full_name,platform_role,is_active,created_at,updated_at")
      .eq("id", userId)
      .in("platform_role", IT_ROLES)
      .is("archived_at", null)
      .maybeSingle<ItUserRow>();

    if (current.error) throw new Error(current.error.message);
    if (!current.data) return fail("it_user_not_found", "ไม่พบบัญชีผู้ใช้ระบบ IT", 404);

    // IT identities are referenced by immutable audit/history rows. Deleting the
    // Auth user would cascade into users_profiles and can violate those foreign
    // keys. "Delete" therefore removes live access while retaining the identity
    // row required by historical audit records.
    const archivedAt = new Date().toISOString();
    await syncAuthUser(context.supabase.auth.admin, userId, { isActive: false });

    const archived = await context.supabase.from("users_profiles")
      .update({
        is_active: false,
        archived_at: archivedAt,
        updated_at: archivedAt
      })
      .eq("id", userId)
      .in("platform_role", IT_ROLES)
      .is("archived_at", null)
      .select("id,email,full_name,platform_role,is_active,created_at,updated_at")
      .single();

    if (archived.error) throw new Error(archived.error.message);

    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: "it_system_user_archived",
      targetTable: "users_profiles",
      targetId: userId,
      targetUserId: userId,
      module: "it_admin",
      beforeData: current.data,
      afterData: {
        ...archived.data,
        archived_at: archivedAt,
        auth_login_revoked: true
      },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });

    return ok({
      deleted: true,
      archived: true,
      user_id: userId,
      message: "นำบัญชีออกจากระบบ IT แล้ว ปิดสิทธิ์ Login และเก็บประวัติ Audit เดิมไว้"
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}
