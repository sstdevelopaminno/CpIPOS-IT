import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ tenantId: string }> };
type Store = { id: string; code: string | null; name: string; display_name: string | null };
type Cycle = {
  id: string; period_start: string; period_end: string; amount_due: number;
  amount_paid: number; status: string; created_at: string; package_id: string
};
type RequestRow = {
  id: string; request_type: string; requested_package_id: string | null;
  amount_reported: number | null; currency: string | null; evidence_url: string | null;
  status: string; submitted_at: string | null; reviewed_at: string | null;
  review_note: string | null; created_at: string; metadata: Record<string,unknown> | null
};
type Approval = { id: string; payment_request_id: string | null; action: string; from_status: string | null;
  to_status: string | null; created_at: string };
type Receipt = { id: string; payment_request_id: string; billing_cycle_id: string; receipt_number: string;
  issued_at: string; amount: number; currency: string; package_snapshot: Record<string,unknown> | null };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { tenantId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new ItAdminGuardError("invalid_tenant", "Invalid store identifier.", 422);
    }
    const { supabase } = await requireItAdmin();
    const store = await supabase.from("tenants").select("id,code,name,display_name")
      .eq("id", tenantId).maybeSingle<Store>();
    if (store.error) throw new Error("history_store_read_failed");
    if (!store.data) throw new ItAdminGuardError("store_not_found", "Store not found.", 404);
    const [cycles, requests, approvals, receipts] = await Promise.all([
      supabase.from("tenant_billing_cycles")
        .select("id,period_start,period_end,amount_due,amount_paid,status,created_at,package_id")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100).returns<Cycle[]>(),
      supabase.from("tenant_subscription_payment_requests")
        .select("id,request_type,requested_package_id,amount_reported,currency,evidence_url,status,submitted_at,reviewed_at,review_note,created_at,metadata")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100).returns<RequestRow[]>(),
      supabase.from("tenant_subscription_approval_events")
        .select("id,payment_request_id,action,from_status,to_status,created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100).returns<Approval[]>(),
      supabase.from("tenant_subscription_receipts")
        .select("id,payment_request_id,billing_cycle_id,receipt_number,issued_at,amount,currency,package_snapshot")
        .eq("tenant_id", tenantId).order("issued_at", { ascending: false }).limit(100).returns<Receipt[]>()
    ]);
    if (cycles.error || requests.error || approvals.error || receipts.error) {
      throw new Error("subscription_payment_history_read_failed");
    }
    const paymentRequests = await Promise.all((requests.data ?? []).map(async ({ evidence_url, ...row }) => {
      // Never expose raw storage paths or generate a link outside this store's private prefix.
      let slip_url: string | null = null;
      if (evidence_url?.startsWith(tenantId + "/")) {
        const signed = await supabase.storage.from("subscription-payment-evidence")
          .createSignedUrl(evidence_url, 300);
        if (!signed.error && signed.data) slip_url = signed.data.signedUrl;
      }
      const { metadata, ...visible } = row;
      const info = metadata ?? {};
      const quoted = Number(info.expected_amount);
      return {
        ...visible, has_evidence: Boolean(evidence_url), slip_url,
        kind: info.kind === "payment_notice" ? "payment_notice" : "renewal_intent",
        billing_interval: info.billing_interval === "yearly" ? "yearly" : "monthly",
        expected_amount: info.expected_amount == null || !Number.isFinite(quoted) ? null : quoted,
        transfer_reference: typeof info.transfer_reference === "string" ? info.transfer_reference : "",
        payer_name: typeof info.payer_name === "string" ? info.payer_name : "",
        transfer_at: typeof info.transfer_at === "string" ? info.transfer_at : ""
      };
    }));
    const response = ok({
      store: store.data,
      cycles: cycles.data ?? [],
      payment_requests: paymentRequests,
      approval_events: approvals.data ?? [],
      receipts: (receipts.data ?? []).map((row) => ({
        ...row,
        package_name: typeof row.package_snapshot?.package_name === "string" ? row.package_snapshot.package_name : "",
        billing_interval: row.package_snapshot?.billing_interval === "yearly" ? "yearly" : "monthly",
        period_start: typeof row.package_snapshot?.period_start === "string" ? row.package_snapshot.period_start : "",
        period_end: typeof row.package_snapshot?.period_end === "string" ? row.package_snapshot.period_end : ""
      }))
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}
