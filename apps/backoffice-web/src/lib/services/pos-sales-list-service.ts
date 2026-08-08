import type { BranchRole, PaymentMethod, PlatformRole } from "@pos/shared-types";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type PosSalesBranchOption = {
  id: string;
  code: string;
  name: string;
};

export type PosSalesShiftOption = {
  id: string;
  openedAt: string | null;
  status: string | null;
};

export type PosSalesListRecord = {
  id: string;
  billNo: string;
  openedAt: string;
  tableLabel: string;
  customerName: string;
  items: number;
  total: number;
  discountAmount: number;
  cashReceived: number | null;
  changeAmount: number | null;
  paymentReceivedTotal: number;
  paymentStatus: "unpaid" | PaymentMethod;
  saleStatus: "open" | "paid" | "void";
  channel: "counter" | "dine_in" | "delivery";
  orderType: "takeaway" | "dine_in" | "delivery_manual";
  externalOrderCode: string | null;
  notes: string | null;
  cashier: string;
  branchId: string;
  shiftId: string | null;
};

export type PosSalesListScope = {
  userId: string | null;
  tenantId: string | null;
  branchId: string | null;
  branchRole: BranchRole | null;
  platformRole: PlatformRole;
};

type PosSalesListPayload = {
  branchOptions: PosSalesBranchOption[];
  shiftOptions: PosSalesShiftOption[];
  records: PosSalesListRecord[];
};

type BreakerState = {
  failures: number;
  openUntil: number;
  lastSuccess: PosSalesListPayload | null;
  lastSuccessAt: number;
};

type OrderRow = {
  id: string;
  order_no: string;
  order_type: string | null;
  channel: string | null;
  customer_name: string | null;
  external_order_code: string | null;
  total_amount: number | null;
  status: string | null;
  created_at: string;
  branch_id: string;
  shift_id: string | null;
  created_by: string | null;
  payment_completed_by: string | null;
  table_id: string | null;
  discount_amount?: number | null;
  cash_received?: number | null;
  change_amount?: number | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
};

type PaymentRow = {
  order_id: string;
  method: string | null;
  received_at: string | null;
  amount?: number | null;
};

const DELIVERY_CHANNELS = new Set(["grab", "line_man", "shopee", "merchant_app", "other"]);
const FETCH_TIMEOUT_MS = 3500;
const BREAKER_FAILURE_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30000;
const breakerByScopeKey = new Map<string, BreakerState>();

function deriveSaleStatus(status: string | null): "open" | "paid" | "void" {
  if (status === "completed") return "paid";
  if (status === "cancelled") return "void";
  return "open";
}

function deriveSalesChannel(orderType: string | null, channel: string | null): "counter" | "dine_in" | "delivery" {
  if (orderType === "dine_in") return "dine_in";
  if (channel && DELIVERY_CHANNELS.has(channel)) return "delivery";
  return "counter";
}

function derivePaymentStatus(method: PaymentMethod | null): "unpaid" | PaymentMethod {
  if (method === "cash" || method === "bank_transfer") return method;
  return "unpaid";
}

function deriveOrderType(orderType: string | null): "takeaway" | "dine_in" | "delivery_manual" {
  if (orderType === "dine_in") return "dine_in";
  if (orderType === "delivery_manual") return "delivery_manual";
  return "takeaway";
}

function normalizePaymentMethod(method: string | null | undefined): PaymentMethod | null {
  const normalized = String(method ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "cash") return "cash";
  if (
    normalized === "bank_transfer" ||
    normalized === "transfer" ||
    normalized.includes("bank") ||
    normalized.includes("transfer") ||
    normalized.includes("promptpay")
  ) {
    return "bank_transfer";
  }
  return null;
}

function isMissingColumnError(errorMessage: string | null | undefined, column: string): boolean {
  const normalized = String(errorMessage ?? "").toLowerCase();
  return normalized.includes(column.toLowerCase()) && (normalized.includes("column") || normalized.includes("schema cache"));
}

function toTableLabel(row: OrderRow, tableName: string | null): string {
  const channel = row.channel ?? "";
  if (row.order_type === "dine_in") return tableName ?? "โต๊ะ";
  if (channel === "line_man") return "LINE MAN";
  if (channel === "grab") return "GrabFood";
  if (channel === "shopee") return "ShopeeFood";
  return "เคาน์เตอร์";
}

function emptyPayload(): PosSalesListPayload {
  return { branchOptions: [], shiftOptions: [], records: [] };
}

function isCrossBranchRole(scope: PosSalesListScope): boolean {
  return (
    scope.platformRole === "it_admin" ||
    scope.branchRole === "owner" ||
    scope.branchRole === "manager" ||
    scope.branchRole === "accountant"
  );
}

function scopeKey(scope: PosSalesListScope): string {
  const tenant = scope.tenantId ?? "no-tenant";
  const mode = isCrossBranchRole(scope) ? "all-branches" : `branch:${scope.branchId ?? "none"}`;
  return `${tenant}:${mode}`;
}

function getBreakerState(key: string): BreakerState {
  const existing = breakerByScopeKey.get(key);
  if (existing) return existing;
  const created: BreakerState = { failures: 0, openUntil: 0, lastSuccess: null, lastSuccessAt: 0 };
  breakerByScopeKey.set(key, created);
  return created;
}

export function invalidatePosSalesListCacheForScope(args: { tenantId: string; branchId?: string | null }) {
  const tenantPrefix = `${args.tenantId}:`;
  const branchKey = args.branchId ? `${args.tenantId}:branch:${args.branchId}` : null;
  for (const key of breakerByScopeKey.keys()) {
    if (!key.startsWith(tenantPrefix)) continue;
    if (key === `${args.tenantId}:all-branches` || (branchKey && key === branchKey)) {
      breakerByScopeKey.delete(key);
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}_timeout_${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function unwrapData<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) {
    throw new Error(`${label}_failed:${result.error.message}`);
  }
  return result.data as T;
}

async function loadPosSalesListDataRaw(scope: PosSalesListScope): Promise<PosSalesListPayload> {
  if (!scope.tenantId) {
    return emptyPayload();
  }
  if (!scope.userId && scope.platformRole !== "it_admin") {
    return emptyPayload();
  }

  const supabase = getSupabaseServiceClient();

  const [branchesResult, membershipsResult] = await Promise.all([
    supabase
      .from("branches")
      .select("id,code,name,is_active")
      .eq("tenant_id", scope.tenantId)
      .order("name", { ascending: true }),
    scope.platformRole === "it_admin"
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("user_branch_roles")
          .select("branch_id,role")
          .eq("tenant_id", scope.tenantId)
          .eq("user_id", scope.userId!)
  ]);

  const branchRows = unwrapData(
    branchesResult as { data: Array<{ id: string; code: string | null; name: string | null; is_active: boolean | null }> | null; error: { message: string } | null },
    "branches_query"
  );

  const membershipRows = unwrapData(
    membershipsResult as { data: Array<{ branch_id: string | null; role: BranchRole | null }> | null; error: { message: string } | null },
    "branch_membership_query"
  );

  const allowedBranchIds = new Set(
    scope.platformRole === "it_admin"
      ? (branchRows ?? [])
          .filter((row) => row.is_active !== false)
          .map((row) => String(row.id))
      : (membershipRows ?? []).map((row) => String(row.branch_id ?? "")).filter((value) => value.length > 0)
  );

  const branchOptions: PosSalesBranchOption[] = (branchRows ?? [])
    .filter((row) => row.is_active !== false && allowedBranchIds.has(String(row.id)))
    .map((row) => ({
      id: row.id,
      code: row.code ?? row.id,
      name: row.name ?? row.id
    }));

  const canViewAllBranches = isCrossBranchRole(scope);
  const defaultBranchId =
    scope.branchId && branchOptions.some((row) => row.id === scope.branchId)
      ? scope.branchId
      : branchOptions[0]?.id ?? null;
  const branchScopeIds = canViewAllBranches ? branchOptions.map((row) => row.id) : defaultBranchId ? [defaultBranchId] : [];
  if (branchScopeIds.length === 0) {
    return { branchOptions, shiftOptions: [], records: [] };
  }

  const buildOrderQuery = (selectClause: string) => {
    let query = supabase
      .from("orders")
      .select(selectClause)
      .eq("tenant_id", scope.tenantId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (branchScopeIds.length === 1) {
      query = query.eq("branch_id", branchScopeIds[0]);
    } else {
      query = query.in("branch_id", branchScopeIds);
    }

    return query;
  };

  let hasPaymentCompletedByColumn = true;
  let orderResult = await buildOrderQuery(
    "id,order_no,order_type,channel,customer_name,external_order_code,total_amount,status,created_at,branch_id,shift_id,created_by,payment_completed_by,table_id,discount_amount,cash_received,change_amount,notes,metadata"
  );
  if (orderResult.error && isMissingColumnError(orderResult.error.message, "payment_completed_by")) {
    hasPaymentCompletedByColumn = false;
    orderResult = await buildOrderQuery(
      "id,order_no,order_type,channel,customer_name,external_order_code,total_amount,status,created_at,branch_id,shift_id,created_by,table_id,metadata"
    );
  }
  if (orderResult.error && isMissingColumnError(orderResult.error.message, "metadata")) {
    orderResult = await buildOrderQuery(
      hasPaymentCompletedByColumn
        ? "id,order_no,order_type,channel,customer_name,external_order_code,total_amount,status,created_at,branch_id,shift_id,created_by,payment_completed_by,table_id,discount_amount,cash_received,change_amount,notes"
        : "id,order_no,order_type,channel,customer_name,external_order_code,total_amount,status,created_at,branch_id,shift_id,created_by,table_id"
    );
  }

  const orderRowsRaw = unwrapData(
    orderResult as { data: Array<Omit<OrderRow, "payment_completed_by"> & { payment_completed_by?: string | null }> | null; error: { message: string } | null },
    "orders_query"
  );
  const orderRows: OrderRow[] = (orderRowsRaw ?? []).map((row) => ({
    ...row,
    payment_completed_by: row.payment_completed_by ?? null
  })).filter((row) => (row.metadata as { sales_list_deleted?: boolean } | null | undefined)?.sales_list_deleted !== true);
  if (!orderRows || orderRows.length === 0) {
    return { branchOptions, shiftOptions: [], records: [] };
  }

  const orderIds = orderRows.map((row) => row.id);
  const userIds = Array.from(
    new Set(orderRows.flatMap((row) => [row.created_by, row.payment_completed_by]).filter((id): id is string => Boolean(id)))
  );
  const shiftIds = Array.from(new Set(orderRows.map((row) => row.shift_id).filter((id): id is string => Boolean(id))));
  const tableIds = Array.from(new Set(orderRows.map((row) => row.table_id).filter((id): id is string => Boolean(id))));

  const loadPayments = async () => {
    let paymentsResult = await supabase
      .from("payments")
      .select("order_id,method,received_at,amount")
      .eq("tenant_id", scope.tenantId)
      .in("order_id", orderIds)
      .order("received_at", { ascending: false });

    if (paymentsResult.error && isMissingColumnError(paymentsResult.error.message, "received_at")) {
      const fallbackResult = await supabase
        .from("payments")
        .select("order_id,method,created_at,amount")
        .eq("tenant_id", scope.tenantId)
        .in("order_id", orderIds)
        .order("created_at", { ascending: false });

      return {
        data: (fallbackResult.data ?? []).map((row) => ({
          order_id: String((row as { order_id?: string | null }).order_id ?? ""),
          method: (row as { method?: string | null }).method ?? null,
          received_at: (row as { created_at?: string | null }).created_at ?? null,
          amount: Number((row as { amount?: number | null }).amount ?? 0)
        })),
        error: fallbackResult.error
      };
    }

    return paymentsResult;
  };

  const [itemsResult, paymentsResult, usersResult, shiftsResult, tablesResult] = await Promise.all([
    supabase.from("order_items").select("order_id,quantity").in("order_id", orderIds),
    loadPayments(),
    userIds.length > 0
      ? supabase.from("users_profiles").select("id,full_name").in("id", userIds)
      : Promise.resolve({ data: [], error: null }),
    shiftIds.length > 0
      ? supabase.from("shifts").select("id,opened_at,status").in("id", shiftIds)
      : Promise.resolve({ data: [], error: null }),
    tableIds.length > 0
      ? supabase.from("dining_tables").select("id,table_name,table_code").in("id", tableIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  const itemRows = unwrapData(
    itemsResult as { data: Array<{ order_id: string; quantity: number | null }> | null; error: { message: string } | null },
    "order_items_query"
  );
  const paymentRows = unwrapData(
    paymentsResult as { data: PaymentRow[] | null; error: { message: string } | null },
    "payments_query"
  );
  const userRows = unwrapData(
    usersResult as { data: Array<{ id: string; full_name: string | null }> | null; error: { message: string } | null },
    "users_profiles_query"
  );
  const shiftRows = unwrapData(
    shiftsResult as { data: Array<{ id: string; opened_at: string | null; status: string | null }> | null; error: { message: string } | null },
    "shifts_query"
  );
  const tableRows = unwrapData(
    tablesResult as { data: Array<{ id: string; table_name: string | null; table_code: string | null }> | null; error: { message: string } | null },
    "tables_query"
  );

  const itemCountMap = new Map<string, number>();
  for (const row of itemRows ?? []) {
    itemCountMap.set(row.order_id, (itemCountMap.get(row.order_id) ?? 0) + Number(row.quantity ?? 0));
  }

  const paymentMethodMap = new Map<string, PaymentMethod>();
  const paymentReceivedTotalMap = new Map<string, number>();
  for (const row of paymentRows ?? []) {
    paymentReceivedTotalMap.set(row.order_id, (paymentReceivedTotalMap.get(row.order_id) ?? 0) + Number(row.amount ?? 0));
    const paymentMethod = normalizePaymentMethod(row.method);
    if (!paymentMethodMap.has(row.order_id) && paymentMethod) {
      paymentMethodMap.set(row.order_id, paymentMethod);
    }
  }

  const userMap = new Map<string, string>();
  for (const row of userRows ?? []) {
    userMap.set(row.id, row.full_name ?? row.id);
  }

  const tableMap = new Map<string, string>();
  for (const row of tableRows ?? []) {
    tableMap.set(row.id, row.table_name ?? row.table_code ?? row.id);
  }

  const shiftMap = new Map<string, { openedAt: string | null; status: string | null }>();
  for (const row of shiftRows ?? []) {
    shiftMap.set(row.id, { openedAt: row.opened_at, status: row.status });
  }

  const shiftOptions: PosSalesShiftOption[] = Array.from(shiftMap.entries())
    .map(([id, info]) => ({ id, openedAt: info.openedAt, status: info.status }))
    .sort((a, b) => {
      const aTime = a.openedAt ? new Date(a.openedAt).getTime() : 0;
      const bTime = b.openedAt ? new Date(b.openedAt).getTime() : 0;
      return bTime - aTime;
    });

  const records: PosSalesListRecord[] = orderRows.map((row) => {
    const cashierId = row.payment_completed_by ?? row.created_by ?? "";
    const tableName = row.table_id ? tableMap.get(row.table_id) ?? null : null;
    return {
      id: row.id,
      billNo: row.order_no ?? row.id,
      openedAt: row.created_at,
      tableLabel: toTableLabel(row, tableName),
      customerName: row.customer_name ?? row.external_order_code ?? "Walk-in",
      items: Math.max(1, itemCountMap.get(row.id) ?? 0),
      total: Number(row.total_amount ?? 0),
      discountAmount: Number(row.discount_amount ?? 0),
      cashReceived: row.cash_received == null ? null : Number(row.cash_received),
      changeAmount: row.change_amount == null ? null : Number(row.change_amount),
      paymentReceivedTotal: Number(paymentReceivedTotalMap.get(row.id) ?? 0),
      paymentStatus: derivePaymentStatus(paymentMethodMap.get(row.id) ?? null),
      saleStatus: deriveSaleStatus(row.status),
      channel: deriveSalesChannel(row.order_type, row.channel),
      orderType: deriveOrderType(row.order_type),
      externalOrderCode: row.external_order_code ?? null,
      notes: row.notes ?? null,
      cashier: cashierId ? userMap.get(cashierId) ?? cashierId : "-",
      branchId: row.branch_id,
      shiftId: row.shift_id
    };
  });

  return { branchOptions, shiftOptions, records };
}

export async function loadPosSalesListData(scope: PosSalesListScope): Promise<PosSalesListPayload> {
  if (!scope.tenantId) {
    return emptyPayload();
  }

  const key = scopeKey(scope);
  const state = getBreakerState(key);
  const now = Date.now();

  if (state.openUntil > now) {
    return state.lastSuccess ?? emptyPayload();
  }

  try {
    const payload = await withTimeout(loadPosSalesListDataRaw(scope), FETCH_TIMEOUT_MS, "pos_sales_list");
    state.failures = 0;
    state.openUntil = 0;
    state.lastSuccess = payload;
    state.lastSuccessAt = now;
    return payload;
  } catch {
    state.failures += 1;
    if (state.failures >= BREAKER_FAILURE_THRESHOLD) {
      state.openUntil = now + BREAKER_COOLDOWN_MS;
    }
    return state.lastSuccess ?? emptyPayload();
  }
}
