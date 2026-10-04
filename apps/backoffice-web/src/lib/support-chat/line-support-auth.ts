import "server-only";

import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { sendSupportMail } from "@/lib/services/it-admin/support-mail-service";

const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const DEFAULT_LINE_LOGIN_CHANNEL_ID = "2011852850";
const SESSION_COOKIE = "cpipos_line_support_session";
const SESSION_TTL_SECONDS = 30 * 60;
const OTP_TTL_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;

type LineVerifyPayload = {
  sub?: string;
  name?: string;
  picture?: string;
  exp?: number;
};

export type VerifiedLineIdentity = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

export type LineSupportStore = {
  tenantId: string;
  storeCode: string;
  storeName: string;
  storeLogoUrl: string | null;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
};

export type LineSupportBinding = {
  id: string;
  tenant_id: string;
  line_user_id: string;
  line_display_name: string | null;
  line_avatar_url: string | null;
};

export type LineSupportSession = {
  v: 1;
  bindingId: string;
  tenantId: string;
  storeCode: string;
  storeName: string;
  storeLogoUrl: string | null;
  displayName: string;
  avatarUrl: string | null;
  exp: number;
};

export class LineSupportError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "LineSupportError";
    this.code = code;
    this.status = status;
  }
}

function requiredEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new LineSupportError(
      "line_support_not_configured",
      "ระบบ LINE Support ยังไม่ได้ตั้งค่าครบ",
      503
    );
  }
  return value;
}

function sessionSecret() {
  const explicit = String(process.env.LINE_SUPPORT_SESSION_SECRET ?? "").trim();
  if (explicit) {
    if (explicit.length < 32) {
      throw new LineSupportError(
        "line_support_secret_too_short",
        "การตั้งค่าความปลอดภัย LINE Support ไม่สมบูรณ์",
        503
      );
    }
    return explicit;
  }

  const communicationsRoot = String(process.env.CPIPOS_COMMUNICATIONS_HMAC_SECRET ?? "").trim();
  if (communicationsRoot.length < 32) {
    throw new LineSupportError(
      "line_support_not_configured",
      "ระบบ LINE Support ยังไม่ได้ตั้งค่า Secret สำหรับเซสชัน",
      503
    );
  }

  return createHmac("sha256", communicationsRoot)
    .update("cpipos:line-support-session:v1")
    .digest("hex");
}

function lineLoginChannelId() {
  return String(process.env.LINE_LOGIN_CHANNEL_ID ?? "").trim() || DEFAULT_LINE_LOGIN_CHANNEL_ID;
}

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function storeCode(value: unknown) {
  const code = text(value, 12);
  if (!/^\d{6}$/.test(code)) {
    throw new LineSupportError("store_code_invalid", "กรุณากรอกรหัสร้าน 6 หลัก", 422);
  }
  return code;
}

function otpValue(value: unknown) {
  const otp = text(value, 12);
  if (!/^\d{6}$/.test(otp)) {
    throw new LineSupportError("otp_invalid", "กรุณากรอกรหัส OTP 6 หลัก", 422);
  }
  return otp;
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "อีเมลเจ้าของร้าน";
  const prefix = local.slice(0, Math.min(2, local.length));
  const stars = "*".repeat(Math.max(3, Math.min(8, local.length - prefix.length)));
  return prefix + stars + "@" + domain;
}

function otpDigest(challengeId: string, otp: string) {
  return createHmac("sha256", sessionSecret())
    .update(challengeId + ":" + otp)
    .digest("hex");
}

function safeDigestEqual(expected: string, actual: string) {
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(actual, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function encodeSession(payload: LineSupportSession) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  return encoded + "." + signature;
}

function decodeSession(value: string): LineSupportSession | null {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", sessionSecret()).update(encoded).digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as LineSupportSession;
    if (payload.v !== 1 || !payload.bindingId || !payload.tenantId || !payload.exp) return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyLineIdToken(idToken: string): Promise<VerifiedLineIdentity> {
  const token = text(idToken, 4096);
  if (!token) throw new LineSupportError("line_id_token_required", "ไม่พบ LINE Login กรุณาเปิดจาก LINE อีกครั้ง", 401);

  const clientId = lineLoginChannelId();
  let response: Response;
  try {
    response = await fetch(LINE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: token, client_id: clientId }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store"
    });
  } catch {
    throw new LineSupportError("line_verify_unavailable", "ตรวจสอบ LINE Login ไม่สำเร็จ กรุณาลองใหม่", 503);
  }

  const payload = await response.json().catch(() => null) as LineVerifyPayload | null;
  const sub = text(payload?.sub, 160);
  const exp = Number(payload?.exp ?? 0);
  if (!response.ok || !sub || !Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    throw new LineSupportError("line_identity_invalid", "LINE Login หมดอายุหรือไม่ถูกต้อง กรุณาเปิด Support ใหม่", 401);
  }

  return {
    userId: sub,
    displayName: text(payload?.name, 120) || "ลูกค้า LINE",
    avatarUrl: text(payload?.picture, 1000) || null
  };
}

export async function resolveLineSupportStore(rawStoreCode: unknown): Promise<LineSupportStore> {
  const code = storeCode(rawStoreCode);
  const db = getPrimarySupabaseServiceClient();

  const access = await db.from("tenant_access_codes")
    .select("tenant_id,access_code,purpose,is_active")
    .eq("access_code", code)
    .eq("is_active", true)
    .in("purpose", ["customer", "sales_demo"])
    .maybeSingle();

  if (access.error || !access.data?.tenant_id) {
    throw new LineSupportError("store_not_found", "ไม่พบร้านค้าที่ใช้งานด้วยรหัสนี้", 404);
  }

  const tenant = await db.from("tenants")
    .select("id,name,display_name,logo_url,is_active,primary_owner_user_id")
    .eq("id", access.data.tenant_id)
    .maybeSingle();

  if (tenant.error || !tenant.data?.is_active || !tenant.data.primary_owner_user_id) {
    throw new LineSupportError("store_not_available", "ร้านค้านี้ยังไม่พร้อมใช้บริการ Support", 403);
  }

  const owner = await db.from("users_profiles")
    .select("id,email,full_name,is_active,archived_at")
    .eq("id", tenant.data.primary_owner_user_id)
    .maybeSingle();

  if (
    owner.error ||
    !owner.data?.id ||
    !owner.data.email ||
    !owner.data.is_active ||
    owner.data.archived_at
  ) {
    throw new LineSupportError(
      "owner_email_unavailable",
      "ร้านนี้ยังไม่มีอีเมล Owner สำหรับยืนยันครั้งแรก กรุณาติดต่อ IT Support",
      409
    );
  }

  return {
    tenantId: String(tenant.data.id),
    storeCode: code,
    storeName: text(tenant.data.display_name || tenant.data.name, 180) || code,
    storeLogoUrl: text(tenant.data.logo_url, 1000) || null,
    ownerUserId: String(owner.data.id),
    ownerName: text(owner.data.full_name, 120) || "Owner",
    ownerEmail: String(owner.data.email).trim().toLowerCase()
  };
}

export async function findActiveLineSupportBinding(identity: VerifiedLineIdentity, store: LineSupportStore) {
  const db = getPrimarySupabaseServiceClient();
  const result = await db.from("line_support_bindings")
    .select("id,tenant_id,line_user_id,line_display_name,line_avatar_url")
    .eq("line_user_id", identity.userId)
    .eq("tenant_id", store.tenantId)
    .eq("is_active", true)
    .maybeSingle<LineSupportBinding>();

  if (result.error) throw new LineSupportError("line_binding_lookup_failed", "ตรวจสอบสิทธิ์ Support ไม่สำเร็จ", 503);
  if (!result.data) return null;

  await db.from("line_support_bindings")
    .update({
      line_display_name: identity.displayName,
      line_avatar_url: identity.avatarUrl,
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", result.data.id);

  return {
    ...result.data,
    line_display_name: identity.displayName,
    line_avatar_url: identity.avatarUrl
  };
}

export async function requestLineSupportOtp(identity: VerifiedLineIdentity, store: LineSupportStore) {
  const db = getPrimarySupabaseServiceClient();
  const challengeId = randomUUID();
  const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000).toISOString();

  await db.from("line_support_verification_challenges")
    .delete()
    .eq("line_user_id", identity.userId)
    .eq("tenant_id", store.tenantId);

  const inserted = await db.from("line_support_verification_challenges").insert({
    id: challengeId,
    line_user_id: identity.userId,
    tenant_id: store.tenantId,
    owner_user_id: store.ownerUserId,
    otp_hash: otpDigest(challengeId, otp),
    attempt_count: 0,
    expires_at: expiresAt
  });

  if (inserted.error) {
    throw new LineSupportError("otp_create_failed", "สร้างรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่", 503);
  }

  try {
    await sendSupportMail({
      to: store.ownerEmail,
      subject: "รหัสยืนยัน LINE Support สำหรับ " + store.storeName,
      body: [
        "เรียน " + store.ownerName,
        "",
        "มีการขอเชื่อม LINE เพื่อใช้งาน CpIPOS Support",
        "ร้านค้า: " + store.storeName,
        "รหัสร้าน: " + store.storeCode,
        "",
        "รหัส OTP: " + otp,
        "รหัสนี้มีอายุ " + OTP_TTL_MINUTES + " นาที และใช้ได้ครั้งเดียว",
        "",
        "หากคุณไม่ได้เป็นผู้ขอเชื่อม LINE กรุณาไม่ต้องแจ้งรหัสนี้ให้บุคคลอื่น"
      ].join("\n")
    });
  } catch (error) {
    await db.from("line_support_verification_challenges").delete().eq("id", challengeId);
    throw error;
  }

  return {
    challengeId,
    maskedEmail: maskEmail(store.ownerEmail),
    expiresInSeconds: OTP_TTL_MINUTES * 60
  };
}

export async function verifyLineSupportOtp(input: {
  identity: VerifiedLineIdentity;
  store: LineSupportStore;
  challengeId: string;
  otp: unknown;
}) {
  const challengeId = text(input.challengeId, 80);
  const otp = otpValue(input.otp);
  const db = getPrimarySupabaseServiceClient();

  const result = await db.from("line_support_verification_challenges")
    .select("id,line_user_id,tenant_id,owner_user_id,otp_hash,attempt_count,expires_at,consumed_at")
    .eq("id", challengeId)
    .maybeSingle();

  const challenge = result.data;
  if (
    result.error ||
    !challenge ||
    challenge.line_user_id !== input.identity.userId ||
    challenge.tenant_id !== input.store.tenantId ||
    challenge.owner_user_id !== input.store.ownerUserId ||
    challenge.consumed_at ||
    Date.parse(String(challenge.expires_at)) <= Date.now() ||
    Number(challenge.attempt_count ?? 0) >= MAX_OTP_ATTEMPTS
  ) {
    throw new LineSupportError("otp_expired", "รหัส OTP หมดอายุหรือใช้ไม่ได้แล้ว กรุณาขอรหัสใหม่", 401);
  }

  const nextAttempts = Number(challenge.attempt_count ?? 0) + 1;
  const valid = safeDigestEqual(String(challenge.otp_hash), otpDigest(challengeId, otp));
  if (!valid) {
    await db.from("line_support_verification_challenges")
      .update({ attempt_count: nextAttempts })
      .eq("id", challengeId);
    throw new LineSupportError("otp_mismatch", "รหัส OTP ไม่ถูกต้อง", 401);
  }

  const now = new Date().toISOString();
  const bindingId = randomUUID();
  const binding = await db.from("line_support_bindings").upsert({
    id: bindingId,
    line_user_id: input.identity.userId,
    tenant_id: input.store.tenantId,
    verified_owner_user_id: input.store.ownerUserId,
    line_display_name: input.identity.displayName,
    line_avatar_url: input.identity.avatarUrl,
    is_active: true,
    verified_at: now,
    last_used_at: now,
    updated_at: now
  }, { onConflict: "line_user_id,tenant_id", ignoreDuplicates: false })
    .select("id,tenant_id,line_user_id,line_display_name,line_avatar_url")
    .single<LineSupportBinding>();

  if (binding.error || !binding.data) {
    throw new LineSupportError("line_binding_failed", "ผูก LINE กับร้านค้าไม่สำเร็จ กรุณาลองใหม่", 503);
  }

  await db.from("line_support_verification_challenges")
    .update({ attempt_count: nextAttempts, consumed_at: now })
    .eq("id", challengeId);

  return binding.data;
}

export async function establishLineSupportSession(input: {
  binding: LineSupportBinding;
  store: LineSupportStore;
  identity: VerifiedLineIdentity;
}) {
  const now = Math.floor(Date.now() / 1000);
  const payload: LineSupportSession = {
    v: 1,
    bindingId: input.binding.id,
    tenantId: input.store.tenantId,
    storeCode: input.store.storeCode,
    storeName: input.store.storeName,
    storeLogoUrl: input.store.storeLogoUrl,
    displayName: input.identity.displayName,
    avatarUrl: input.identity.avatarUrl,
    exp: now + SESSION_TTL_SECONDS
  };

  const jar = await cookies();
  jar.set(SESSION_COOKIE, encodeSession(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS
  });

  return payload;
}

export async function clearLineSupportSession() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

export async function requireLineSupportSession(): Promise<LineSupportSession> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? "";
  const session = token ? decodeSession(token) : null;
  if (!session) {
    throw new LineSupportError("line_support_session_required", "เซสชัน Support หมดอายุ กรุณาเปิดจาก LINE ใหม่", 401);
  }

  const db = getPrimarySupabaseServiceClient();
  const binding = await db.from("line_support_bindings")
    .select("id,tenant_id,is_active")
    .eq("id", session.bindingId)
    .eq("tenant_id", session.tenantId)
    .eq("is_active", true)
    .maybeSingle();

  if (binding.error || !binding.data) {
    await clearLineSupportSession();
    throw new LineSupportError("line_support_binding_revoked", "สิทธิ์ LINE Support ถูกยกเลิก กรุณายืนยันใหม่", 401);
  }

  return session;
}
