import type { BranchRole, PlatformRole } from "@pos/shared-types";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type PosSalesSummaryBranchOption = {
  id: string;
  code: string;
  name: string;
};

export type PosSalesSummaryOption = {
  id: string;
  label: string;
};

export type PosSalesSummaryFilters = {
  dateFrom?: string | null;
  dateTo?: string | null;
  branchId?: string | null;
  shiftId?: string | null;
  cashierId?: string | null;
  paymentMethod?: string | null;
  status?: string | null;
};

export type PosSalesSummaryScope = {
  userId: string | null;
  tenantId: string | null;
  branchId: string | null;
  branchRole: BranchRole | null;
  platformRole: PlatformRole;
};

export type PosSalesSummaryPayload = {
  access: {
    canViewMultipleBranches: boolean;
    selfOnly: boolean;
    selectedBranchId: string;
  };
  filters: {
    dateFrom: string;
    dateTo: string;
    branchId: string;
    shiftId: string;
    cashierId: string;
    paymentMethod: string;
    status: string;
  };
  branchOptions: PosSalesSummaryBranchOption[];
  shiftOptions: PosSalesSummaryOption[];
  cashierOptions: PosSalesSummaryOption[];
  summary: {
    grossSales: number;
    netSales: number;
    receiptCount: number;
    cashTotal: number;
    qrTransferTotal: number;
    cardTotal: number;
    discountTotal: number;
    taxTotal: number;
    refundTotal: number;
    cancelledTotal: number;
    cancelledCount: number;
    averageReceiptValue: number;
  };
  paymentMethods: Array<{
    method: string;
    label: string;
    amount: number;
    receiptCount: number;
  }>;
  shifts: Array<{
    id: string;
    branchId: string;
    branchName: string;
    openedAt: string;
    closedAt: string | null;
    cashierName: string;
    openingCash: number;
    cashSales: number;
    expectedCash: number;
    actualCash: number | null;
    difference: number | null;
    receiptCount: number;
    netSales: number;
  }>;
  cashiers: Array<{
    cashierId: string;
    cashierName: string;
    receiptCount: number;
    grossSales: number;
    netSales: number;
    cancelledTotal: number;
    cancelledCount: number;
    averageReceiptValue: number;
  }>;
  bestSellingProducts: Array<{
    productId: string;
    productName: string;
    category: string;
    quantitySold: number;
    grossAmount: number;
    netAmount: number;
  }>;
  salesRows: Array<{
    id: string;
    receiptNo: string;
    branchId: string;
    branchName: string;
    shiftId: string | null;
    createdAt: string;
    cashierName: string;
    paymentMethod: string;
    paymentLabel: string;
    grossTotal: number;
    discount: number;
    tax: number;
    netTotal: number;
    status: string;
  }>;
};

type BranchRow = {
  id: string;
  code: string | null;
  name: string | null;
  is_active: boolean | null;
};

type MembershipRow = {
  branch_id: string | null;
  role: BranchRole | null;
};

type OrderRow = {
  id: string;
  order_no: string | null;
  branch_id: string;
  shift_id: string | null;
  subtotal: number | null;
  discount_amount: number | null;
  gp_amount?: number | null;
  total_amount: number | null;
  grand_total?: number | null;
  tax_total?: number | null;
  status: string | null;
  created_at: string;
  created_by: string | null;
  cashier_user_id?: string | null;
  payment_completed_by?: string | null;
};

type PaymentRow = {
  order_id: string | null;
  method: string | null;
  amount: number | null;
};

type ShiftRow = {
  id: string;
  branch_id: string;
  opened_by: string | null;
  opened_at: string | null;
  closed_at: string | null;
  opening_cash: number | null;
  expected_cash: number | null;
  actual_cash: number | null;
  status: string | null;
};

type OrderItemRow = {
  order_id: string | null;
  product_id: string | null;
  quantity: number | null;
  line_total: number | null;
};

type ProductRow = {
  id: string;
  name: string | null;
  category: string | null;
};

const MAX_DAYS = 120;
const ORDER_LIMIT = 1200;
const VALID_STATUS = new Set(["all", "completed", "cancelled", "draft", "queued", "preparing"]);
const VALID_PAYMENT_METHOD = new Set(["all", "cash", "bank_transfer", "card", "other"]);

function emptyPayload(filters: PosSalesSummaryPayload["filters"]): PosSalesSummaryPayload {
  return {
    access: { canViewMultipleBranches: false, selfOnly: true, selectedBranchId: filters.branchId },
    filters,
    branchOptions: [],
    shiftOptions: [],
    cashierOptions: [],
    summary: {
      grossSales: 0,
      netSales: 0,
      receiptCount: 0,
      cashTotal: 0,
      qrTransferTotal: 0,
      cardTotal: 0,
      discountTotal: 0,
      taxTotal: 0,
      refundTotal: 0,
      cancelledTotal: 0,
      cancelledCount: 0,
      averageReceiptValue: 0
    },
    paymentMethods: [],
    shifts: [],
    cashiers: [],
    bestSellingProducts: [],
    salesRows: []
  };
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function getBangkokDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function normalizeDateInput(input: string | null | undefined, fallback: string): string {
  const value = String(input ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback;
}

function getDefaultFilters(input: PosSalesSummaryFilters): PosSalesSummaryPayload["filters"] {
  const today = getBangkokDate(new Date());
  const sevenDaysAgo = getBangkokDate(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
  const dateFrom = normalizeDateInput(input.dateFrom, sevenDaysAgo);
  const dateTo = normalizeDateInput(input.dateTo, today);
  const fromTime = new Date(`${dateFrom}T00:00:00+07:00`).getTime();
  const toTime = new Date(`${dateTo}T23:59:59+07:00`).getTime();
  const rangeTooLarge = Number.isFinite(fromTime) && Number.isFinite(toTime) && toTime - fromTime > MAX_DAYS * 24 * 60 * 60 * 1000;
  const safeDateFrom = rangeTooLarge ? getBangkokDate(new Date(toTime - (MAX_DAYS - 1) * 24 * 60 * 60 * 1000)) : dateFrom;
  const status = VALID_STATUS.has(String(input.status ?? "all")) ? String(input.status ?? "all") : "all";
  const paymentMethod = VALID_PAYMENT_METHOD.has(String(input.paymentMethod ?? "all")) ? String(input.paymentMethod ?? "all") : "all";

  return {
    dateFrom: safeDateFrom,
    dateTo,
    branchId: String(input.branchId ?? "all").trim() || "all",
    shiftId: String(input.shiftId ?? "all").trim() || "all",
    cashierId: String(input.cashierId ?? "all").trim() || "all",
    paymentMethod,
    status
  };
}

function isPrivilegedRole(scope: PosSalesSummaryScope): boolean {
  return (
    scope.platformRole === "it_admin" ||
    scope.branchRole === "owner" ||
    scope.branchRole === "manager" ||
    scope.branchRole === "accountant"
  );
}

function canSeeAllTenantBranches(scope: PosSalesSummaryScope): boolean {
  return scope.platformRole === "it_admin" || scope.branchRole === "owner";
}

function normalizePaymentMethod(method: string | null | undefined): { key: string; label: string } {
  const normalized = String(method ?? "").trim().toLowerCase();
  if (normalized === "cash") return { key: "cash", label: "เงินสด" };
  if (normalized === "bank_transfer" || normalized === "transfer" || normalized.includes("qr") || normalized.includes("promptpay")) {
    return { key: "bank_transfer", label: "โอน / QR" };
  }
  if (normalized === "card" || normalized.includes("credit") || normalized.includes("debit")) {
    return { key: "card", label: "บัตรเครดิต / เดบิต" };
  }
  return { key: "other", label: "อื่น ๆ" };
}

function isMissingColumnError(errorMessage: string | null | undefined): boolean {
  const normalized = String(errorMessage ?? "").toLowerCase();
  return normalized.includes("column") || normalized.includes("schema cache") || normalized.includes("does not exist");
}

function getOrderCashierId(order: OrderRow): string {
  return order.cashier_user_id ?? order.payment_completed_by ?? order.created_by ?? "";
}

function getOrderGross(order: OrderRow): number {
  const subtotal = toNumber(order.subtotal);
  if (subtotal > 0) return subtotal;
  return toNumber(order.total_amount) + toNumber(order.discount_amount) + toNumber(order.gp_amount);
}

function getOrderNet(order: OrderRow): number {
  const grandTotal = order.grand_total == null ? null : toNumber(order.grand_total);
  if (grandTotal !== null && grandTotal > 0) return grandTotal;
  return toNumber(order.total_amount);
}

async function loadOrders(args: {
  tenantId: string;
  branchIds: string[];
  filters: PosSalesSummaryPayload["filters"];
  selfOnlyUserId: string | null;
}) {
  const supabase = getSupabaseServiceClient();
  const startIso = new Date(`${args.filters.dateFrom}T00:00:00+07:00`).toISOString();
  const endIso = new Date(`${args.filters.dateTo}T23:59:59+07:00`).toISOString();

  const buildQuery = (selectClause: string) => {
    let query = supabase
      .from("orders")
      .select(selectClause)
      .eq("tenant_id", args.tenantId)
      .gte("created_at", startIso)
      .lte("created_at", endIso)
      .order("created_at", { ascending: false })
      .limit(ORDER_LIMIT);

    query = args.branchIds.length === 1 ? query.eq("branch_id", args.branchIds[0]) : query.in("branch_id", args.branchIds);
    if (args.filters.status !== "all") query = query.eq("status", args.filters.status);
    if (args.filters.shiftId !== "all") query = query.eq("shift_id", args.filters.shiftId);
    if (args.selfOnlyUserId) query = query.eq("created_by", args.selfOnlyUserId);
    return query;
  };

  const fullSelect =
    "id,order_no,branch_id,shift_id,subtotal,discount_amount,gp_amount,total_amount,grand_total,tax_total,status,created_at,created_by,cashier_user_id,payment_completed_by";
  const baseSelect = "id,order_no,branch_id,shift_id,subtotal,discount_amount,gp_amount,total_amount,status,created_at,created_by";
  let result = await buildQuery(fullSelect);
  if (result.error && isMissingColumnError(result.error.message)) {
    result = await buildQuery(baseSelect);
  }
  if (result.error) throw new Error(`orders_query_failed:${result.error.message}`);
  return (result.data ?? []) as unknown as OrderRow[];
}

export async function loadPosSalesSummaryData(
  scope: PosSalesSummaryScope,
  inputFilters: PosSalesSummaryFilters = {}
): Promise<PosSalesSummaryPayload> {
  const filters = getDefaultFilters(inputFilters);
  if (!scope.tenantId || !scope.userId) return emptyPayload(filters);

  const supabase = getSupabaseServiceClient();
  const [branchesResult, membershipsResult] = await Promise.all([
    supabase.from("branches").select("id,code,name,is_active").eq("tenant_id", scope.tenantId).order("name", { ascending: true }),
    scope.platformRole === "it_admin"
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("user_branch_roles").select("branch_id,role").eq("tenant_id", scope.tenantId).eq("user_id", scope.userId)
  ]);
  if (branchesResult.error) throw new Error(`branches_query_failed:${branchesResult.error.message}`);
  if (membershipsResult.error) throw new Error(`branch_membership_query_failed:${membershipsResult.error.message}`);

  const branchRows = ((branchesResult.data ?? []) as BranchRow[]).filter((row) => row.is_active !== false);
  const membershipRows = (membershipsResult.data ?? []) as MembershipRow[];
  const membershipBranchIds = new Set(membershipRows.map((row) => String(row.branch_id ?? "")).filter(Boolean));
  const allowAllTenantBranches = canSeeAllTenantBranches(scope);
  const allowedBranchIds = new Set(
    allowAllTenantBranches ? branchRows.map((row) => row.id) : branchRows.filter((row) => membershipBranchIds.has(row.id)).map((row) => row.id)
  );
  if (!allowAllTenantBranches && scope.branchId) allowedBranchIds.add(scope.branchId);

  const branchOptions = branchRows
    .filter((row) => allowedBranchIds.has(row.id))
    .map((row) => ({ id: row.id, code: row.code ?? row.id, name: row.name ?? row.id }));

  const canViewMultipleBranches = isPrivilegedRole(scope) && branchOptions.length > 1;
  const fallbackBranchId = scope.branchId && allowedBranchIds.has(scope.branchId) ? scope.branchId : branchOptions[0]?.id ?? "";
  const requestedBranchId = filters.branchId === "all" ? "all" : filters.branchId;
  const selectedBranchId =
    canViewMultipleBranches && requestedBranchId === "all"
      ? "all"
      : requestedBranchId !== "all" && allowedBranchIds.has(requestedBranchId)
        ? requestedBranchId
        : fallbackBranchId;
  const branchScopeIds = selectedBranchId === "all" ? branchOptions.map((branch) => branch.id) : selectedBranchId ? [selectedBranchId] : [];
  const selfOnly = !isPrivilegedRole(scope);
  const nextFilters = { ...filters, branchId: selectedBranchId || "all" };
  if (branchScopeIds.length === 0) return { ...emptyPayload(nextFilters), branchOptions };

  const ordersRaw = await loadOrders({
    tenantId: scope.tenantId,
    branchIds: branchScopeIds,
    filters: nextFilters,
    selfOnlyUserId: selfOnly ? scope.userId : null
  });
  const ordersBeforeCashier = ordersRaw.filter((order) => (nextFilters.cashierId === "all" ? true : getOrderCashierId(order) === nextFilters.cashierId));
  if (ordersBeforeCashier.length === 0) {
    return {
      ...emptyPayload(nextFilters),
      access: { canViewMultipleBranches, selfOnly, selectedBranchId: nextFilters.branchId },
      branchOptions
    };
  }

  const orderIds = ordersBeforeCashier.map((order) => order.id);
  const shiftIds = Array.from(new Set(ordersBeforeCashier.map((order) => order.shift_id).filter((id): id is string => Boolean(id))));
  const userIds = Array.from(new Set(ordersBeforeCashier.flatMap((order) => [order.created_by, getOrderCashierId(order)]).filter((id): id is string => Boolean(id))));

  const [paymentsResult, itemsResult, shiftsResult, usersResult] = await Promise.all([
    supabase.from("payments").select("order_id,method,amount").eq("tenant_id", scope.tenantId).in("order_id", orderIds),
    supabase.from("order_items").select("order_id,product_id,quantity,line_total").eq("tenant_id", scope.tenantId).in("order_id", orderIds),
    shiftIds.length
      ? supabase
          .from("shifts")
          .select("id,branch_id,opened_by,opened_at,closed_at,opening_cash,expected_cash,actual_cash,status")
          .eq("tenant_id", scope.tenantId)
          .in("id", shiftIds)
      : Promise.resolve({ data: [], error: null }),
    userIds.length ? supabase.from("users_profiles").select("id,full_name").in("id", userIds) : Promise.resolve({ data: [], error: null })
  ]);
  if (paymentsResult.error) throw new Error(`payments_query_failed:${paymentsResult.error.message}`);
  if (itemsResult.error) throw new Error(`order_items_query_failed:${itemsResult.error.message}`);
  if (shiftsResult.error) throw new Error(`shifts_query_failed:${shiftsResult.error.message}`);
  if (usersResult.error) throw new Error(`users_profiles_query_failed:${usersResult.error.message}`);

  const paymentRows = (paymentsResult.data ?? []) as PaymentRow[];
  const orderPaymentMap = new Map<string, Array<{ key: string; label: string; amount: number }>>();
  for (const payment of paymentRows) {
    if (!payment.order_id) continue;
    const normalized = normalizePaymentMethod(payment.method);
    const rows = orderPaymentMap.get(payment.order_id) ?? [];
    rows.push({ ...normalized, amount: toNumber(payment.amount) });
    orderPaymentMap.set(payment.order_id, rows);
  }

  const orders = ordersBeforeCashier.filter((order) => {
    if (nextFilters.paymentMethod === "all") return true;
    return (orderPaymentMap.get(order.id) ?? []).some((payment) => payment.key === nextFilters.paymentMethod);
  });
  const includedOrderIds = new Set(orders.map((order) => order.id));
  const completedOrders = orders.filter((order) => order.status === "completed");
  const completedOrderIds = new Set(completedOrders.map((order) => order.id));
  const cancelledOrders = orders.filter((order) => order.status === "cancelled");

  const itemRows = ((itemsResult.data ?? []) as OrderItemRow[]).filter((item) => item.order_id && includedOrderIds.has(item.order_id));
  const productIds = Array.from(new Set(itemRows.map((item) => item.product_id).filter((id): id is string => Boolean(id))));
  const productsResult = productIds.length
    ? await supabase.from("products").select("id,name,category").eq("tenant_id", scope.tenantId).in("id", productIds)
    : { data: [], error: null };
  if (productsResult.error) throw new Error(`products_query_failed:${productsResult.error.message}`);

  const branchMap = new Map(branchOptions.map((branch) => [branch.id, branch]));
  const userMap = new Map(((usersResult.data ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => [row.id, row.full_name ?? row.id]));
  const shiftRows = (shiftsResult.data ?? []) as ShiftRow[];
  const shiftMap = new Map(shiftRows.map((shift) => [shift.id, shift]));
  const productMap = new Map(((productsResult.data ?? []) as ProductRow[]).map((product) => [product.id, product]));

  const paymentBuckets = new Map<string, { method: string; label: string; amount: number; receiptIds: Set<string> }>();
  for (const order of completedOrders) {
    for (const payment of orderPaymentMap.get(order.id) ?? []) {
      const bucket = paymentBuckets.get(payment.key) ?? { method: payment.key, label: payment.label, amount: 0, receiptIds: new Set<string>() };
      bucket.amount += payment.amount;
      bucket.receiptIds.add(order.id);
      paymentBuckets.set(payment.key, bucket);
    }
  }

  const cashiers = new Map<
    string,
    { cashierId: string; cashierName: string; receiptCount: number; grossSales: number; netSales: number; cancelledTotal: number; cancelledCount: number }
  >();
  for (const order of orders) {
    const cashierId = getOrderCashierId(order) || "unknown";
    const cashierName = userMap.get(cashierId) ?? (cashierId === "unknown" ? "-" : cashierId);
    const bucket = cashiers.get(cashierId) ?? {
      cashierId,
      cashierName,
      receiptCount: 0,
      grossSales: 0,
      netSales: 0,
      cancelledTotal: 0,
      cancelledCount: 0
    };
    if (order.status === "completed") {
      bucket.receiptCount += 1;
      bucket.grossSales += getOrderGross(order);
      bucket.netSales += getOrderNet(order);
    } else if (order.status === "cancelled") {
      bucket.cancelledCount += 1;
      bucket.cancelledTotal += getOrderNet(order);
    }
    cashiers.set(cashierId, bucket);
  }

  const shiftBuckets = new Map<string, { receiptCount: number; cashSales: number; netSales: number }>();
  for (const order of completedOrders) {
    if (!order.shift_id) continue;
    const bucket = shiftBuckets.get(order.shift_id) ?? { receiptCount: 0, cashSales: 0, netSales: 0 };
    bucket.receiptCount += 1;
    bucket.netSales += getOrderNet(order);
    bucket.cashSales += (orderPaymentMap.get(order.id) ?? []).filter((payment) => payment.key === "cash").reduce((sum, payment) => sum + payment.amount, 0);
    shiftBuckets.set(order.shift_id, bucket);
  }

  const productBuckets = new Map<string, { productId: string; productName: string; category: string; quantitySold: number; grossAmount: number; netAmount: number }>();
  for (const item of itemRows) {
    if (!item.order_id || !completedOrderIds.has(item.order_id) || !item.product_id) continue;
    const product = productMap.get(item.product_id);
    const bucket = productBuckets.get(item.product_id) ?? {
      productId: item.product_id,
      productName: product?.name ?? item.product_id,
      category: product?.category ?? "-",
      quantitySold: 0,
      grossAmount: 0,
      netAmount: 0
    };
    bucket.quantitySold += toNumber(item.quantity);
    bucket.grossAmount += toNumber(item.line_total);
    bucket.netAmount += toNumber(item.line_total);
    productBuckets.set(item.product_id, bucket);
  }

  const grossSales = completedOrders.reduce((sum, order) => sum + getOrderGross(order), 0);
  const netSales = completedOrders.reduce((sum, order) => sum + getOrderNet(order), 0);
  const receiptCount = completedOrders.length;
  const discountTotal = completedOrders.reduce((sum, order) => sum + toNumber(order.discount_amount), 0);
  const taxTotal = completedOrders.reduce((sum, order) => sum + toNumber(order.tax_total), 0);
  const cancelledTotal = cancelledOrders.reduce((sum, order) => sum + getOrderNet(order), 0);
  const cashTotal = paymentBuckets.get("cash")?.amount ?? 0;
  const qrTransferTotal = paymentBuckets.get("bank_transfer")?.amount ?? 0;
  const cardTotal = paymentBuckets.get("card")?.amount ?? 0;

  const shiftOptions = shiftRows
    .map((shift) => ({ id: shift.id, label: `${userMap.get(shift.opened_by ?? "") ?? "-"} | ${shift.opened_at ? getBangkokDate(new Date(shift.opened_at)) : "-"}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const cashierOptions = Array.from(cashiers.values())
    .map((cashier) => ({ id: cashier.cashierId, label: cashier.cashierName }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    access: { canViewMultipleBranches, selfOnly, selectedBranchId: nextFilters.branchId },
    filters: nextFilters,
    branchOptions,
    shiftOptions,
    cashierOptions,
    summary: {
      grossSales: roundMoney(grossSales),
      netSales: roundMoney(netSales),
      receiptCount,
      cashTotal: roundMoney(cashTotal),
      qrTransferTotal: roundMoney(qrTransferTotal),
      cardTotal: roundMoney(cardTotal),
      discountTotal: roundMoney(discountTotal),
      taxTotal: roundMoney(taxTotal),
      refundTotal: 0,
      cancelledTotal: roundMoney(cancelledTotal),
      cancelledCount: cancelledOrders.length,
      averageReceiptValue: receiptCount > 0 ? roundMoney(netSales / receiptCount) : 0
    },
    paymentMethods: Array.from(paymentBuckets.values())
      .map((bucket) => ({
        method: bucket.method,
        label: bucket.label,
        amount: roundMoney(bucket.amount),
        receiptCount: bucket.receiptIds.size
      }))
      .sort((a, b) => b.amount - a.amount),
    shifts: shiftRows
      .map((shift) => {
        const totals = shiftBuckets.get(shift.id) ?? { receiptCount: 0, cashSales: 0, netSales: 0 };
        const openingCash = toNumber(shift.opening_cash);
        const expectedCash = shift.expected_cash == null ? openingCash + totals.cashSales : toNumber(shift.expected_cash);
        const actualCash = shift.actual_cash == null ? null : toNumber(shift.actual_cash);
        return {
          id: shift.id,
          branchId: shift.branch_id,
          branchName: branchMap.get(shift.branch_id)?.name ?? "-",
          openedAt: shift.opened_at ?? "",
          closedAt: shift.closed_at,
          cashierName: userMap.get(shift.opened_by ?? "") ?? "-",
          openingCash: roundMoney(openingCash),
          cashSales: roundMoney(totals.cashSales),
          expectedCash: roundMoney(expectedCash),
          actualCash,
          difference: actualCash == null ? null : roundMoney(actualCash - expectedCash),
          receiptCount: totals.receiptCount,
          netSales: roundMoney(totals.netSales)
        };
      })
      .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()),
    cashiers: Array.from(cashiers.values())
      .map((cashier) => ({
        ...cashier,
        grossSales: roundMoney(cashier.grossSales),
        netSales: roundMoney(cashier.netSales),
        cancelledTotal: roundMoney(cashier.cancelledTotal),
        averageReceiptValue: cashier.receiptCount > 0 ? roundMoney(cashier.netSales / cashier.receiptCount) : 0
      }))
      .sort((a, b) => b.netSales - a.netSales),
    bestSellingProducts: Array.from(productBuckets.values())
      .map((product) => ({
        ...product,
        quantitySold: Number(product.quantitySold.toFixed(3)),
        grossAmount: roundMoney(product.grossAmount),
        netAmount: roundMoney(product.netAmount)
      }))
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 20),
    salesRows: orders.map((order) => {
      const payments = orderPaymentMap.get(order.id) ?? [];
      const primaryPayment = payments[0] ?? { key: "other", label: "ยังไม่ชำระ", amount: 0 };
      return {
        id: order.id,
        receiptNo: order.order_no ?? order.id,
        branchId: order.branch_id,
        branchName: branchMap.get(order.branch_id)?.name ?? "-",
        shiftId: order.shift_id,
        createdAt: order.created_at,
        cashierName: userMap.get(getOrderCashierId(order)) ?? "-",
        paymentMethod: primaryPayment.key,
        paymentLabel: payments.length > 1 ? "หลายช่องทาง" : primaryPayment.label,
        grossTotal: roundMoney(getOrderGross(order)),
        discount: roundMoney(toNumber(order.discount_amount)),
        tax: roundMoney(toNumber(order.tax_total)),
        netTotal: roundMoney(getOrderNet(order)),
        status: order.status ?? "-"
      };
    })
  };
}
