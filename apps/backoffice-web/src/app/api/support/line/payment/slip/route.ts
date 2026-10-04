import { fail, ok } from "@/lib/http";
import { requireLineSupportSession, LineSupportError } from "@/lib/support-chat/line-support-auth";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";
import { LinePaymentSlipError, submitLinePackagePaymentSlip } from "@/lib/payments/line-payment-slip-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 4 * 1024 * 1024 + 16_000;

function errorResponse(error: unknown) {
  if (error instanceof LinePaymentSlipError) return fail(error.code, error.message, error.status);
  if (error instanceof LineSupportError) return fail(error.code, error.message, error.status);
  console.error("[line-payment-slip]", error instanceof Error ? error.message : "unknown_error");
  return fail("payment_slip_unavailable", "ส่งสลิปไม่สำเร็จ กรุณาลองใหม่", 503);
}

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY) return fail("upload_too_large", "ไฟล์สลิปต้องมีขนาดไม่เกิน 4 MB", 413);

    const session = await requireLineSupportSession();
    const rate = await enforceRateLimit({
      namespace: "line-payment-slip-submit",
      key: [session.tenantId, session.bindingId, getClientIpAddress(request)].join(":"),
      max: 6,
      windowMs: 10 * 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) return fail("payment_slip_rate_limited", "ส่งสลิปถี่เกินไป กรุณารอสักครู่", 429);

    const form = await request.formData().catch(() => null);
    if (!form) return fail("invalid_form", "ไม่สามารถอ่านไฟล์สลิปได้", 422);

    const slip = form.get("slip");
    const note = typeof form.get("note") === "string" ? String(form.get("note")).trim().slice(0, 500) : "";
    if (!(slip instanceof File)) return fail("slip_required", "กรุณาแนบรูปสลิปการชำระเงิน", 422);

    const result = await submitLinePackagePaymentSlip({ session, slip, note });
    const response = ok(result);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
