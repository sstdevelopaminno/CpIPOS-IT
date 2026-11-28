import { fail, ok } from "@/lib/http";
import {
  LineSupportError,
  clearLineSupportSession,
  establishLineSupportSession,
  findActiveLineSupportBinding,
  requestLineSupportOtp,
  resolveLineSupportStore,
  verifyLineIdToken,
  verifyLineSupportOtp
} from "@/lib/support-chat/line-support-auth";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";
import { openLineSupportConversation } from "@/lib/support-chat/line-support-chat-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown, stage: string) {
  if (error instanceof LineSupportError) {
    if (error.status >= 500) console.error("[line-support-auth]", { stage, code: error.code });
    return fail(error.code, error.message, error.status);
  }
  console.error("[line-support-auth]", { stage, code: "unexpected_error" });
  return fail("line_support_unavailable", "LINE Support ไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่", 503);
}

export async function POST(request: Request) {
  let stage = "parse";
  try {
    const body = await request.json().catch(() => null) as {
      action?: string;
      id_token?: string;
      store_code?: string;
      challenge_id?: string;
      otp?: string;
    } | null;
    const action = String(body?.action ?? "").trim();

    if (action === "logout") {
      await clearLineSupportSession();
      return ok({ logged_out: true });
    }

    if (action !== "start" && action !== "verify") {
      return fail("unsupported_action", "คำสั่งยืนยัน LINE Support ไม่ถูกต้อง", 422);
    }

    stage = "line_identity";
    const identity = await verifyLineIdToken(String(body?.id_token ?? ""));
    stage = "store_lookup";
    const store = await resolveLineSupportStore(body?.store_code);
    const ip = getClientIpAddress(request);

    if (action === "start") {
      stage = "binding_lookup";
      const binding = await findActiveLineSupportBinding(identity, store);
      if (binding) {
        stage = "chat_rate_limit";
        const openRate = await enforceRateLimit({
          namespace: "line-support-auth-open",
          key: [identity.userId, store.storeCode, ip].join(":"),
          max: 10,
          windowMs: 10 * 60_000,
          failClosedOnBackendError: true
        });
        if (openRate.source === "backend_unavailable") {
          throw new LineSupportError("support_rate_limiter_unavailable", "ระบบตรวจสอบความปลอดภัยไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่", 503);
        }
        if (!openRate.ok) {
          return fail("chat_open_rate_limited", "เปิดแชทถี่เกินไป กรุณารอสักครู่", 429);
        }

        stage = "session";
        const session = await establishLineSupportSession({ binding, store, identity });
        stage = "chat_open";
        const chat = await openLineSupportConversation(session);
        return ok({
          state: "ready",
          store: { code: store.storeCode, name: store.storeName, logo_url: store.storeLogoUrl },
          chat
        });
      }

      stage = "otp_request_rate_limit";
      const rate = await enforceRateLimit({
        namespace: "line-support-otp-request",
        key: [identity.userId, store.storeCode, ip].join(":"),
        max: 3,
        windowMs: 10 * 60_000,
        failClosedOnBackendError: true
      });
      if (rate.source === "backend_unavailable") {
        throw new LineSupportError("support_rate_limiter_unavailable", "ระบบตรวจสอบความปลอดภัยไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่", 503);
      }
      if (!rate.ok) {
        return fail("otp_rate_limited", "ขอรหัส OTP ถี่เกินไป กรุณารอสักครู่", 429);
      }

      stage = "otp_delivery";
      const challenge = await requestLineSupportOtp(identity, store);
      return ok({
        state: "verification_required",
        challenge_id: challenge.challengeId,
        masked_email: challenge.maskedEmail,
        expires_in_seconds: challenge.expiresInSeconds,
        store: { code: store.storeCode, name: store.storeName, logo_url: store.storeLogoUrl }
      });
    }

    stage = "otp_verify_rate_limit";
    const rate = await enforceRateLimit({
      namespace: "line-support-otp-verify",
      key: [identity.userId, store.storeCode, ip].join(":"),
      max: 10,
      windowMs: 10 * 60_000,
      failClosedOnBackendError: true
    });
    if (rate.source === "backend_unavailable") {
      throw new LineSupportError("support_rate_limiter_unavailable", "ระบบตรวจสอบความปลอดภัยไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่", 503);
    }
    if (!rate.ok) {
      return fail("otp_verify_rate_limited", "ลองยืนยัน OTP หลายครั้งเกินไป กรุณารอสักครู่", 429);
    }

    stage = "otp_verify";
    const binding = await verifyLineSupportOtp({
      identity,
      store,
      challengeId: String(body?.challenge_id ?? ""),
      otp: body?.otp
    });
    stage = "session";
    const session = await establishLineSupportSession({ binding, store, identity });
    stage = "chat_open";
    const chat = await openLineSupportConversation(session);

    return ok({
      state: "ready",
      store: { code: store.storeCode, name: store.storeName, logo_url: store.storeLogoUrl },
      chat
    });
  } catch (error) {
    return errorResponse(error, stage);
  }
}
