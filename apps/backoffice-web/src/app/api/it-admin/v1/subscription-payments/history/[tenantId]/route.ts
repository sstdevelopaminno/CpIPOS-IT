import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ tenantId: string }> };
type Store = {
  id: string; code: string | null; name: string; display_name: string | null;
  owner_name: string | null; primary_owner_user_id: string | null;
};
type Owner = { id: string; email: string | null };
type Contract = {
  id: string; package_id: string; billing_interval: string | null; status: string;
  started_at: string | null; ended_at: string | null; amount_per_cycle: number | null;
  currency: string | null; created_at: string;
};
type Lifecycle = {
  lifecycle_status: string; access_locked: boolean; trial_expires_at: string | null;
  subscription_expires_at: string | null;
};
type PackageRow = {
  id: string; code: string; name: string; monthly_price: number | null; yearly_price: number | null;
  is_active: boolean; status: string; quota_mode: string | null; display_order: number | null;
};
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
type Approval = {
  id: string; payment_request_id: string | null; action: string; from_status: string | null;
  to_status: string | null; created_at: string
};
type Receipt = {
  id: string; payment_request_id: string; billing_cycle_id: string; receipt_number: string;
  issued_at: string; amount: number; currency: string; package_snapshot: Record<string,unknown> | null
};
type ReceiptAnnotation = {
  receipt_id:string; correction_note:string|null; voided_at:string|null;
};

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { tenantId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new ItAdminGuardError("invalid_tenant", "Invalid store identifier.", 422);
    }

    const { supabase } = await requireItAdmin();
    const [store, contract, lifecycle, packages, cycles, requests, approvals, receipts, receiptAnnotations] = await Promise.all([
      supabase.from("tenants")
        .select("id,code,name,display_name,owner_name,primary_owner_user_id")
        .eq("id", tenantId).maybeSingle<Store>(),
      supabase.from("tenant_subscription_contracts")
        .select("id,package_id,billing_interval,status,started_at,ended_at,amount_per_cycle,currency,created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1).maybeSingle<Contract>(),
      supabase.from("tenant_data_lifecycle")
        .select("lifecycle_status,access_locked,trial_expires_at,subscription_expires_at")
        .eq("tenant_id", tenantId).maybeSingle<Lifecycle>(),
      supabase.from("subscription_packages")
        .select("id,code,name,monthly_price,yearly_price,is_active,status,quota_mode,display_order")
        .eq("is_active", true).order("display_order", { ascending: true }).limit(100).returns<PackageRow[]>(),
      supabase.from("tenant_billing_cycles")
        .select("id,period_start,period_end,amount_due,amount_paid,status,created_at,package_id")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200).returns<Cycle[]>(),
      supabase.from("tenant_subscription_payment_requests")
        .select("id,request_type,requested_package_id,amount_reported,currency,evidence_url,status,submitted_at,reviewed_at,review_note,created_at,metadata")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200).returns<RequestRow[]>(),
      supabase.from("tenant_subscription_approval_events")
        .select("id,payment_request_id,action,from_status,to_status,created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(200).returns<Approval[]>(),
      supabase.from("tenant_subscription_receipts")
        .select("id,payment_request_id,billing_cycle_id,receipt_number,issued_at,amount,currency,package_snapshot")
        .eq("tenant_id", tenantId).order("issued_at", { ascending: false }).limit(200).returns<Receipt[]>(),
      supabase.from("tenant_subscription_receipt_annotations")
        .select("receipt_id,correction_note,voided_at")
        .eq("tenant_id",tenantId).returns<ReceiptAnnotation[]>()
    ]);

    if (store.error) throw new Error("history_store_read_failed");
    if (!store.data) throw new ItAdminGuardError("store_not_found", "Store not found.", 404);
    if (contract.error || lifecycle.error || packages.error || cycles.error || requests.error || approvals.error || receipts.error || receiptAnnotations.error) {
      throw new Error("subscription_payment_history_read_failed");
    }

    let billingEmail: string | null = null;
    if (store.data.primary_owner_user_id) {
      const owner = await supabase.from("users_profiles")
        .select("id,email").eq("id", store.data.primary_owner_user_id).maybeSingle<Owner>();
      if (!owner.error) billingEmail = owner.data?.email ?? null;
    }

    const packageRows = packages.data ?? [];
    const packagesById = new Map(packageRows.map((row) => [row.id, row]));
    const currentContract = contract.data;
    const currentPackage = currentContract ? packagesById.get(currentContract.package_id) : undefined;
    const lifecycleRow = lifecycle.data;
    const effectiveExpiry = lifecycleRow?.lifecycle_status === "trial"
      ? lifecycleRow.trial_expires_at ?? currentContract?.ended_at ?? null
      : lifecycleRow?.subscription_expires_at ?? currentContract?.ended_at ?? null;

    const paymentRequests = await Promise.all((requests.data ?? []).map(async ({ evidence_url, ...row }) => {
      let slip_url: string | null = null;
      if (evidence_url?.startsWith(tenantId + "/")) {
        const signed = await supabase.storage.from("subscription-payment-evidence")
          .createSignedUrl(evidence_url, 300);
        if (!signed.error && signed.data) slip_url = signed.data.signedUrl;
      }
      const { metadata, ...visible } = row;
      const info = metadata ?? {};
      const quoted = Number(info.expected_amount);
      const requestedPackage = row.requested_package_id ? packagesById.get(row.requested_package_id) : undefined;
      return {
        ...visible,
        has_evidence: Boolean(evidence_url),
        slip_url,
        kind: info.kind === "payment_notice" ? "payment_notice" : "renewal_intent",
        billing_interval: info.billing_interval === "yearly" ? "yearly" : "monthly",
        expected_amount: info.expected_amount == null || !Number.isFinite(quoted) ? null : quoted,
        transfer_reference: typeof info.transfer_reference === "string" ? info.transfer_reference : "",
        payer_name: typeof info.payer_name === "string" ? info.payer_name : "",
        transfer_at: typeof info.transfer_at === "string" ? info.transfer_at : "",
        note: typeof info.note === "string" ? info.note : "",
        source: typeof info.source === "string" ? info.source : "",
        requested_package_name: requestedPackage?.name ?? "",
        requested_package_code: requestedPackage?.code ?? ""
      };
    }));

    const annotationByReceipt = new Map((receiptAnnotations.data ?? []).map((row)=>[row.receipt_id,row]));
    const receiptRows = (receipts.data ?? []).map((row) => ({
      ...row,
      correction_note: annotationByReceipt.get(row.id)?.correction_note ?? null,
      voided_at: annotationByReceipt.get(row.id)?.voided_at ?? null,
      voided: Boolean(annotationByReceipt.get(row.id)?.voided_at),
      package_id: typeof row.package_snapshot?.package_id === "string" ? row.package_snapshot.package_id : "",
      package_code: typeof row.package_snapshot?.package_code === "string" ? row.package_snapshot.package_code : "",
      package_name: typeof row.package_snapshot?.package_name === "string" ? row.package_snapshot.package_name : "",
      billing_interval: row.package_snapshot?.billing_interval === "yearly" ? "yearly" : "monthly",
      period_start: typeof row.package_snapshot?.period_start === "string" ? row.package_snapshot.period_start : "",
      period_end: typeof row.package_snapshot?.period_end === "string" ? row.package_snapshot.period_end : ""
    }));

    const monthlyReceipts = receiptRows.filter((row) => row.billing_interval === "monthly");
    const yearlyReceipts = receiptRows.filter((row) => row.billing_interval === "yearly");
    const response = ok({
      store: {
        ...store.data,
        billing_email: billingEmail
      },
      contract: currentContract ? {
        ...currentContract,
        package_name: currentPackage?.name ?? "",
        package_code: currentPackage?.code ?? "",
        effective_expires_at: effectiveExpiry,
        lifecycle_status: lifecycleRow?.lifecycle_status ?? currentContract.status,
        access_locked: lifecycleRow?.access_locked === true
      } : null,
      packages: packageRows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        monthly_price: row.monthly_price == null ? null : numeric(row.monthly_price),
        yearly_price: row.yearly_price == null ? null : numeric(row.yearly_price),
        quota_mode: row.quota_mode ?? "standard"
      })),
      cycles: (cycles.data ?? []).map((row) => ({
        ...row,
        package_name: packagesById.get(row.package_id)?.name ?? "",
        package_code: packagesById.get(row.package_id)?.code ?? ""
      })),
      payment_requests: paymentRequests,
      approval_events: approvals.data ?? [],
      receipts: receiptRows,
      summary: {
        total_paid: receiptRows.reduce((sum, row) => sum + numeric(row.amount), 0),
        monthly_paid: monthlyReceipts.reduce((sum, row) => sum + numeric(row.amount), 0),
        yearly_paid: yearlyReceipts.reduce((sum, row) => sum + numeric(row.amount), 0),
        receipt_count: receiptRows.length,
        monthly_count: monthlyReceipts.length,
        yearly_count: yearlyReceipts.length,
        pending_request_count: paymentRequests.filter((row) => ["pending","under_review"].includes(row.status)).length,
        paid_cycle_count: (cycles.data ?? []).filter((row) => row.status === "paid").length
      }
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}
