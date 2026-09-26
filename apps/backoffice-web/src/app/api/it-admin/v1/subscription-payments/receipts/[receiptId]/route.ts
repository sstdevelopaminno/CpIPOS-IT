import { fail } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { renderSubscriptionReceiptHtml } from "@/lib/printing/subscription-receipt-html-template";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ receiptId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReceiptRow = {
  id: string;
  tenant_id: string;
  receipt_number: string;
  issued_at: string;
  amount: number;
  currency: string;
  issuer_snapshot: Record<string, unknown>;
  customer_snapshot: Record<string, unknown>;
  package_snapshot: Record<string, unknown>;
  payment_snapshot: Record<string, unknown>;
};

export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase } = await requireItAdmin();
    const { receiptId } = await params;
    if (!UUID.test(receiptId)) {
      throw new ItAdminGuardError("receipt_invalid", "Invalid receipt identifier.", 422);
    }

    const result = await supabase.from("tenant_subscription_receipts")
      .select("id,tenant_id,receipt_number,issued_at,amount,currency,issuer_snapshot,customer_snapshot,package_snapshot,payment_snapshot")
      .eq("id", receiptId)
      .maybeSingle<ReceiptRow>();

    if (result.error) throw new Error("subscription_receipt_read_failed");
    if (!result.data) return fail("receipt_not_found", "Receipt not found.", 404);

    const receipt = result.data;
    const html = renderSubscriptionReceiptHtml({
      receiptNumber: receipt.receipt_number,
      issuedAt: receipt.issued_at,
      amount: Number(receipt.amount),
      currency: receipt.currency || "THB",
      issuer: receipt.issuer_snapshot ?? {},
      customer: receipt.customer_snapshot ?? {},
      packageSnapshot: receipt.package_snapshot ?? {},
      paymentSnapshot: receipt.payment_snapshot ?? {}
    });

    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "content-disposition": `inline; filename="${receipt.receipt_number}.html"`,
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}
