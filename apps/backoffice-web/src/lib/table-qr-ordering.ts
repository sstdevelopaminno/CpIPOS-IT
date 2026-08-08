import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import type { AuthContext } from "@/lib/auth-context";
import { readRequiredEnv } from "@/lib/env";
import { invalidatePosBranchRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { enqueueKitchenTicketForOrderSnapshot } from "@/lib/printing/print-service";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const ACTIVE_TABLE_STATUSES = ["open", "ordering", "pending_payment"];
const DEFAULT_QR_TTL_HOURS = 18;

type QrSessionRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_id: string;
  table_session_id: string;
  status: "active" | "revoked" | "expired";
  expires_at: string;
  created_by: string;
};

type QrContext = QrSessionRow & {
  table_code: string;
  table_name: string | null;
  branch_name: string;
  store_name: string;
  table_status: string;
  table_session_status: string;
  table_session_order_id: string | null;
};

type SubmitQrOrderRow = {
  submission_id: string;
  order_id: string;
  order_no: string;
  table_id: string;
  table_session_id: string;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  duplicate_request: boolean;
};

type TableQrServiceRequestType = "call_staff" | "request_checkout";
type TableQrOrderItemInput = { product_id: string; quantity: number; note?: string | null };

type TableQrMenuProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
};

type SubmittedOrderSummary = {
  item_count: number;
  total_amount: number;
  items: Array<{ product_id: string; name: string; quantity: number; unit_price: number; line_total: number }>;
};

type SubmittedOrderItemRow = {
  product_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  products: { name?: string | null } | null;
};

type TableQrProductRow = {
  id: string;
  name: string;
  price: number;
  is_active?: boolean;
};

type TableQrMenuCacheEntry = {
  expiresAt: number;
  products: TableQrMenuProduct[];
};

const TABLE_QR_MENU_CACHE_TTL_MS = 60_000;
const tableQrMenuCache = new Map<string, TableQrMenuCacheEntry>();

function readTableQrMenuCache(tenantId: string, branchId: string): TableQrMenuProduct[] | null {
  const key = `${tenantId}:${branchId}`;
  const entry = tableQrMenuCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    tableQrMenuCache.delete(key);
    return null;
  }
  return entry.products;
}

function writeTableQrMenuCache(tenantId: string, branchId: string, products: TableQrMenuProduct[]) {
  tableQrMenuCache.set(`${tenantId}:${branchId}`, {
    expiresAt: Date.now() + TABLE_QR_MENU_CACHE_TTL_MS,
    products
  });
}

function signingSecret(): string {
  return readRequiredEnv("TABLE_QR_SIGNING_SECRET", "table_qr_signing_secret_missing");
}

function signatureFor(sessionId: string, secret = signingSecret()): string {
  return createHmac("sha256", secret).update(`table-order:${sessionId}`).digest("base64url");
}

export function buildTableQrToken(sessionId: string): string {
  return `${sessionId}.${signatureFor(sessionId)}`;
}

export function parseAndVerifyTableQrToken(token: string): string | null {
  const [sessionId, signature, extra] = token.split(".");
  if (!sessionId || !signature || extra) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  const expected = signatureFor(sessionId);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  return timingSafeEqual(actualBuffer, expectedBuffer) ? sessionId : null;
}

export async function issueTableQrSession(args: {
  auth: AuthContext;
  tableId: string;
  requestOrigin: string;
}) {
  const { auth, tableId, requestOrigin } = args;
  if (!auth.tenantId || !auth.branchId) throw new Error("missing_scope");
  const secret = signingSecret();
  const supabase = getSupabaseServiceClient();

  const [{ data: table, error: tableError }, { data: tableSession, error: sessionError }] = await Promise.all([
    supabase
      .from("dining_tables")
      .select("id,table_code,table_name,status,is_active")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("id", tableId)
      .maybeSingle<{ id: string; table_code: string; table_name: string | null; status: string; is_active: boolean }>(),
    supabase
      .from("table_bill_sessions")
      .select("id,tenant_id,branch_id,table_id,status,opened_by")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("table_id", tableId)
      .in("status", ACTIVE_TABLE_STATUSES)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; tenant_id: string; branch_id: string; table_id: string; status: string; opened_by: string }>()
  ]);

  if (tableError) throw new Error(tableError.message);
  if (sessionError) throw new Error(sessionError.message);
  if (!table || !table.is_active || !["occupied", "ordering", "pending_payment"].includes(table.status)) {
    throw new Error("table_not_open");
  }
  if (!tableSession) throw new Error("table_session_not_open");

  const expiresAt = new Date(Date.now() + DEFAULT_QR_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("table_qr_sessions")
    .select("id,tenant_id,branch_id,table_id,table_session_id,status,expires_at,created_by")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("table_session_id", tableSession.id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<QrSessionRow>();

  let qrSession = existing;
  if (!qrSession) {
    await supabase
      .from("table_qr_sessions")
      .update({ status: "expired" })
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("table_session_id", tableSession.id)
      .eq("status", "active");

    const { data: created, error: createError } = await supabase
      .from("table_qr_sessions")
      .insert({
        tenant_id: auth.tenantId,
        branch_id: auth.branchId,
        table_id: tableId,
        table_session_id: tableSession.id,
        status: "active",
        expires_at: expiresAt,
        created_by: auth.userId
      })
      .select("id,tenant_id,branch_id,table_id,table_session_id,status,expires_at,created_by")
      .single<QrSessionRow>();
    if (createError) throw new Error(createError.message);
    qrSession = created;
  }

  const token = `${qrSession.id}.${signatureFor(qrSession.id, secret)}`;
  const orderUrl = `${requestOrigin.replace(/\/$/, "")}/table-order/${encodeURIComponent(token)}`;
  const qrDataUrl = await QRCode.toDataURL(orderUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 420,
    color: { dark: "#000000", light: "#ffffff" }
  });

  return {
    qr_session_id: qrSession.id,
    table_session_id: tableSession.id,
    table_id: table.id,
    table_code: table.table_code,
    table_name: table.table_name,
    order_url: orderUrl,
    qr_data_url: qrDataUrl,
    expires_at: qrSession.expires_at
  };
}

export async function resolveTableQrContext(token: string): Promise<QrContext> {
  const qrSessionId = parseAndVerifyTableQrToken(token);
  if (!qrSessionId) throw new Error("invalid_qr_token");
  const supabase = getSupabaseServiceClient();
  const { data: qr, error: qrError } = await supabase
    .from("table_qr_sessions")
    .select("id,tenant_id,branch_id,table_id,table_session_id,status,expires_at,created_by")
    .eq("id", qrSessionId)
    .maybeSingle<QrSessionRow>();
  if (qrError) throw new Error(qrError.message);
  if (!qr || qr.status !== "active" || new Date(qr.expires_at).getTime() <= Date.now()) {
    throw new Error("qr_session_expired");
  }

  const [{ data: tableSession }, { data: table }, { data: branch }, store] = await Promise.all([
    supabase
      .from("table_bill_sessions")
      .select("id,status,closed_at,order_id")
      .eq("id", qr.table_session_id)
      .eq("tenant_id", qr.tenant_id)
      .eq("branch_id", qr.branch_id)
      .eq("table_id", qr.table_id)
      .maybeSingle<{ id: string; status: string; closed_at: string | null; order_id: string | null }>(),
    supabase
      .from("dining_tables")
      .select("id,table_code,table_name,status,is_active")
      .eq("id", qr.table_id)
      .eq("tenant_id", qr.tenant_id)
      .eq("branch_id", qr.branch_id)
      .maybeSingle<{ id: string; table_code: string; table_name: string | null; status: string; is_active: boolean }>(),
    supabase
      .from("branches")
      .select("name")
      .eq("id", qr.branch_id)
      .eq("tenant_id", qr.tenant_id)
      .maybeSingle<{ name: string | null }>(),
    loadReceiptStoreProfile(qr.tenant_id)
  ]);

  if (!tableSession || !ACTIVE_TABLE_STATUSES.includes(tableSession.status) || tableSession.closed_at) {
    throw new Error("table_session_closed");
  }
  if (!table || !table.is_active || !["occupied", "ordering", "pending_payment"].includes(table.status)) {
    throw new Error("table_not_available");
  }

  return {
    ...qr,
    table_code: table.table_code,
    table_name: table.table_name,
    branch_name: branch?.name?.trim() || "Branch",
    store_name: store?.display_name?.trim() || store?.name?.trim() || "CpIPOS",
    table_status: table.status,
    table_session_status: tableSession.status,
    table_session_order_id: tableSession.order_id
  };
}

function canAcceptTableQrOrder(context: QrContext) {
  return context.table_session_status !== "pending_payment" && context.table_status !== "pending_payment";
}

function ensureTableQrOrderAcceptable(context: QrContext) {
  if (!canAcceptTableQrOrder(context)) throw new Error("table_order_not_available_pending_payment");
}

async function loadSubmittedOrderSummary(context: QrContext, supabase = getSupabaseServiceClient()): Promise<SubmittedOrderSummary> {
  const orderId = context.table_session_order_id;
  if (!orderId) return { item_count: 0, total_amount: 0, items: [] };

  const [{ data: orderRow, error: orderError }, { data: itemRows, error: itemError }] = await Promise.all([
    supabase
      .from("orders")
      .select("id,total_amount,grand_total")
      .eq("tenant_id", context.tenant_id)
      .eq("branch_id", context.branch_id)
      .eq("id", orderId)
      .maybeSingle<{ id: string; total_amount: number | null; grand_total: number | null }>(),
    supabase
      .from("order_items")
      .select("product_id,quantity,unit_price,line_total,products(name)")
      .eq("tenant_id", context.tenant_id)
      .eq("branch_id", context.branch_id)
      .eq("order_id", orderId)
      .limit(80)
  ]);

  if (orderError) throw new Error(orderError.message);
  if (itemError) throw new Error(itemError.message);

  const itemMap = new Map<string, { product_id: string; name: string; quantity: number; unit_price: number; line_total: number }>();
  for (const row of ((itemRows ?? []) as SubmittedOrderItemRow[])) {
    const productId = String(row.product_id ?? "").trim();
    if (!productId) continue;
    const unitPrice = Math.max(0, Number(row.unit_price ?? 0));
    const key = `${productId}:${unitPrice}`;
    const current = itemMap.get(key);
    const quantity = Math.max(0, Number(row.quantity ?? 0));
    const lineTotal = Math.max(0, Number(row.line_total ?? unitPrice * quantity));
    if (current) {
      current.quantity = Number((current.quantity + quantity).toFixed(3));
      current.line_total = Number((current.line_total + lineTotal).toFixed(2));
    } else {
      itemMap.set(key, {
        product_id: productId,
        name: String(row.products?.name ?? "Item"),
        quantity,
        unit_price: unitPrice,
        line_total: Number(lineTotal.toFixed(2))
      });
    }
  }

  const items = Array.from(itemMap.values()).filter((item) => item.quantity > 0);
  return {
    item_count: items.reduce((sum, item) => sum + item.quantity, 0),
    total_amount: Number(orderRow?.grand_total ?? orderRow?.total_amount ?? items.reduce((sum, item) => sum + item.line_total, 0)),
    items
  };
}

export async function loadTableQrMenu(context: QrContext) {
  const supabase = getSupabaseServiceClient();
  const [hasSubmittedFoodOrder, submittedSummary] = await Promise.all([
    hasSubmittedFoodOrderForContext(context, supabase),
    loadSubmittedOrderSummary(context, supabase)
  ]);
  const canOrder = canAcceptTableQrOrder(context);
  const common = {
    store_name: context.store_name,
    branch_name: context.branch_name,
    table_code: context.table_code,
    table_name: context.table_name,
    expires_at: context.expires_at,
    can_order: canOrder,
    order_status: context.table_session_order_id ? "queued" : null,
    bill_status: context.table_session_status,
    has_submitted_food_order: hasSubmittedFoodOrder,
    submitted_summary: submittedSummary
  };

  const cachedProducts = readTableQrMenuCache(context.tenant_id, context.branch_id);
  if (cachedProducts) {
    return {
      ...common,
      categories: Array.from(new Set(cachedProducts.map((product) => product.category))),
      products: cachedProducts
    };
  }

  const { data, error } = await supabase
    .from("products")
    .select("id,name,category,price,is_active")
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);

  const products = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    category: String(row.category ?? "เมนู"),
    price: Number(row.price ?? 0)
  }));
  writeTableQrMenuCache(context.tenant_id, context.branch_id, products);
  return {
    ...common,
    categories: Array.from(new Set(products.map((product) => product.category))),
    products
  };
}

export async function hasSubmittedFoodOrderForContext(context: QrContext, supabase = getSupabaseServiceClient()) {
  if (!context.table_session_order_id) return false;
  const { data, error } = await supabase
    .from("order_items")
    .select("id")
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("order_id", context.table_session_order_id)
    .gt("quantity", 0)
    .limit(1);

  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

export async function submitTableQrOrder(args: {
  context: QrContext;
  requestId: string;
  items: Array<{ product_id: string; quantity: number; note?: string | null }>;
  note?: string | null;
}) {
  const { context, requestId, items, note } = args;
  ensureTableQrOrderAcceptable(context);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("submit_table_qr_order_tx", {
    p_qr_session_id: context.id,
    p_request_id: requestId,
    p_items: items,
    p_note: note ?? null
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as SubmitQrOrderRow | null;
  if (!row) throw new Error("table_qr_order_failed");

  if (!row.duplicate_request) {
    invalidatePosBranchRuntimeCaches({ tenantId: context.tenant_id, branchId: context.branch_id });
    const productIds = items.map((item) => item.product_id);
    const { data: productRows } = await supabase
      .from("products")
      .select("id,name,price")
      .eq("tenant_id", context.tenant_id)
      .eq("branch_id", context.branch_id)
      .in("id", productIds);
    const productMap = new Map((productRows ?? []).map((product) => [String(product.id), product]));
    const printItems = items.map((item) => {
      const product = productMap.get(item.product_id);
      const unitPrice = Number(product?.price ?? 0);
      return {
        product_name: String(product?.name ?? "Item"),
        quantity: item.quantity,
        unit_price: unitPrice,
        line_total: Number((unitPrice * item.quantity).toFixed(2)),
        note: item.note ?? null
      };
    });
    const printAuth: AuthContext = {
      userId: context.created_by,
      platformRole: "tenant_user",
      tenantId: context.tenant_id,
      branchId: context.branch_id,
      branchRole: "staff"
    };
    try {
      await enqueueKitchenTicketForOrderSnapshot({
        auth: printAuth,
        order: {
          id: row.order_id,
          order_no: row.order_no
        },
        items: printItems,
        station: `Table ${context.table_code} QR`
      });
    } catch {
      // The order is already committed. Printing can be retried from the POS print queue without duplicating the order.
    }
  }

  return row;
}

function round2(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

function normalizeOrderItemInputs(items: TableQrOrderItemInput[]): Array<{ product_id: string; quantity: number; note: string | null }> {
  const itemMap = new Map<string, { product_id: string; quantity: number; note: string | null }>();
  for (const item of items) {
    const productId = String(item.product_id ?? "").trim();
    const quantity = Math.trunc(Number(item.quantity ?? 0));
    if (!productId || !Number.isFinite(quantity) || quantity < 0 || quantity > 99) {
      throw new Error("INVALID_ITEM");
    }
    if (quantity === 0) continue;
    const note = typeof item.note === "string" && item.note.trim() ? item.note.trim().slice(0, 240) : null;
    const key = `${productId}:${note ?? ""}`;
    const current = itemMap.get(key);
    if (current) {
      current.quantity = Math.min(99, current.quantity + quantity);
    } else {
      itemMap.set(key, { product_id: productId, quantity, note });
    }
  }
  return Array.from(itemMap.values());
}

async function loadOrderTotalsForQrResult(args: {
  context: QrContext;
  submissionId: string;
  orderId: string;
  duplicateRequest: boolean;
  supabase?: ReturnType<typeof getSupabaseServiceClient>;
}): Promise<SubmitQrOrderRow> {
  const supabase = args.supabase ?? getSupabaseServiceClient();
  const { data: orderRow, error } = await supabase
    .from("orders")
    .select("id,order_no,subtotal,tax_total,total_amount,grand_total")
    .eq("tenant_id", args.context.tenant_id)
    .eq("branch_id", args.context.branch_id)
    .eq("id", args.orderId)
    .maybeSingle<{ id: string; order_no: string; subtotal: number | null; tax_total: number | null; total_amount: number | null; grand_total: number | null }>();

  if (error) throw new Error(error.message);
  if (!orderRow) throw new Error("ORDER_NOT_FOUND");

  return {
    submission_id: args.submissionId,
    order_id: orderRow.id,
    order_no: orderRow.order_no,
    table_id: args.context.table_id,
    table_session_id: args.context.table_session_id,
    subtotal: Number(orderRow.subtotal ?? 0),
    tax_total: Number(orderRow.tax_total ?? 0),
    grand_total: Number(orderRow.grand_total ?? orderRow.total_amount ?? 0),
    duplicate_request: args.duplicateRequest
  };
}

async function calculateQrOrderTotals(args: {
  context: QrContext;
  subtotal: number;
  discountAmount: number;
  gpAmount: number;
  supabase: ReturnType<typeof getSupabaseServiceClient>;
}) {
  const baseAmount = Math.max(0, round2(args.subtotal - args.discountAmount - args.gpAmount));
  let taxTotal = 0;
  const taxLines: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }> = [];

  const { data: taxSettings, error } = await args.supabase
    .from("tenant_tax_settings")
    .select("is_enabled,settings")
    .eq("tenant_id", args.context.tenant_id)
    .eq("branch_id", args.context.branch_id)
    .limit(1)
    .maybeSingle<{ is_enabled: boolean | null; settings: { lines?: unknown[] } | null }>();

  if (error) throw new Error(error.message);

  if (taxSettings?.is_enabled === true && Array.isArray(taxSettings.settings?.lines)) {
    for (const rawLine of taxSettings.settings.lines) {
      if (!rawLine || typeof rawLine !== "object") continue;
      const line = rawLine as Record<string, unknown>;
      if (line.is_active === false) continue;
      const ratePct = Math.max(0, Number(line.rate_pct ?? 0));
      if (!Number.isFinite(ratePct) || ratePct <= 0) continue;
      const mode = String(line.mode ?? "add_to_bill");
      const amount = round2(baseAmount * (ratePct / 100)) * (mode === "deduct_from_bill" ? -1 : 1);
      taxTotal = round2(taxTotal + amount);
      taxLines.push({
        id: String(line.id ?? randomUUID()),
        label: String(line.label ?? "Tax"),
        rate_pct: ratePct,
        mode,
        amount
      });
    }
  }

  return {
    subtotal: round2(args.subtotal),
    tax_total: round2(taxTotal),
    grand_total: round2(Math.max(0, baseAmount + taxTotal)),
    tax_lines: taxLines
  };
}

export async function updateTableQrOrderItems(args: {
  context: QrContext;
  requestId: string;
  items: TableQrOrderItemInput[];
  note?: string | null;
}) {
  const { context, requestId, items, note } = args;
  ensureTableQrOrderAcceptable(context);
  const cleanRequestId = requestId.trim();
  if (!cleanRequestId) throw new Error("REQUEST_ID_REQUIRED");

  const cleanItems = normalizeOrderItemInputs(items);
  if (!context.table_session_order_id) {
    if (cleanItems.length > 0) {
      return submitTableQrOrder({ context, requestId: cleanRequestId, items: cleanItems, note });
    }
    throw new Error("TABLE_BILL_NOT_OPEN");
  }

  const supabase = getSupabaseServiceClient();
  const { data: existingSubmission, error: existingSubmissionError } = await supabase
    .from("table_qr_orders")
    .select("id,order_id")
    .eq("qr_session_id", context.id)
    .eq("request_id", cleanRequestId)
    .maybeSingle<{ id: string; order_id: string | null }>();
  if (existingSubmissionError) throw new Error(existingSubmissionError.message);
  if (existingSubmission?.order_id) {
    return loadOrderTotalsForQrResult({
      context,
      submissionId: existingSubmission.id,
      orderId: existingSubmission.order_id,
      duplicateRequest: true,
      supabase
    });
  }

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select("id,order_no,status,subtotal,discount_amount,gp_amount,tax_total,total_amount,grand_total,metadata")
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("id", context.table_session_order_id)
    .maybeSingle<{ id: string; order_no: string; status: string; subtotal: number | null; discount_amount: number | null; gp_amount: number | null; tax_total: number | null; total_amount: number | null; grand_total: number | null; metadata: Record<string, unknown> | null }>();
  if (orderError) throw new Error(orderError.message);
  if (!orderRow) throw new Error("ORDER_NOT_FOUND");
  if (["paid", "closed", "cleared", "cancelled", "completed"].includes(String(orderRow.status ?? "").toLowerCase())) {
    throw new Error("ORDER_NOT_APPENDABLE");
  }

  const productIds = cleanItems.map((item) => item.product_id);
  const productMap = new Map<string, TableQrProductRow>();
  if (productIds.length > 0) {
    const { data: productRows, error: productError } = await supabase
      .from("products")
      .select("id,name,price,is_active")
      .eq("tenant_id", context.tenant_id)
      .eq("branch_id", context.branch_id)
      .in("id", productIds);
    if (productError) throw new Error(productError.message);
    for (const product of (productRows ?? []) as TableQrProductRow[]) {
      if (product.is_active === false) continue;
      productMap.set(String(product.id), product);
    }
    for (const item of cleanItems) {
      if (!productMap.has(item.product_id)) throw new Error("PRODUCT_NOT_AVAILABLE");
    }
  }

  const orderItemsPayload = cleanItems.map((item) => {
    const product = productMap.get(item.product_id);
    const unitPrice = Number(product?.price ?? 0);
    return {
      tenant_id: context.tenant_id,
      branch_id: context.branch_id,
      order_id: orderRow.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: unitPrice,
      line_total: round2(unitPrice * item.quantity),
      notes: item.note
    };
  });
  const subtotal = round2(orderItemsPayload.reduce((sum, item) => sum + item.line_total, 0));
  const discountAmount = Math.min(subtotal, Math.max(0, Number(orderRow.discount_amount ?? 0)));
  const gpAmount = Math.min(Math.max(0, subtotal - discountAmount), Math.max(0, Number(orderRow.gp_amount ?? 0)));
  const totals = await calculateQrOrderTotals({ context, subtotal, discountAmount, gpAmount, supabase });

  const { data: oldItems, error: oldItemsError } = await supabase
    .from("order_items")
    .select("tenant_id,branch_id,order_id,product_id,quantity,unit_price,line_total,notes")
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("order_id", orderRow.id);
  if (oldItemsError) throw new Error(oldItemsError.message);

  const { error: deleteError } = await supabase
    .from("order_items")
    .delete()
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("order_id", orderRow.id);
  if (deleteError) throw new Error(deleteError.message);

  if (orderItemsPayload.length > 0) {
    const { error: insertError } = await supabase.from("order_items").insert(orderItemsPayload);
    if (insertError) {
      if ((oldItems ?? []).length > 0) await supabase.from("order_items").insert(oldItems);
      throw new Error(insertError.message);
    }
  }

  const updatedMetadata = {
    ...(orderRow.metadata ?? {}),
    tax_lines: totals.tax_lines,
    last_table_qr_order_at: new Date().toISOString(),
    last_table_qr_update: "replace_order"
  };
  const { error: updateOrderError } = await supabase
    .from("orders")
    .update({
      subtotal: totals.subtotal,
      discount_amount: discountAmount,
      gp_amount: gpAmount,
      tax_total: totals.tax_total,
      total_amount: totals.grand_total,
      grand_total: totals.grand_total,
      metadata: updatedMetadata
    })
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("id", orderRow.id);
  if (updateOrderError) {
    await supabase.from("order_items").delete().eq("tenant_id", context.tenant_id).eq("branch_id", context.branch_id).eq("order_id", orderRow.id);
    if ((oldItems ?? []).length > 0) await supabase.from("order_items").insert(oldItems);
    throw new Error(updateOrderError.message);
  }

  const { error: sessionStatusError } = await supabase
    .from("table_bill_sessions")
    .update({ status: "ordering" })
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("id", context.table_session_id);
  if (sessionStatusError) {
    console.warn("[table-qr-ordering] table bill session status update failed after bill update", {
      tableSessionId: context.table_session_id,
      orderId: orderRow.id,
      message: sessionStatusError.message
    });
  }

  const { error: tableStatusError } = await supabase
    .from("dining_tables")
    .update({ status: "ordering" })
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("id", context.table_id);
  if (tableStatusError) {
    console.warn("[table-qr-ordering] dining table status update failed after bill update", {
      tableId: context.table_id,
      orderId: orderRow.id,
      message: tableStatusError.message
    });
  }

  const submissionId = randomUUID();
  const { error: eventError } = await supabase.from("table_qr_orders").insert({
    id: submissionId,
    tenant_id: context.tenant_id,
    branch_id: context.branch_id,
    table_id: context.table_id,
    table_session_id: context.table_session_id,
    qr_session_id: context.id,
    order_id: orderRow.id,
    request_id: cleanRequestId,
    event_type: "order",
    item_count: cleanItems.reduce((sum, item) => sum + item.quantity, 0),
    subtotal,
    payload: {
      items: cleanItems,
      note: note?.trim() ? note.trim().slice(0, 500) : null,
      update_type: "replace_order"
    }
  });
  if (eventError) {
    console.warn("[table-qr-ordering] table_qr_orders event insert failed after bill update", {
      tableSessionId: context.table_session_id,
      orderId: orderRow.id,
      message: eventError.message
    });
  }

  invalidatePosBranchRuntimeCaches({ tenantId: context.tenant_id, branchId: context.branch_id });

  return loadOrderTotalsForQrResult({
    context,
    submissionId,
    orderId: orderRow.id,
    duplicateRequest: false,
    supabase
  });
}
export async function submitTableQrServiceRequest(args: {
  context: QrContext;
  requestId: string;
  requestType: TableQrServiceRequestType;
  note?: string | null;
}) {
  const { context, requestId, requestType, note } = args;
  const cleanRequestId = requestId.trim();
  if (!cleanRequestId) throw new Error("REQUEST_ID_REQUIRED");
  ensureTableQrOrderAcceptable(context);

  const supabase = getSupabaseServiceClient();
  if (requestType === "request_checkout") {
    const hasSubmittedFoodOrder = await hasSubmittedFoodOrderForContext(context, supabase);
    if (!hasSubmittedFoodOrder) throw new Error("FOOD_ORDER_REQUIRED_BEFORE_CHECKOUT");
  }

  const { data: existing, error: existingError } = await supabase
    .from("table_qr_orders")
    .select("id,created_at")
    .eq("qr_session_id", context.id)
    .eq("request_id", cleanRequestId)
    .maybeSingle<{ id: string; created_at: string }>();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    return { submission_id: existing.id, duplicate_request: true };
  }

  const { data, error } = await supabase
    .from("table_qr_orders")
    .insert({
      tenant_id: context.tenant_id,
      branch_id: context.branch_id,
      table_id: context.table_id,
      table_session_id: context.table_session_id,
      qr_session_id: context.id,
      order_id: null,
      request_id: cleanRequestId,
      event_type: requestType,
      item_count: 0,
      subtotal: 0,
      payload: {
        type: requestType,
        note: note?.trim() ? note.trim().slice(0, 500) : null,
        table_code: context.table_code
      }
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(error.message);
  invalidatePosBranchRuntimeCaches({ tenantId: context.tenant_id, branchId: context.branch_id });

  return { submission_id: data.id, duplicate_request: false };
}
