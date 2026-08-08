import "server-only";

import crypto from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { readRequiredEnv } from "@/lib/env";

export type PosSessionRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_id: string | null;
  device_code: string | null;
  user_id: string;
  role: string;
  login_context_id: string;
  login_method: "pin" | "staff_card";
  status: "active" | "expired" | "revoked";
  expires_at: string;
};

export type PosSessionCreateFailureCode = "session_creation_failed" | "session_scope_conflict";

function isUniqueConflictError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (error.code === "23505") return true;
  const message = String(error.message ?? "").toLowerCase();
  return message.includes("duplicate key value") || message.includes("unique constraint");
}

export async function createPosSession(input: {
  tenantId: string;
  branchId: string;
  deviceId?: string | null;
  deviceCode?: string | null;
  userId: string;
  role: string;
  loginContextId: string;
  loginMethod: "pin" | "staff_card";
  metadata?: Record<string, unknown>;
}): Promise<{ ok: true; session: PosSessionRow } | { ok: false; code: PosSessionCreateFailureCode; message: string }> {
  const supabase = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  const ttlHoursRaw = Number(process.env.POS_SESSION_TTL_HOURS ?? 12);
  const ttlHours = Number.isFinite(ttlHoursRaw) && ttlHoursRaw > 0 && ttlHoursRaw <= 72 ? ttlHoursRaw : 12;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  // Important multi-cashier rule:
  // Do not revoke every active session for the same employee in the same branch.
  // A single employee code may legitimately operate multiple registered cashier devices.
  // Device exclusivity is enforced in /api/auth/devices/select before this insert.
  async function revokeExpiredDeviceSessions() {
    const expiredDeviceRevokes = [];
    if (input.deviceId) {
      expiredDeviceRevokes.push(
        supabase
          .from("pos_sessions")
          .update({ status: "revoked", revoked_at: nowIso })
          .eq("tenant_id", input.tenantId)
          .eq("branch_id", input.branchId)
          .eq("device_id", input.deviceId)
          .eq("status", "active")
          .lte("expires_at", nowIso)
      );
    }
    if (input.deviceCode) {
      expiredDeviceRevokes.push(
        supabase
          .from("pos_sessions")
          .update({ status: "revoked", revoked_at: nowIso })
          .eq("tenant_id", input.tenantId)
          .eq("branch_id", input.branchId)
          .eq("device_code", input.deviceCode)
          .eq("status", "active")
          .lte("expires_at", nowIso)
      );
    }

    const expiredDeviceResults = await Promise.all(expiredDeviceRevokes);
    const expiredDeviceRevokeError = expiredDeviceResults.find((result) => result.error)?.error;
    if (expiredDeviceRevokeError) {
      console.error("[pos-session] revoke expired active device sessions failed", {
        tenantId: input.tenantId,
        branchId: input.branchId,
        deviceId: input.deviceId ?? null,
        deviceCode: input.deviceCode ?? null,
        error: expiredDeviceRevokeError.message
      });
    }
  }

  async function insertSession() {
    return supabase
      .from("pos_sessions")
      .insert({
        tenant_id: input.tenantId,
        branch_id: input.branchId,
        device_id: input.deviceId ?? null,
        device_code: input.deviceCode ?? null,
        user_id: input.userId,
        role: input.role,
        login_context_id: input.loginContextId,
        login_method: input.loginMethod,
        status: "active",
        expires_at: expiresAt,
        metadata: input.metadata ?? {}
      })
      .select("id,tenant_id,branch_id,device_id,device_code,user_id,role,login_context_id,login_method,status,expires_at")
      .maybeSingle<PosSessionRow>();
  }

  await revokeExpiredDeviceSessions();
  let { data, error } = await insertSession();
  if (isUniqueConflictError(error)) {
    await revokeExpiredDeviceSessions();
    const retry = await insertSession();
    data = retry.data;
    error = retry.error;
  }

  if (error || !data) {
    if (isUniqueConflictError(error)) {
      return { ok: false, code: "session_scope_conflict", message: error?.message ?? "POS session conflict." };
    }
    return { ok: false, code: "session_creation_failed", message: error?.message ?? "Cannot create POS session." };
  }

  return { ok: true, session: data };
}

type SignedTokenPayload = {
  sid: string;
  tid: string;
  bid: string;
  uid: string;
  role: string;
  iat: number;
  exp: number;
};

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionHandoffToken(input: {
  sessionId: string;
  tenantId: string;
  branchId: string;
  userId: string;
  role: string;
  ttlSeconds?: number;
}): string {
  const secret = readRequiredEnv("POS_SESSION_HANDOFF_SECRET");
  const ttlRaw = Number(input.ttlSeconds ?? Number(process.env.POS_SESSION_HANDOFF_TTL_SECONDS ?? 120));
  const ttl = Number.isFinite(ttlRaw) && ttlRaw > 0 && ttlRaw <= 600 ? ttlRaw : 120;
  const now = Math.floor(Date.now() / 1000);
  const payload: SignedTokenPayload = {
    sid: input.sessionId,
    tid: input.tenantId,
    bid: input.branchId,
    uid: input.userId,
    role: input.role,
    iat: now,
    exp: now + ttl
  };

  const payloadEncoded = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(payloadEncoded, secret);
  return `${payloadEncoded}.${signature}`;
}

export function resolvePosRedirectTarget(): string {
  const baseUrl = String(process.env.NEXT_PUBLIC_POS_APP_URL ?? "/preview/pos").trim();
  return baseUrl || "/preview/pos";
}

export function resolveSessionCookieConfig() {
  const name = String(process.env.POS_SESSION_COOKIE_NAME ?? "pos_session_handoff").trim() || "pos_session_handoff";
  const sessionIdName = String(process.env.POS_SESSION_ID_COOKIE_NAME ?? "pos_session_id").trim() || "pos_session_id";
  const domain = String(process.env.POS_SESSION_COOKIE_DOMAIN ?? "").trim() || undefined;
  const secureEnv = String(process.env.POS_SESSION_COOKIE_SECURE ?? "").trim().toLowerCase();
  const secure = secureEnv ? secureEnv === "1" || secureEnv === "true" : process.env.NODE_ENV === "production";
  const sessionMaxAgeSeconds = 12 * 60 * 60;

  return { name, sessionIdName, domain, secure, sessionMaxAgeSeconds };
}
