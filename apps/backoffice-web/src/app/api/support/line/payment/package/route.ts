import { fail, ok } from "@/lib/http";
import { LineSupportError, requireLineSupportSession } from "@/lib/support-chat/line-support-auth";
import { getLinePackagePaymentSnapshot } from "@/lib/payments/line-payment-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof LineSupportError) return fail(error.code, error.message, error.status);
  console.error("[line-payment-package]", error instanceof Error ? error.message : "unknown_error");
  return fail("package_payment_unavailable", "ไม่สามารถโหลดรอบชำระแพ็กเกจได้ กรุณาลองใหม่", 503);
}

export async function GET() {
  try {
    const session = await requireLineSupportSession();
    const payment = await getLinePackagePaymentSnapshot(session);
    const response = ok({ payment });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
