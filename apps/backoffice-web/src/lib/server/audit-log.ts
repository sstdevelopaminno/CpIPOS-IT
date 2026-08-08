import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type LoginAttemptPayload = {
  tenantId?: string | null;
  branchId?: string | null;
  deviceCode?: string | null;
  loginContextId?: string | null;
  userId?: string | null;
  loginMethod?: "pin" | "staff_card" | null;
  success: boolean;
  failureReason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export type AuditLogPayload = {
  tenantId?: string | null;
  branchId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  targetUserId?: string | null;
  deviceCode?: string | null;
  posSessionId?: string | null;
  action: string;
  targetTable?: string;
  targetId?: string | null;
  targetType?: string | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeLoginAttempt(payload: LoginAttemptPayload) {
  const supabase = getSupabaseServiceClient();
  await supabase.from("login_attempts").insert({
    tenant_id: payload.tenantId ?? null,
    branch_id: payload.branchId ?? null,
    device_code: payload.deviceCode ?? null,
    login_context_id: payload.loginContextId ?? null,
    user_id: payload.userId ?? null,
    login_method: payload.loginMethod ?? null,
    success: payload.success,
    failure_reason: payload.failureReason ?? null,
    ip_address: payload.ipAddress ?? null,
    user_agent: payload.userAgent ?? null,
    metadata: payload.metadata ?? {}
  });
}

export async function writeAuditLog(payload: AuditLogPayload) {
  const supabase = getSupabaseServiceClient();
  await supabase.from("audit_logs").insert({
    tenant_id: payload.tenantId ?? null,
    branch_id: payload.branchId ?? null,
    actor_user_id: payload.actorUserId ?? null,
    actor_role: payload.actorRole ?? null,
    target_user_id: payload.targetUserId ?? null,
    device_code: payload.deviceCode ?? null,
    pos_session_id: payload.posSessionId ?? null,
    action: payload.action,
    target_table: payload.targetTable ?? "pos_sessions",
    target_id: payload.targetId ?? null,
    target_type: payload.targetType ?? null,
    old_value: payload.oldValue ?? null,
    new_value: payload.newValue ?? null,
    ip_address: payload.ipAddress ?? null,
    user_agent: payload.userAgent ?? null,
    metadata: payload.metadata ?? {}
  });
}

export function getRequestMeta(request: Request): { ipAddress: string | null; userAgent: string | null } {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || realIp?.trim() || null;
  const userAgent = request.headers.get("user-agent")?.trim() || null;
  return { ipAddress, userAgent };
}
