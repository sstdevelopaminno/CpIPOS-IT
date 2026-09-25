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
  review_note: string | null; created_at: string
};
type Approval = { id: string; payment_request_id: string | null; action: string; from_status: string | null;
  to_status: string | null; created_at: string };

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
    const [cycles, requests, approvals] = await Promise.all([
      supabase.from("tenant_billing_cycles")
        .select("id,period_start,period_end,amount_due,amount_paid,status,created_at,package_id")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100).returns<Cycle[]>(),
      supabase.from("tenant_subscription_payment_requests")
        .select("id,request_type,requested_package_id,amount_reported,currency,evidence_url,status,submitted_at,reviewed_at,review_note,created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100).returns<RequestRow[]>(),
      supabase.from("tenant_subscription_approval_events")
        .select("id,payment_request_id,action,from_status,to_status,created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(100).returns<Approval[]>()
    ]);
    if (cycles.error || requests.error || approvals.error) throw new Error("subscription_payment_history_read_failed");
    const response = ok({
      store: store.data,
      cycles: cycles.data ?? [],
      payment_requests: (requests.data ?? []).map(({ evidence_url, ...row }) => ({
        ...row, has_evidence: Boolean(evidence_url)
      })),
      approval_events: approvals.data ?? []
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}
