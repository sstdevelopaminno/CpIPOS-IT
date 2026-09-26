import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type Store = {
  id: string; code: string | null; name: string; display_name: string | null;
  owner_name: string | null; primary_owner_user_id: string | null; is_active: boolean;
};
type Contract = {
  id: string; tenant_id: string; package_id: string; billing_interval: string | null;
  status: string; started_at: string | null; ended_at: string | null;
  amount_per_cycle: number | null; currency: string | null; created_at: string;
};
type Package = { id: string; code: string; name: string; monthly_price: number | null; yearly_price: number | null };
type Cycle = { id: string; tenant_id: string; package_id: string; period_start: string; period_end: string;
  amount_due: number; amount_paid: number; status: string; created_at: string };
type Payment = { id: string; tenant_id: string; status: string; evidence_url: string | null;
  amount_reported: number | null; submitted_at: string | null; reviewed_at: string | null; created_at: string;
  metadata: Record<string, unknown> | null };
type Owner = { id: string; email: string | null };
type Lifecycle = { tenant_id: string; lifecycle_status: string; access_locked: boolean;
  trial_expires_at: string | null; subscription_expires_at: string | null };
type Receipt = { id: string; tenant_id: string; payment_request_id: string; receipt_number: string;
  issued_at: string; amount: number; currency: string };

function daysRemaining(endDate: string | null, now: number): number | null {
  if (!endDate) return null;
  const parsed = Date.parse(endDate);
  if (!Number.isFinite(parsed)) return null;
  return Math.ceil((parsed - now) / 86_400_000);
}

export async function GET() {
  try {
    const { supabase } = await requireItAdmin();
    const [storesResult, packagesResult] = await Promise.all([
      supabase.from("tenants")
        .select("id,code,name,display_name,owner_name,primary_owner_user_id,is_active")
        .order("created_at", { ascending: false }).limit(500).returns<Store[]>(),
      supabase.from("subscription_packages")
        .select("id,code,name,monthly_price,yearly_price").limit(200).returns<Package[]>()
    ]);
    if (storesResult.error) throw new Error("subscription_payment_stores_query_failed");
    if (packagesResult.error) throw new Error("subscription_payment_packages_query_failed");
    const stores = storesResult.data ?? [];
    const ids = stores.map((store) => store.id);
    if (!ids.length) return ok({ rows: [], generated_at: new Date().toISOString() });

    const ownerIds = [...new Set(stores.map((store) => store.primary_owner_user_id).filter((id): id is string => Boolean(id)))];
    const [contractsResult, cyclesResult, paymentsResult, ownersResult, lifecycleResult, receiptsResult] = await Promise.all([
      supabase.from("tenant_subscription_contracts")
        .select("id,tenant_id,package_id,billing_interval,status,started_at,ended_at,amount_per_cycle,currency,created_at")
        .in("tenant_id", ids).order("created_at", { ascending: false }).limit(1000).returns<Contract[]>(),
      supabase.from("tenant_billing_cycles")
        .select("id,tenant_id,package_id,period_start,period_end,amount_due,amount_paid,status,created_at")
        .in("tenant_id", ids).order("created_at", { ascending: false }).limit(1000).returns<Cycle[]>(),
      supabase.from("tenant_subscription_payment_requests")
        .select("id,tenant_id,status,evidence_url,amount_reported,submitted_at,reviewed_at,created_at,metadata")
        .in("tenant_id", ids).order("created_at", { ascending: false }).limit(1000).returns<Payment[]>(),
      ownerIds.length
        ? supabase.from("users_profiles").select("id,email").in("id", ownerIds).returns<Owner[]>()
        : Promise.resolve({ data: [] as Owner[], error: null }),
      supabase.from("tenant_data_lifecycle")
        .select("tenant_id,lifecycle_status,access_locked,trial_expires_at,subscription_expires_at")
        .in("tenant_id", ids).returns<Lifecycle[]>(),
      supabase.from("tenant_subscription_receipts")
        .select("id,tenant_id,payment_request_id,receipt_number,issued_at,amount,currency")
        .in("tenant_id", ids).order("issued_at", { ascending: false }).limit(1000).returns<Receipt[]>()
    ]);
    if (contractsResult.error || cyclesResult.error || paymentsResult.error || ownersResult.error ||
        lifecycleResult.error || receiptsResult.error) {
      throw new Error("subscription_payment_data_query_failed");
    }

    const packagesById = new Map((packagesResult.data ?? []).map((item) => [item.id, item]));
    const ownersById = new Map((ownersResult.data ?? []).map((item) => [item.id, item]));
    const latestByTenant = <T extends { tenant_id: string }>(items: T[]) => {
      const map = new Map<string, T>();
      for (const item of items) if (!map.has(item.tenant_id)) map.set(item.tenant_id, item);
      return map;
    };
    const contracts = latestByTenant(contractsResult.data ?? []);
    const cycles = latestByTenant(cyclesResult.data ?? []);
    const payments = latestByTenant(paymentsResult.data ?? []);
    const receipts = latestByTenant(receiptsResult.data ?? []);
    const lifecycleByTenant = new Map((lifecycleResult.data ?? []).map((item) => [item.tenant_id, item]));
    const now = Date.now();

    const rows = stores.map((store) => {
      const contract = contracts.get(store.id);
      const pkg = contract ? packagesById.get(contract.package_id) : undefined;
      const cycle = cycles.get(store.id);
      const payment = payments.get(store.id);
      const receipt = receipts.get(store.id);
      const lifecycle = lifecycleByTenant.get(store.id);
      const isInternalDemo = lifecycle?.lifecycle_status === "sales_demo";
      const isTrial = lifecycle?.lifecycle_status === "trial" || contract?.status === "trial";
      const effectiveExpiry = isInternalDemo ? null
        : isTrial ? lifecycle?.trial_expires_at ?? contract?.ended_at ?? null
        : lifecycle?.subscription_expires_at ?? contract?.ended_at ?? null;
      const interval = contract?.billing_interval === "yearly" ? "yearly"
        : contract?.billing_interval === "monthly" ? "monthly" : "other";
      return {
        tenant_id: store.id, store_code: store.code ?? "—",
        store_name: store.display_name || store.name, owner_name: store.owner_name,
        billing_email: store.primary_owner_user_id ? ownersById.get(store.primary_owner_user_id)?.email ?? null : null,
        package_name: pkg?.name ?? "ยังไม่กำหนด", package_code: pkg?.code ?? null,
        billing_interval: interval,
        service_status: !store.is_active ? "store_suspended" : isInternalDemo ? "internal_demo"
          : lifecycle?.access_locked ? "locked" : contract?.status ?? "no_contract",
        is_internal_demo: isInternalDemo,
        start_date: contract?.started_at ?? null, end_date: effectiveExpiry,
        days_remaining: daysRemaining(effectiveExpiry, now),
        amount_per_cycle: contract?.amount_per_cycle ?? (interval === "yearly" ? pkg?.yearly_price : pkg?.monthly_price) ?? null,
        currency: contract?.currency ?? "THB",
        billing_cycle: cycle ? { id: cycle.id, status: cycle.status, amount_due: cycle.amount_due,
          amount_paid: cycle.amount_paid, period_start: cycle.period_start, period_end: cycle.period_end } : null,
        payment: payment ? {
          id: payment.id,
          status: payment.status,
          amount_reported: payment.amount_reported,
          submitted_at: payment.submitted_at,
          reviewed_at: payment.reviewed_at,
          has_evidence: Boolean(payment.evidence_url),
          source: typeof payment.metadata?.source === "string" ? payment.metadata.source : "unknown",
          kind: payment.metadata?.kind === "payment_notice" ? "payment_notice" : "renewal_intent",
          billing_interval: payment.metadata?.billing_interval === "yearly" ? "yearly" : "monthly",
          expected_amount: payment.metadata?.expected_amount == null ||
            !Number.isFinite(Number(payment.metadata.expected_amount))
            ? null
            : Number(payment.metadata.expected_amount)
        } : null,
        has_paid_cycle: Boolean(cycle && Number(cycle.amount_due) > 0
          && Number(cycle.amount_paid) >= Number(cycle.amount_due) && cycle.status === "paid"),
        receipt: receipt ? {
          id: receipt.id, payment_request_id: receipt.payment_request_id,
          number: receipt.receipt_number, issued_at: receipt.issued_at,
          amount: receipt.amount, currency: receipt.currency
        } : null,
        contract_id: contract?.id ?? null
      };
    });
    const response = ok({ rows, generated_at: new Date().toISOString() });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}
