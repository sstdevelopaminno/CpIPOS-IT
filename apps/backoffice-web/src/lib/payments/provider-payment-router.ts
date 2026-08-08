import "server-only";

import {
  getPrimarySupabaseServiceClient,
  getTrialSupabaseServiceClient,
  TenantDataRoutingError
} from "@/lib/supabase-admin";

type ProviderName = "inet_nops";

type ProviderPaymentRow = {
  payment_group_id: string;
  total_paid: number;
  order_status: string;
  duplicate_request: boolean;
};

function firstRow<T>(data: T | T[] | null): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function trialRoutingEnabled() {
  const value = String(process.env.TRIAL_DATA_ROUTING_ENABLED ?? "false").trim().toLowerCase();
  return value === "true" || value === "1";
}

function mapProviderPaymentError(message: string) {
  if (message.includes("PAYMENT_TOTAL_MISMATCH")) {
    return { code: "payment_total_mismatch", status: 422, message: "Provider payment amount does not match order total." };
  }
  if (message.includes("ORDER_CANCELLED_OR_NOT_FOUND") || message.includes("ORDER_NOT_FOUND")) {
    return { code: "order_not_found", status: 404, message: "Provider payment order was not found or is not payable." };
  }
  if (message.includes("TRIAL_BRANCH_SCOPE_INACTIVE")) {
    return { code: "trial_branch_scope_inactive", status: 409, message: "Trial branch scope is inactive." };
  }
  if (message.includes("UNSUPPORTED_PAYMENT_PROVIDER")) {
    return { code: "unsupported_payment_provider", status: 422, message: "Unsupported trusted payment provider." };
  }
  return { code: "provider_payment_tx_failed", status: 500, message: `Provider payment transaction failed: ${message}` };
}

export async function completeTrustedProviderPayment(args: {
  tenantId: string;
  branchId: string;
  orderId: string;
  receivedBy: string;
  amount: number;
  referenceNo: string | null;
  requestGroupId: string;
  provider: ProviderName;
}) {
  const primary = getPrimarySupabaseServiceClient();
  const { data: lifecycle, error: lifecycleError } = await primary
    .from("tenant_data_lifecycle")
    .select("data_home")
    .eq("tenant_id", args.tenantId)
    .maybeSingle<{ data_home: "primary" | "trial" | "archive" }>();

  if (lifecycleError) {
    return { ok: false as const, code: "tenant_data_lifecycle_lookup_failed", status: 500, message: lifecycleError.message };
  }

  const dataHome = lifecycle?.data_home ?? "primary";
  if (dataHome === "archive") {
    return { ok: false as const, code: "tenant_data_archived", status: 409, message: "Archived tenant data cannot accept provider payments." };
  }

  let client = primary;
  if (dataHome === "trial") {
    if (!trialRoutingEnabled()) {
      return {
        ok: false as const,
        code: "trial_data_routing_disabled",
        status: 503,
        message: "Trial data routing is disabled; provider payment failed closed."
      };
    }
    try {
      client = getTrialSupabaseServiceClient();
    } catch (error) {
      const message = error instanceof TenantDataRoutingError || error instanceof Error ? error.message : "Trial Supabase client is unavailable.";
      return { ok: false as const, code: "trial_data_plane_unavailable", status: 503, message };
    }
  }

  const { data, error } = await client.rpc("complete_pos_provider_payment_tx", {
    p_tenant_id: args.tenantId,
    p_branch_id: args.branchId,
    p_order_id: args.orderId,
    p_received_by: args.receivedBy,
    p_amount: args.amount,
    p_reference_no: args.referenceNo,
    p_request_group_id: args.requestGroupId,
    p_provider: args.provider
  });

  if (error) return { ok: false as const, ...mapProviderPaymentError(error.message) };
  const row = firstRow((data as ProviderPaymentRow[] | null) ?? null);
  if (!row) {
    return { ok: false as const, code: "provider_payment_tx_failed", status: 500, message: "Provider payment transaction returned no data." };
  }

  return {
    ok: true as const,
    data: {
      payment_group_id: row.payment_group_id,
      total_paid: Number(row.total_paid),
      status: row.order_status,
      duplicate_request: Boolean(row.duplicate_request)
    }
  };
}
