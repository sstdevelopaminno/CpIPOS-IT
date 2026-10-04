import { fail, ok } from "@/lib/http";
import { requireLineSupportSession, LineSupportError } from "@/lib/support-chat/line-support-auth";
import { getLinePaymentRequestStatus, LinePaymentSlipError } from "@/lib/payments/line-payment-slip-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof LinePaymentSlipError) return fail(error.code, error.message, error.status);
  if (error instanceof LineSupportError) return fail(error.code, error.message, error.status);
  console.error("[line-payment-status]", error instanceof Error ? error.message : "unknown_error");
  return fail("payment_status_unavailable", "ตรวจสอบสถานะไม่สำเร็จ กรุณาลองใหม่", 503);
}

export async function GET(request: Request) {
  try {
    const session = await requireLineSupportSession();
    const requestId = new URL(request.url).searchParams.get("request_id")?.trim() ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      return fail("payment_request_invalid", "รหัสรายการชำระไม่ถูกต้อง", 422);
    }

    const result = await getLinePaymentRequestStatus({ session, requestId });
    const response = ok(result);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
