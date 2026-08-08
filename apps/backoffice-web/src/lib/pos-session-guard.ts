import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readRequiredEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type PosSessionRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string;
  role: string;
  device_id: string | null;
  device_code: string | null;
  shift_id: string | null;
  status: "active" | "expired" | "revoked";
  expires_at: string;
};
type PosSessionRowWithoutShift = Omit<PosSessionRow, "shift_id">;

type ShiftRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opened_by: string;
  device_code: string | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  is_active: boolean;
};

type BranchRow = {
  id: string;
  name: string | null;
  code: string | null;
};

type TenantRow = {
  id: string;
  name: string | null;
  code: string;
  is_active: boolean;
};

type HandoffPayload = {
  sid: string;
  tid: string;
  bid: string;
  uid: string;
  role: string;
  iat: number;
  exp: number;
};

type PosSessionRowCacheEntry = {
  value: PosSessionRow | null;
  expiresAt: number;
};

type PosScopeExtrasCacheEntry = {
  value: Omit<PosSessionScope, "session" | "permissions">;
  expiresAt: number;
};

const POS_SESSION_ROW_CACHE_TTL_MS = 4000;
const POS_SCOPE_EXTRAS_CACHE_TTL_MS = 20000;

function getPosSessionRowCache() {
  const scopedGlobal = globalThis as typeof globalThis & {
    __posSessionRowCache?: Map<string, PosSessionRowCacheEntry>;
  };
  if (!scopedGlobal.__posSessionRowCache) {
    scopedGlobal.__posSessionRowCache = new Map<string, PosSessionRowCacheEntry>();
  }
  return scopedGlobal.__posSessionRowCache;
}

function getPosScopeExtrasCache() {
  const scopedGlobal = globalThis as typeof globalThis & {
    __posScopeExtrasCache?: Map<string, PosScopeExtrasCacheEntry>;
  };
  if (!scopedGlobal.__posScopeExtrasCache) {
    scopedGlobal.__posScopeExtrasCache = new Map<string, PosScopeExtrasCacheEntry>();
  }
  return scopedGlobal.__posScopeExtrasCache;
}

function readPosSessionRowCache(sessionId: string): PosSessionRow | null | undefined {
  const cache = getPosSessionRowCache();
  const entry = cache.get(sessionId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(sessionId);
    return undefined;
  }
  return entry.value;
}

function writePosSessionRowCache(sessionId: string, value: PosSessionRow | null) {
  const cache = getPosSessionRowCache();
  cache.set(sessionId, {
    value,
    expiresAt: Date.now() + POS_SESSION_ROW_CACHE_TTL_MS
  });
}

export function updateCachedPosSessionShift(sessionId: string, shiftId: string | null) {
  const normalizedSessionId = sessionId.trim().replace(/^"+|"+$/g, "");
  const cached = readPosSessionRowCache(normalizedSessionId);
  if (!cached) return;
  writePosSessionRowCache(normalizedSessionId, { ...cached, shift_id: shiftId });
}

function readPosScopeExtrasCache(cacheKey: string): Omit<PosSessionScope, "session" | "permissions"> | null {
  const cache = getPosScopeExtrasCache();
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function writePosScopeExtrasCache(cacheKey: string, value: Omit<PosSessionScope, "session" | "permissions">) {
  const cache = getPosScopeExtrasCache();
  cache.set(cacheKey, {
    value,
    expiresAt: Date.now() + POS_SCOPE_EXTRAS_CACHE_TTL_MS
  });
}

export type PosPermission =
  | "sales:view"
  | "sales:list:view"
  | "reports:view"
  | "receipts:view"
  | "inventory:view"
  | "tables:view"
  | "tables:manage"
  | "users:view"
  | "users:manage"
  | "customer_display:view"
  | "customer_display:manage"
  | "monitor:view"
  | "settings:view"
  | "system:notice:view"
  | "shift:open"
  | "shift:join"
  | "shift:close"
  | "sales:enter"
  | "sales:create"
  | "sale:create"
  | "attendance:view_self"
  | "attendance:view_all_branch"
  | "attendance:manage"
  | "attendance:override"
  | "attendance:export";

export type PosSessionScope = {
  session: PosSessionRow;
  user: UserRow;
  branch: BranchRow | null;
  tenant: TenantRow | null;
  permissions: PosPermission[];
};

export class PosGuardError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "PosGuardError";
    this.code = code;
    this.status = status;
  }
}

function decodeBase64UrlJson(input: string): HandoffPayload | null {
  try {
    const decoded = Buffer.from(input, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as HandoffPayload;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function verifyHandoffToken(token: string): HandoffPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadEncoded, signature] = parts;
  if (!payloadEncoded || !signature) return null;

  const secret = readRequiredEnv("POS_SESSION_HANDOFF_SECRET", "Missing POS_SESSION_HANDOFF_SECRET");
  const expected = crypto.createHmac("sha256", secret).update(payloadEncoded).digest("base64url");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }

  const payload = decodeBase64UrlJson(payloadEncoded);
  if (!payload) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) return null;
  if (!payload.sid || !payload.tid || !payload.bid || !payload.uid || !payload.role) return null;
  return payload;
}

function normalizeRole(value: string): "owner" | "manager" | "staff" | "accountant" {
  if (value === "owner" || value === "manager" || value === "accountant") return value;
  return "staff";
}

function computePermissions(role: string): PosPermission[] {
  const normalized = normalizeRole(role);
  if (normalized === "owner") {
    return [
      "sales:view",
      "sales:list:view",
      "reports:view",
      "receipts:view",
      "inventory:view",
      "tables:view",
      "tables:manage",
      "users:view",
      "users:manage",
      "customer_display:view",
      "customer_display:manage",
      "monitor:view",
      "settings:view",
      "system:notice:view",
      "shift:open",
      "shift:join",
      "shift:close",
      "sales:enter",
      "sales:create",
      "sale:create",
      "attendance:view_self",
      "attendance:view_all_branch",
      "attendance:manage",
      "attendance:override",
      "attendance:export"
    ];
  }
  if (normalized === "manager") {
    return [
      "sales:view",
      "sales:list:view",
      "reports:view",
      "receipts:view",
      "inventory:view",
      "tables:view",
      "tables:manage",
      "users:view",
      "users:manage",
      "system:notice:view",
      "shift:open",
      "shift:join",
      "shift:close",
      "sales:enter",
      "sales:create",
      "sale:create",
      "attendance:view_self",
      "attendance:view_all_branch",
      "attendance:manage"
    ];
  }
  if (normalized === "accountant") {
    return [
      "sales:view",
      "sales:list:view",
      "reports:view",
      "receipts:view",
      "users:view",
      "monitor:view",
      "system:notice:view",
      "sales:enter",
      "attendance:view_self",
      "attendance:view_all_branch"
    ];
  }
  return [
    "sales:view",
    "sales:list:view",
    "receipts:view",
    "sales:enter",
    "sales:create",
    "sale:create",
    "shift:open",
    "shift:join",
    "shift:close",
    "system:notice:view",
    "attendance:view_self"
  ];
}

function isMissingSessionShiftColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (message.includes("pos_sessions.shift_id") || message.includes("column shift_id")) return true;
  return message.includes("could not find the 'shift_id' column");
}

function isMissingShiftDeviceCodeColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (message.includes("shifts.device_code") || message.includes("column device_code")) return true;
  return message.includes("could not find the 'device_code' column");
}

function toSessionWithNullShift(session: PosSessionRowWithoutShift): PosSessionRow {
  return {
    ...session,
    shift_id: null
  };
}

async function loadSessionById(sessionId: string): Promise<PosSessionRow | null> {
  const supabase = getSupabaseServiceClient();
  const normalizedSessionId = sessionId.trim().replace(/^"+|"+$/g, "");
  const cached = readPosSessionRowCache(normalizedSessionId);
  if (cached !== undefined) {
    return cached;
  }

  const { data, error } = await supabase
    .from("pos_sessions")
    .select("id,tenant_id,branch_id,user_id,role,device_id,device_code,shift_id,status,expires_at")
    .eq("id", normalizedSessionId)
    .maybeSingle<PosSessionRow>();
  if (isMissingSessionShiftColumnError(error)) {
    const legacyQuery = await supabase
      .from("pos_sessions")
      .select("id,tenant_id,branch_id,user_id,role,device_id,device_code,status,expires_at")
      .eq("id", normalizedSessionId)
      .maybeSingle<PosSessionRowWithoutShift>();
    if (legacyQuery.error) {
      console.error("[pos-session-guard] legacy loadSessionById query failed", {
        sessionId: normalizedSessionId,
        errorCode: legacyQuery.error.code ?? null,
        errorMessage: legacyQuery.error.message ?? "Unknown error"
      });
      throw new PosGuardError("session_lookup_failed", `Unable to verify POS session. ${legacyQuery.error.message ?? ""}`.trim(), 500);
    }
    const sessionFromLegacy = legacyQuery.data ? toSessionWithNullShift(legacyQuery.data) : null;
    writePosSessionRowCache(normalizedSessionId, sessionFromLegacy);
    return sessionFromLegacy;
  }
  if (error) {
    console.error("[pos-session-guard] loadSessionById query failed", {
      sessionId: normalizedSessionId,
      errorCode: error.code ?? null,
      errorMessage: error.message ?? "Unknown error"
    });
    throw new PosGuardError("session_lookup_failed", `Unable to verify POS session. ${error.message ?? ""}`.trim(), 500);
  }
  const resolved = data ?? null;
  writePosSessionRowCache(normalizedSessionId, resolved);
  return resolved;
}

async function clearSessionShiftBinding(sessionId: string) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("pos_sessions").update({ shift_id: null }).eq("id", sessionId);
  if (isMissingSessionShiftColumnError(error)) {
    return;
  }
  if (error) {
    console.warn("[pos-session-guard] clearSessionShiftBinding failed", {
      sessionId,
      errorCode: error.code ?? null,
      errorMessage: error.message ?? "Unknown error"
    });
  }
  const cached = readPosSessionRowCache(sessionId);
  if (cached) {
    writePosSessionRowCache(sessionId, { ...cached, shift_id: null });
  }
}

type ShiftRowWithoutDeviceCode = Omit<ShiftRow, "device_code">;

function withNullDeviceCode(shift: ShiftRowWithoutDeviceCode): ShiftRow {
  return {
    ...shift,
    device_code: null
  };
}

async function loadScopeExtras(session: PosSessionRow): Promise<Omit<PosSessionScope, "session" | "permissions">> {
  const cacheKey = `${session.tenant_id}:${session.branch_id}:${session.user_id}`;
  const cached = readPosScopeExtrasCache(cacheKey);
  if (cached) {
    return cached;
  }

  const supabase = getSupabaseServiceClient();
  const [{ data: user }, { data: branch }, { data: tenant }] = await Promise.all([
    supabase.from("users_profiles").select("id,full_name,is_active").eq("id", session.user_id).maybeSingle<UserRow>(),
    supabase.from("branches").select("id,name,code").eq("id", session.branch_id).maybeSingle<BranchRow>(),
    supabase.from("tenants").select("id,name,code,is_active").eq("id", session.tenant_id).maybeSingle<TenantRow>()
  ]);

  if (!user || user.is_active === false) {
    throw new PosGuardError("session_user_inactive", "POS session user is inactive.", 401);
  }
  if (tenant && tenant.is_active === false) {
    throw new PosGuardError("session_tenant_inactive", "POS session tenant is inactive.", 403);
  }

  const resolved = {
    user,
    branch: branch ?? null,
    tenant: tenant ?? null
  };
  writePosScopeExtrasCache(cacheKey, resolved);
  return resolved;
}

function assertActiveSession(session: PosSessionRow) {
  if (session.status !== "active") {
    throw new PosGuardError("session_not_active", "POS session is not active.", 401);
  }
  if (session.expires_at <= new Date().toISOString()) {
    throw new PosGuardError("session_expired", "POS session is expired.", 401);
  }
}

function resolveSessionCookieNames() {
  const handoffName = String(process.env.POS_SESSION_COOKIE_NAME ?? "pos_session_handoff").trim() || "pos_session_handoff";
  const sessionIdName = String(process.env.POS_SESSION_ID_COOKIE_NAME ?? "pos_session_id").trim() || "pos_session_id";
  const secureEnv = String(process.env.POS_SESSION_COOKIE_SECURE ?? "").trim().toLowerCase();
  const secure = secureEnv ? secureEnv === "1" || secureEnv === "true" : process.env.NODE_ENV === "production";
  const domain = String(process.env.POS_SESSION_COOKIE_DOMAIN ?? "").trim() || undefined;

  return { handoffName, sessionIdName, secure, domain };
}

async function resolveSessionFromCookies(): Promise<PosSessionRow> {
  const cookieStore = await cookies();
  const names = resolveSessionCookieNames();
  const sessionIdFromCookie = cookieStore.get(names.sessionIdName)?.value?.trim().replace(/^"+|"+$/g, "") ?? "";
  const handoffToken = cookieStore.get(names.handoffName)?.value?.trim() ?? "";

  let session: PosSessionRow | null = null;

  if (handoffToken) {
    const payload = verifyHandoffToken(handoffToken);
    if (!payload) {
      if (!sessionIdFromCookie) {
        throw new PosGuardError("invalid_handoff_token", "POS handoff token is invalid or expired.", 401);
      }
    } else {
      session = await loadSessionById(payload.sid);
      if (!session) {
        throw new PosGuardError("session_not_found", "POS session was not found.", 401);
      }
      if (session.tenant_id !== payload.tid || session.branch_id !== payload.bid || session.user_id !== payload.uid || session.role !== payload.role) {
        throw new PosGuardError("session_claim_mismatch", "POS session claims mismatch.", 401);
      }
    }
  }

  if (!session && sessionIdFromCookie) {
    session = await loadSessionById(sessionIdFromCookie);
  }

  if (!session) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[pos-session-guard] session cookie not resolved", {
        hasSessionIdCookie: Boolean(sessionIdFromCookie),
        hasHandoffCookie: Boolean(handoffToken)
      });
    }
    throw new PosGuardError("missing_pos_session", "POS session is required.", 401);
  }

  return session;
}

export async function requirePosSession(): Promise<PosSessionScope> {
  const session = await resolveSessionFromCookies();
  assertActiveSession(session);
  const extras = await loadScopeExtras(session);
  return {
    session,
    ...extras,
    permissions: computePermissions(session.role)
  };
}

export async function requirePosSessionForShiftClose(): Promise<PosSessionScope> {
  const session = await resolveSessionFromCookies();
  if (session.status === "revoked") {
    throw new PosGuardError("session_revoked", "POS session was revoked.", 401);
  }
  const extras = await loadScopeExtras(session);
  return {
    session,
    ...extras,
    permissions: computePermissions(session.role)
  };
}

export async function requireActiveShift(scopeArg?: PosSessionScope): Promise<{ scope: PosSessionScope; shift: ShiftRow }> {
  const scope = scopeArg ?? (await requirePosSession());
  const supabase = getSupabaseServiceClient();
  let shiftRow: ShiftRow | null = null;
  if (scope.session.shift_id) {
    const shiftByIdQuery = await supabase
      .from("shifts")
      .select("id,tenant_id,branch_id,status,opened_at,closed_at,opened_by,device_code")
      .eq("id", scope.session.shift_id)
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .maybeSingle<ShiftRow>();
    if (isMissingShiftDeviceCodeColumnError(shiftByIdQuery.error)) {
      const legacyShiftByIdQuery = await supabase
        .from("shifts")
        .select("id,tenant_id,branch_id,status,opened_at,closed_at,opened_by")
        .eq("id", scope.session.shift_id)
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", scope.session.branch_id)
        .maybeSingle<ShiftRowWithoutDeviceCode>();
      shiftRow = legacyShiftByIdQuery.data ? withNullDeviceCode(legacyShiftByIdQuery.data) : null;
    } else {
      shiftRow = shiftByIdQuery.data ?? null;
    }
  }
  if (!shiftRow) {
    const openShiftQuery = supabase
      .from("shifts")
      .select("id,tenant_id,branch_id,status,opened_at,closed_at,opened_by,device_code")
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1);
    if (scope.session.device_code) {
      openShiftQuery.eq("device_code", scope.session.device_code);
    }
    const fallbackShiftQuery = await openShiftQuery.maybeSingle<ShiftRow>();
    if (isMissingShiftDeviceCodeColumnError(fallbackShiftQuery.error)) {
      const legacyOpenShiftQuery = await supabase
        .from("shifts")
        .select("id,tenant_id,branch_id,status,opened_at,closed_at,opened_by")
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", scope.session.branch_id)
        .eq("status", "open")
        .order("opened_at", { ascending: false })
        .limit(1)
        .maybeSingle<ShiftRowWithoutDeviceCode>();
      shiftRow = legacyOpenShiftQuery.data ? withNullDeviceCode(legacyOpenShiftQuery.data) : null;
    } else {
      shiftRow = fallbackShiftQuery.data ?? null;
    }
    if (!shiftRow) {
      throw new PosGuardError("missing_active_shift", "Open shift is required before sales access.", 409);
    }
  }
  if (shiftRow.status !== "open") {
    await clearSessionShiftBinding(scope.session.id);
    throw new PosGuardError("shift_not_open", "Assigned shift is not open.", 409);
  }

  return { scope, shift: shiftRow };
}

export function requirePermission(scope: PosSessionScope, permission: PosPermission) {
  if (!scope.permissions.includes(permission)) {
    throw new PosGuardError("permission_denied", `Permission denied: ${permission}`, 403);
  }
}

export function getTenantBranchScopeFromSession(scope: PosSessionScope) {
  return {
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id,
    userId: scope.session.user_id,
    role: scope.session.role,
    deviceCode: scope.session.device_code
  };
}

export function resolvePosSessionCookieConfig() {
  return resolveSessionCookieNames();
}

export function withPosSessionCookie(response: NextResponse, sessionId: string) {
  const config = resolveSessionCookieNames();
  response.cookies.set({
    name: config.sessionIdName,
    value: sessionId,
    httpOnly: true,
    secure: config.secure,
    sameSite: "lax",
    path: "/",
    domain: config.domain,
    maxAge: 12 * 60 * 60
  });
  return response;
}
