import { fail, ok } from "@/lib/http";
import { verifyLineIdToken, LineSupportError } from "@/lib/support-chat/line-support-auth";
import { getPublicPaymentAccount } from "@/lib/payments/line-payment-service";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof LineSupportError) return fail(error.code, error.message, error.status);
  console.error("[line-payment-general]", error instanceof Error ? error.message : "unknown_error");
  return fail("payment_account_unavailable", "ไม่สามารถโหลดบัญชีรับชำระได้ กรุณาลองใหม่", 503);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { id_token?: string } | null;
    const identity = await verifyLineIdToken(String(body?.id_token ?? ""));
    const rate = await enforceRateLimit({
      namespace: "line-payment-general",
      key: [identity.userId, getClientIpAddress(request)].join(":"),
      max: 30,
      windowMs: 10 * 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) return fail("payment_rate_limited", "เปิดข้อมูลชำระเงินถี่เกินไป กรุณารอสักครู่", 429);

    const account = await getPublicPaymentAccount();
    const response = ok({ account });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
