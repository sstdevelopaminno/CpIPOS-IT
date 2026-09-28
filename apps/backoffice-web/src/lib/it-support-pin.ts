import "server-only";

import bcrypt from "bcryptjs";
import { appendAuditLog } from "@/lib/audit-log";
import type { ItAdminContext } from "@/lib/it-admin-guard";
import { ItAdminGuardError } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";

const PIN_PATTERN = /^\d{4,12}$/;

export async function requireItSupportPin(
  context: ItAdminContext,
  rawPin: unknown,
  protectedAction: string
) {
  const pin = typeof rawPin === "string" ? rawPin.trim() : "";
  const rateLimit = await enforceRateLimit({
    namespace: "it-development-pin",
    key: `${context.auth.userId}:${context.requestMeta.ipAddress ?? "unknown"}`,
    max: 6,
    windowMs: 60_000,
    failClosedOnBackendError: true
  });

  if (!rateLimit.ok) {
    throw new ItAdminGuardError(
      "development_pin_rate_limited",
      `กรอก PIN มากเกินไป กรุณารอ ${rateLimit.retryAfterSeconds} วินาทีแล้วลองใหม่`,
      429
    );
  }

  if (!PIN_PATTERN.test(pin)) {
    await appendAuditLog({
      actorUserId: context.auth.userId,
      actorRole: context.auth.platformRole,
      action: "development_pin_rejected",
      targetTable: "development_center",
      module: "development",
      metadata: { protected_action: protectedAction, reason: "invalid_format" },
      ipAddress: context.requestMeta.ipAddress ?? undefined,
      userAgent: context.requestMeta.userAgent ?? undefined
    });
    throw new ItAdminGuardError("development_pin_invalid", "PIN ต้องเป็นตัวเลข 4–12 หลัก", 403);
  }

  const profile = await context.supabase
    .from("users_profiles")
    .select("pin_hash,is_active,platform_role")
    .eq("id", context.auth.userId)
    .eq("platform_role", "it_support")
    .eq("is_active", true)
    .is("archived_at", null)
    .maybeSingle<{ pin_hash: string | null; is_active: boolean | null; platform_role: string | null }>();

  if (profile.error) {
    throw new ItAdminGuardError("development_pin_profile_error", "ตรวจสอบ PIN ของ IT Support ไม่สำเร็จ", 503);
  }

  if (!profile.data?.pin_hash) {
    throw new ItAdminGuardError(
      "development_pin_not_configured",
      "บัญชี IT Support นี้ยังไม่ได้ตั้ง Security PIN กรุณาตั้ง PIN ที่เมนู ตั้งค่า USER ใช้งาน ก่อนแก้ไข Source Code",
      428
    );
  }

  const approved = await bcrypt.compare(pin, profile.data.pin_hash);
  await appendAuditLog({
    actorUserId: context.auth.userId,
    actorRole: context.auth.platformRole,
    action: approved ? "development_pin_approved" : "development_pin_rejected",
    targetTable: "development_center",
    module: "development",
    metadata: {
      protected_action: protectedAction,
      result: approved ? "approved" : "rejected"
    },
    ipAddress: context.requestMeta.ipAddress ?? undefined,
    userAgent: context.requestMeta.userAgent ?? undefined
  });

  if (!approved) {
    throw new ItAdminGuardError("development_pin_invalid", "PIN ไม่ถูกต้อง", 403);
  }

  return { approved: true as const };
}
