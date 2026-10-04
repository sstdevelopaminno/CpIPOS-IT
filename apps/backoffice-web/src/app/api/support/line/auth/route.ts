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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof LineSupportError) {
    return fail(error.code, error.message, error.status);
  }
  console.error("[line-support-auth]", error instanceof Error ? error.message : "unknown_error");
  return fail("line_support_unavailable", "LINE Support ไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่", 503);
}

export async function POST(request: Request) {
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

    const identity = await verifyLineIdToken(String(body?.id_token ?? ""));
    const store = await resolveLineSupportStore(body?.store_code);
    const ip = getClientIpAddress(request);

    if (action === "start") {
      const binding = await findActiveLineSupportBinding(identity, store);
      if (binding) {
        await establishLineSupportSession({ binding, store, identity });
        return ok({
          state: "ready",
          store: { code: store.storeCode, name: store.storeName, logo_url: store.storeLogoUrl }
        });
      }

      const rate = await enforceRateLimit({
        namespace: "line-support-otp-request",
        key: [identity.userId, store.storeCode, ip].join(":"),
        max: 3,
        windowMs: 10 * 60_000,
        failClosedOnBackendError: true
      });
      if (!rate.ok) {
        return fail("otp_rate_limited", "ขอรหัส OTP ถี่เกินไป กรุณารอสักครู่", 429);
      }

      const challenge = await requestLineSupportOtp(identity, store);
      return ok({
        state: "verification_required",
        challenge_id: challenge.challengeId,
        masked_email: challenge.maskedEmail,
        expires_in_seconds: challenge.expiresInSeconds,
        store: { code: store.storeCode, name: store.storeName, logo_url: store.storeLogoUrl }
      });
    }

    const rate = await enforceRateLimit({
      namespace: "line-support-otp-verify",
      key: [identity.userId, store.storeCode, ip].join(":"),
      max: 10,
      windowMs: 10 * 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) {
      return fail("otp_verify_rate_limited", "ลองยืนยัน OTP หลายครั้งเกินไป กรุณารอสักครู่", 429);
    }

    const binding = await verifyLineSupportOtp({
      identity,
      store,
      challengeId: String(body?.challenge_id ?? ""),
      otp: body?.otp
    });
    await establishLineSupportSession({ binding, store, identity });

    return ok({
      state: "ready",
      store: { code: store.storeCode, name: store.storeName, logo_url: store.storeLogoUrl }
    });
  } catch (error) {
    return errorResponse(error);
  }
}
