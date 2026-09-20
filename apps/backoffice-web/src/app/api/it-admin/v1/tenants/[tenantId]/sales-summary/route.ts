import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, parseTenantParam, requireItAdmin, type ItAdminContext } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";

type Period = "day" | "month" | "year";
type Order = {
  id: string; order_no: string | null; branch_id: string; status: string; created_at: string;
  subtotal: number | string | null; discount_amount: number | string | null;
  total_amount: number | string | null; grand_total: number | string | null;
  tax_total: number | string | null; gp_amount: number | string | null;
};
type Item = { id: string; order_id: string; product_id: string | null; name: string | null; quantity: number | string | null; unit_price: number | string | null; line_total: number | string | null };
type Payment = { id: string; order_id: string; method: string; status: string; amount: number | string | null; received_at: string | null };
type Product = { id: string; branch_id: string | null; sku: string | null; name: string; category: string | null; price: number | string | null; is_active: boolean };
type Branch = { id: string; code: string; name: string; is_active: boolean };

const PAGE_SIZE = 500;
const MAX_ORDERS = 2500;
const MAX_PRODUCTS = 2500;
const MAX_ITEMS_PER_CHUNK = 1000;

function amount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
function round(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }
function net(order: Order): number {
  const grand = order.grand_total == null ? null : amount(order.grand_total);
  return grand !== null && grand > 0 ? grand : amount(order.total_amount);
}
function gross(order: Order): number {
  const subtotal = amount(order.subtotal);
  return subtotal > 0 ? subtotal : amount(order.total_amount) + amount(order.discount_amount) + amount(order.gp_amount);
}
function bangkokDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
function parseDate(value: string | null): string {
  const date = value ?? bangkokDay(new Date().toISOString());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) {
    throw new ItAdminGuardError("invalid_report_date", "Date must be YYYY-MM-DD.", 422);
  }
  return date;
}
function range(period: Period, date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const start = period === "year" ? new Date(Date.UTC(y, 0, 1)) : period === "month" ? new Date(Date.UTC(y, m - 1, 1)) : new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start.getTime());
  if (period === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + 1);
  const label = (value: Date) => value.toISOString().slice(0, 10);
  return { startDate: label(start), endDate: label(end), from: label(start) + "T00:00:00+07:00", until: label(end) + "T00:00:00+07:00" };
}
async function scope(ctx: ItAdminContext, tenantId: string, branchId: string) {
  const [tenantResult, branchResult] = await Promise.all([
    ctx.supabase.from("tenants").select("id,name,display_name").eq("id", tenantId).maybeSingle<{ id: string; name: string; display_name: string | null }>(),
    ctx.supabase.from("branches").select("id,code,name,is_active").eq("tenant_id", tenantId).order("name").returns<Branch[]>()
  ]);
  if (tenantResult.error) throw new Error("report_tenant_failed:" + tenantResult.error.message);
  if (!tenantResult.data) throw new ItAdminGuardError("tenant_not_found", "Store not found.", 404);
  if (branchResult.error) throw new Error("report_branches_failed:" + branchResult.error.message);
  const branches = branchResult.data ?? [];
  if (branchId !== "all" && !branches.some((b) => b.id === branchId)) throw new ItAdminGuardError("branch_not_found", "Branch does not belong to this store.", 404);
  return { tenant: tenantResult.data, branches };
}
async function loadOrders(ctx: ItAdminContext, tenantId: string, branchId: string, from: string, until: string): Promise<Order[]> {
  const results: Order[] = [];
  for (let page = 0; page <= MAX_ORDERS / PAGE_SIZE; page++) {
    let query = ctx.supabase.from("orders")
      .select("id,order_no,branch_id,status,created_at,subtotal,discount_amount,total_amount,grand_total,tax_total,gp_amount")
      .eq("tenant_id", tenantId).gte("created_at", new Date(from).toISOString()).lt("created_at", new Date(until).toISOString())
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (branchId !== "all") query = query.eq("branch_id", branchId);
    const { data, error } = await query.returns<Order[]>();
    if (error) throw new Error("report_orders_failed:" + error.message);
    results.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
    if (results.length >= MAX_ORDERS) throw new ItAdminGuardError("report_window_too_large", "พบรายการมากเกินขีดจำกัด 2,500 บิล กรุณาเลือกช่วงวันที่แคบลงเพื่อให้ยอดรวมถูกต้อง", 422);
  }
  return results;
}
async function loadProducts(ctx: ItAdminContext, tenantId: string, branchId: string): Promise<Product[]> {
  const rows: Product[] = [];
  for (let page = 0; page <= MAX_PRODUCTS / PAGE_SIZE; page++) {
    let query = ctx.supabase.from("products").select("id,branch_id,sku,name,category,price,is_active")
      .eq("tenant_id", tenantId).is("deleted_at", null).order("name").range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (branchId !== "all") query = query.or("branch_id.is.null,branch_id.eq." + branchId);
    const { data, error } = await query.returns<Product[]>();
    if (error) throw new Error("report_products_failed:" + error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
    if (rows.length >= MAX_PRODUCTS) throw new ItAdminGuardError("catalog_too_large", "สินค้ามากเกิน 2,500 รายการ กรุณาเลือกเฉพาะสาขา", 422);
  }
  return rows;
}
async function relatedRows(ctx: ItAdminContext, tenantId: string, completed: Order[]) {
  const items: Item[] = [], payments: Payment[] = [];
  for (let i = 0; i < completed.length; i += 60) {
    const ids = completed.slice(i, i + 60).map((o) => o.id);
    const [a, b] = await Promise.all([
      ctx.supabase.from("order_items").select("id,order_id,product_id,name,quantity,unit_price,line_total")
        .eq("tenant_id", tenantId).in("order_id", ids).range(0, MAX_ITEMS_PER_CHUNK - 1).returns<Item[]>(),
      ctx.supabase.from("payments").select("id,order_id,method,status,amount,received_at")
        .eq("tenant_id", tenantId).in("order_id", ids).eq("status", "paid").range(0, MAX_ITEMS_PER_CHUNK - 1).returns<Payment[]>()
    ]);
    if (a.error) throw new Error("report_order_items_failed:" + a.error.message);
    if (b.error) throw new Error("report_payments_failed:" + b.error.message);
    if ((a.data ?? []).length >= MAX_ITEMS_PER_CHUNK || (b.data ?? []).length >= MAX_ITEMS_PER_CHUNK) {
      throw new ItAdminGuardError("report_items_limit", "รายละเอียดบิลเกินขีดจำกัด กรุณาเลือกช่วงวันที่แคบลง", 422);
    }
    items.push(...(a.data ?? [])); payments.push(...(b.data ?? []));
  }
  return { items, payments };
}
async function receipt(ctx: ItAdminContext, tenantId: string, branchId: string, orderId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new ItAdminGuardError("invalid_order_id", "Invalid receipt.", 422);
  let query = ctx.supabase.from("orders").select("id,order_no,branch_id,status,created_at,subtotal,discount_amount,total_amount,grand_total,tax_total,gp_amount").eq("tenant_id", tenantId).eq("id", orderId);
  if (branchId !== "all") query = query.eq("branch_id", branchId);
  const { data, error } = await query.maybeSingle<Order>();
  if (error) throw new Error("receipt_query_failed:" + error.message);
  if (!data) throw new ItAdminGuardError("receipt_not_found", "ไม่พบบิลของร้าน/สาขาที่เลือก", 404);
  const [itemsResult, paymentsResult] = await Promise.all([
    ctx.supabase.from("order_items").select("id,order_id,product_id,name,quantity,unit_price,line_total").eq("tenant_id", tenantId).eq("order_id", orderId).returns<Item[]>(),
    ctx.supabase.from("payments").select("id,order_id,method,status,amount,received_at").eq("tenant_id", tenantId).eq("order_id", orderId).returns<Payment[]>()
  ]);
  if (itemsResult.error) throw new Error("receipt_items_failed:" + itemsResult.error.message);
  if (paymentsResult.error) throw new Error("receipt_payments_failed:" + paymentsResult.error.message);
  return { order: { ...data, gross: round(gross(data)), net: round(net(data)) }, items: itemsResult.data ?? [], payments: paymentsResult.data ?? [] };
}

export async function GET(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const { tenantId: rawTenantId } = await context.params;
    const tenantId = parseTenantParam(rawTenantId);
    const url = new URL(req.url);
    const branchId = url.searchParams.get("branchId")?.trim() || "all";
    const identity = await scope(admin, tenantId, branchId);
    const orderId = url.searchParams.get("orderId");
    if (orderId) {
      const response = ok(await receipt(admin, tenantId, branchId, orderId));
      response.headers.set("cache-control", "private, no-store");
      return response;
    }
    const rawPeriod = url.searchParams.get("period") || "day";
    if (!["day", "month", "year"].includes(rawPeriod)) return fail("invalid_period", "Use day, month or year.", 422);
    const period = rawPeriod as Period;
    const date = parseDate(url.searchParams.get("date"));
    const window = range(period, date);
    const orders = await loadOrders(admin, tenantId, branchId, window.from, window.until);
    const completed = orders.filter((o) => o.status === "completed");
    const cancelled = orders.filter((o) => o.status === "cancelled");
    const [{ items, payments }, products] = await Promise.all([
      relatedRows(admin, tenantId, completed), loadProducts(admin, tenantId, branchId)
    ]);
    const branchNames = new Map(identity.branches.map((b) => [b.id, b.name]));
    const productNames = new Map(products.map((p) => [p.id, p.name]));
    const sold = new Map<string, { key: string; productId: string | null; name: string; quantity: number; amount: number }>();
    for (const item of items) {
      const key = item.product_id ?? "snapshot:" + (item.name ?? "ไม่ระบุสินค้า");
      const row = sold.get(key) ?? { key, productId: item.product_id, name: item.name || productNames.get(item.product_id ?? "") || "ไม่ระบุสินค้า", quantity: 0, amount: 0 };
      row.quantity += amount(item.quantity); row.amount += amount(item.line_total); sold.set(key, row);
    }
    const paidMethods = new Map<string, number>(), receiptMethods = new Map<string, string[]>();
    for (const payment of payments) {
      paidMethods.set(payment.method, (paidMethods.get(payment.method) ?? 0) + amount(payment.amount));
      receiptMethods.set(payment.order_id, [...(receiptMethods.get(payment.order_id) ?? []), payment.method]);
    }
    const daily = new Map<string, { date: string; bills: number; amount: number }>();
    for (const order of completed) {
      const day = bangkokDay(order.created_at);
      const row = daily.get(day) ?? { date: day, bills: 0, amount: 0 };
      row.bills++; row.amount += net(order); daily.set(day, row);
    }
    const summary = {
      completedCount: completed.length, cancelledCount: cancelled.length,
      gross: round(completed.reduce((v, o) => v + gross(o), 0)),
      net: round(completed.reduce((v, o) => v + net(o), 0)),
      discount: round(completed.reduce((v, o) => v + amount(o.discount_amount), 0)),
      cancelledValue: round(cancelled.reduce((v, o) => v + net(o), 0)),
      averageBill: completed.length ? round(completed.reduce((v, o) => v + net(o), 0) / completed.length) : 0
    };
    const response = ok({
      tenant: identity.tenant, branches: identity.branches, period, date, branchId,
      range: { from: window.startDate, untilExclusive: window.endDate, timezone: "Asia/Bangkok" },
      summary,
      paymentMethods: [...paidMethods].map(([method, value]) => ({ method, amount: round(value) })).sort((a, b) => b.amount - a.amount),
      daily: [...daily.values()].map((d) => ({ ...d, amount: round(d.amount) })).sort((a, b) => a.date.localeCompare(b.date)),
      receipts: orders.map((o) => ({
        id: o.id, orderNo: o.order_no || o.id.slice(0, 8), branchId: o.branch_id,
        branchName: branchNames.get(o.branch_id) ?? "ไม่ระบุสาขา", createdAt: o.created_at,
        status: o.status, gross: round(gross(o)), net: round(net(o)), discount: round(amount(o.discount_amount)),
        methods: receiptMethods.get(o.id) ?? []
      })),
      soldProducts: [...sold.values()].map((p) => ({ ...p, quantity: round(p.quantity), amount: round(p.amount) })).sort((a, b) => b.quantity - a.quantity),
      products: products.map((p) => ({ ...p, branchName: p.branch_id ? (branchNames.get(p.branch_id) ?? "ไม่ระบุสาขา") : "ทุกสาขา" }))
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
}
