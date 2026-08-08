import type { OrderType, PaymentMethod } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { calculateRecipeUsage, toIntegerGrams, validateStockBeforeDeduction } from "@/lib/ingredient-stock";
import { appendPosDeadLetter, POS_TIMEOUT_POLICY, PosTimeoutError, withTimeout } from "@/lib/pos-resilience";
import { attachOrderToTableSession } from "@/lib/services/table-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type RpcResult<T> = {
  data: T | null;
  error: { code?: string | null; message: string } | null;
};

type RpcInvoker = <T>(fn: string, params: Record<string, unknown>) => Promise<RpcResult<T>>;

async function defaultRpcInvoker<T>(fn: string, params: Record<string, unknown>): Promise<RpcResult<T>> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc(fn, params as never);
  return {
    data: (data as T | null) ?? null,
    error: error ? { code: error.code, message: error.message } : null
  };
}

function firstRow<T>(data: T | T[] | null): T | null {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

function parseOrderTxError(message: string) {
  if (message.includes("INSUFFICIENT_STOCK")) {
    return { code: "insufficient_stock", status: 409, message: "Insufficient stock for one or more recipe ingredients." };
  }
  if (message.includes("SHIFT_NOT_OPEN")) {
    return { code: "shift_not_open", status: 409, message: "Open shift is required before creating POS sale." };
  }
  if (message.includes("ORDER_ITEMS_REQUIRED")) {
    return { code: "invalid_items", status: 422, message: "Order items are required." };
  }
  if (message.includes("INVALID_ITEM_QTY")) {
    return { code: "invalid_quantity", status: 422, message: "Order item quantity must be greater than zero." };
  }
  if (message.includes("INVALID_ITEM_UNIT_PRICE")) {
    return { code: "invalid_item_unit_price", status: 422, message: "Order item unit_price must be greater than or equal to zero." };
  }
  if (message.includes("PRODUCT_NOT_FOUND")) {
    return { code: "product_not_found", status: 422, message: "One or more products are invalid." };
  }
  if (message.includes("NEGATIVE_ORDER_TOTAL")) {
    return { code: "invalid_total", status: 422, message: "Order total cannot be negative." };
  }
  if (message.includes("PGRST202") || message.includes("Could not find the function")) {
    return { code: "rpc_not_available", status: 500, message: "POS transaction function is unavailable (RPC not exposed)." };
  }
  if (message.includes("column reference \"order_no\" is ambiguous") || message.includes("column reference 'order_no' is ambiguous")) {
    return { code: "rpc_compatibility_error", status: 500, message: "POS transaction function is incompatible with the current order schema." };
  }
  if (message.includes("INVALID_PRODUCT_ID") || message.includes("invalid input syntax for type uuid")) {
    return { code: "invalid_product_id", status: 422, message: "One or more product IDs are invalid." };
  }
  if (message.includes("INGREDIENT_NOT_FOUND")) {
    return { code: "ingredient_not_found", status: 409, message: "Ingredient mapping is missing for one or more recipe items." };
  }
  if (hasMissingOrderDeliverySnapshotColumnError(message)) {
    return { code: "missing_delivery_snapshot_columns", status: 500, message: "Orders table is missing delivery snapshot columns." };
  }
  return { code: "pos_order_tx_failed", status: 500, message: `POS order transaction failed: ${message}` };
}

function parsePaymentTxError(message: string) {
  if (message.includes("PAYMENT_LINES_REQUIRED")) {
    return { code: "payment_lines_required", status: 422, message: "At least one payment line is required." };
  }
  if (message.includes("INVALID_PAYMENT_AMOUNT")) {
    return { code: "invalid_payment_amount", status: 422, message: "Payment amount must be greater than zero." };
  }
  if (message.includes("PAYMENT_TOTAL_MISMATCH")) {
    return { code: "payment_total_mismatch", status: 422, message: "Payment total must match order total." };
  }
  if (message.includes("ORDER_CANCELLED_OR_NOT_FOUND") || message.includes("ORDER_NOT_FOUND")) {
    return { code: "order_not_found", status: 404, message: "Order is not payable in this branch." };
  }
  if (message.includes("PGRST202") || message.includes("Could not find the function")) {
    return { code: "rpc_not_available", status: 500, message: "Payment transaction function is unavailable (RPC not exposed)." };
  }
  return { code: "payment_tx_failed", status: 500, message: `Payment transaction failed: ${message}` };
}

function isMissingColumnError(message: string, table: string, column: string) {
  const normalized = message.toLowerCase();
  return normalized.includes(`column ${table}.${column} does not exist`) || normalized.includes(`column "${column}" does not exist`);
}

const ORDER_DELIVERY_SNAPSHOT_COLUMNS = [
  "delivery_status",
  "delivery_pricing_channel",
  "delivery_app_subtotal",
  "delivery_commission_rate_pct",
  "delivery_commission_amount",
  "delivery_commission_vat_rate_pct",
  "delivery_commission_vat_amount",
  "delivery_platform_fee_amount",
  "delivery_net_payout_amount",
  "delivery_pricing_source_url",
  "delivery_pricing_note"
] as const;

function hasMissingOrderDeliverySnapshotColumnError(message: string): boolean {
  return ORDER_DELIVERY_SNAPSHOT_COLUMNS.some((column) => isMissingColumnError(message, "orders", column));
}

function isUniqueViolationError(error: { code?: string | null; message?: string | null } | null | undefined) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "23505" || message.includes("duplicate key value") || message.includes("unique constraint");
}

function splitModifierNotes(notes: string): string[] {
  return notes
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stripIngredientNoteQuantity(value: string): string {
  return value
    .replace(/\s*(?:x|X|×)\s*\d+$/u, "")
    .replace(/\s*\((?:x|X|×)\s*\d+\)$/u, "")
    .trim();
}

function readSelectedModifierIngredientQuantity(notes: string | null | undefined, ingredientName: string): number {
  const normalizedName = ingredientName.trim().toLowerCase();
  if (!normalizedName) return 0;

  for (const part of splitModifierNotes(String(notes ?? ""))) {
    if (stripIngredientNoteQuantity(part).toLowerCase() !== normalizedName) continue;
    const match = part.match(/(?:x|X|×)\s*(\d+)$/u) ?? part.match(/\((?:x|X|×)\s*(\d+)\)$/u);
    const quantity = Number(match?.[1] ?? 1);
    return Number.isFinite(quantity) && quantity > 0 ? Math.trunc(quantity) : 1;
  }

  return 0;
}

type PosOrderTxRow = {
  order_id: string;
  order_no: string;
  order_status: string;
  created_at: string;
  duplicate_request: boolean;
};

type PosPaymentTxRow = {
  payment_group_id: string;
  total_paid: number;
  order_status: string;
  duplicate_request: boolean;
};

function buildOrderNoPrefix(orderType: OrderType) {
  if (orderType === "dine_in") return "DIN";
  if (orderType === "delivery_manual") return "DLV";
  return "TKO";
}

function buildOrderNo(orderType: OrderType) {
  const datePart = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date()).replace(/\D/g, "");
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `${buildOrderNoPrefix(orderType)}-${datePart}-${suffix}`;
}

async function nextSharedOrderNo(orderType: OrderType, tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("next_pos_order_no", {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
    p_prefix: buildOrderNoPrefix(orderType)
  });
  if (error || typeof data !== "string" || !data.trim()) return buildOrderNo(orderType);
  return data;
}

const POS_ALLOW_NEGATIVE_STOCK_FALLBACK =
  process.env.POS_ALLOW_NEGATIVE_STOCK === "1" || process.env.POS_ALLOW_NEGATIVE_STOCK?.toLowerCase() === "true";

function readExplicitOptInEnvFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true";
}

const POS_SOFT_BYPASS_INSUFFICIENT_STOCK = readExplicitOptInEnvFlag("POS_SOFT_BYPASS_INSUFFICIENT_STOCK");
const POS_FORCE_DIRECT_CREATE_NON_DELIVERY = readExplicitOptInEnvFlag("POS_FORCE_DIRECT_CREATE_NON_DELIVERY");
const POS_FORCE_DIRECT_PAYMENT_COMPLETE = readExplicitOptInEnvFlag("POS_FORCE_DIRECT_PAYMENT_COMPLETE");

function isMissingTableErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("could not find the table") || normalized.includes("branch_inventory_settings");
}

function isMissingStockModeColumnError(message: string) {
  return isMissingColumnError(message, "products", "stock_deduction_mode");
}

function shouldSoftBypassInsufficientStock(orderType: OrderType) {
  return POS_SOFT_BYPASS_INSUFFICIENT_STOCK && orderType !== "delivery_manual";
}

function shouldPreferDirectCreatePath(orderType: OrderType) {
  return POS_FORCE_DIRECT_CREATE_NON_DELIVERY && orderType !== "delivery_manual";
}

async function resolveAllowNegativeStock(auth: AuthContext) {
  if (!auth.tenantId || !auth.branchId) {
    return POS_ALLOW_NEGATIVE_STOCK_FALLBACK;
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("branch_inventory_settings")
    .select("allow_negative_stock")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .maybeSingle<{ allow_negative_stock: boolean }>();

  if (error) {
    if (isMissingTableErrorMessage(error.message)) {
      return POS_ALLOW_NEGATIVE_STOCK_FALLBACK;
    }
    throw new Error(`inventory_settings_query_failed:${error.message}`);
  }

  return Boolean(data?.allow_negative_stock ?? POS_ALLOW_NEGATIVE_STOCK_FALLBACK);
}

async function deductIngredientStockForOrderFallback(args: {
  auth: AuthContext;
  orderId: string;
  orderType: OrderType;
  items: Array<{ product_id: string; quantity: number; notes?: string | null }>;
}) {
  const { auth, orderId, orderType, items } = args;
  if (!auth.tenantId || !auth.branchId) {
    return { ok: false as const, code: "missing_scope", status: 401, message: "Missing tenant/branch scope." };
  }

  const supabase = getSupabaseServiceClient();
  let allowNegativeStock = POS_ALLOW_NEGATIVE_STOCK_FALLBACK;
  try {
    allowNegativeStock = await resolveAllowNegativeStock(auth);
  } catch (error) {
    return {
      ok: false as const,
      code: "inventory_settings_query_failed",
      status: 500,
      message: error instanceof Error ? error.message : "Failed to read inventory settings."
    };
  }
  const productIds = [...new Set(items.map((item) => item.product_id))];
  if (productIds.length === 0) {
    return { ok: true as const };
  }

  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("id,stock_deduction_mode")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .in("id", productIds);
  if (productError) {
    if (!isMissingStockModeColumnError(productError.message)) {
      return { ok: false as const, code: "product_mode_query_failed", status: 500, message: productError.message };
    }
  }

  const knownProductIds = new Set((productRows ?? []).map((row) => String((row as { id: string }).id)));
  const hasStockModeInfo = Boolean(productRows && productRows.length > 0);
  const recipeTargetProductIds = hasStockModeInfo ? productIds.filter((id) => knownProductIds.has(id)) : productIds;
  if (recipeTargetProductIds.length === 0) {
    return { ok: true as const };
  }

  const { data: recipeRows, error: recipeError } = await supabase
    .from("recipes")
    .select("product_id,ingredient_id,quantity_per_item,applies_when_takeaway_only")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .in("product_id", recipeTargetProductIds);

  if (recipeError) {
    return { ok: false as const, code: "recipe_query_failed", status: 500, message: recipeError.message };
  }

  const recipeByProduct = new Map<string, Array<{ ingredientId: string; usageInGrams: number }>>();
  for (const row of recipeRows ?? []) {
    const appliesWhenTakeawayOnly = Boolean(row.applies_when_takeaway_only);
    if (appliesWhenTakeawayOnly && !["takeaway", "delivery_manual"].includes(orderType)) continue;
    const productId = String(row.product_id);
    if (!recipeByProduct.has(productId)) {
      recipeByProduct.set(productId, []);
    }
    recipeByProduct.get(productId)?.push({
      ingredientId: String(row.ingredient_id),
      usageInGrams: toIntegerGrams(Number(row.quantity_per_item ?? 0))
    });
  }

  const requiredByIngredient = new Map<string, number>();
  for (const item of items) {
    const recipeLines = recipeByProduct.get(item.product_id) ?? [];
    if (recipeLines.length === 0) continue;
    const usage = calculateRecipeUsage(
      recipeLines.map((line) => ({
        productId: item.product_id,
        ingredientId: line.ingredientId,
        usageInGrams: line.usageInGrams
      })),
      Number(item.quantity)
    );
    for (const entry of usage) {
      requiredByIngredient.set(entry.ingredientId, (requiredByIngredient.get(entry.ingredientId) ?? 0) + entry.requiredGrams);
    }
  }

  if (requiredByIngredient.size === 0) {
    return { ok: true as const };
  }

  const ingredientIds = Array.from(requiredByIngredient.keys());
  const { data: ingredientRows, error: ingredientError } = await supabase
    .from("ingredients")
    .select("id,name,quantity_on_hand")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .in("id", ingredientIds);

  if (ingredientError) {
    return { ok: false as const, code: "ingredient_query_failed", status: 500, message: ingredientError.message };
  }

  const ingredientMap = new Map(
    (ingredientRows ?? []).map((row) => [
      String(row.id),
      {
        id: String(row.id),
        name: String(row.name ?? ""),
        stockInGrams: toIntegerGrams(Number(row.quantity_on_hand ?? 0))
      }
    ])
  );

  for (const item of items) {
    const recipeLines = recipeByProduct.get(item.product_id) ?? [];
    if (recipeLines.length === 0 || !String(item.notes ?? "").trim()) continue;
    const itemQuantity = Number(item.quantity);
    if (!Number.isFinite(itemQuantity) || itemQuantity <= 0) continue;

    for (const line of recipeLines) {
      const ingredient = ingredientMap.get(line.ingredientId);
      if (!ingredient || line.usageInGrams <= 0) continue;
      const selectedQuantity = readSelectedModifierIngredientQuantity(item.notes, ingredient.name);
      if (selectedQuantity <= 0) continue;
      const extraRequiredGrams = toIntegerGrams(line.usageInGrams * itemQuantity * selectedQuantity);
      if (extraRequiredGrams <= 0) continue;
      requiredByIngredient.set(line.ingredientId, (requiredByIngredient.get(line.ingredientId) ?? 0) + extraRequiredGrams);
    }
  }

  for (const ingredientId of ingredientIds) {
    const ingredient = ingredientMap.get(ingredientId);
    if (!ingredient) {
      return { ok: false as const, code: "ingredient_not_found", status: 409, message: `INGREDIENT_NOT_FOUND:${ingredientId}` };
    }
    const requiredGrams = requiredByIngredient.get(ingredientId) ?? 0;
    const check = validateStockBeforeDeduction(ingredient, requiredGrams, { allowNegativeStock });
    if (!check.ok) {
      return { ok: false as const, code: "insufficient_stock", status: 409, message: `INSUFFICIENT_STOCK:${ingredientId}` };
    }
  }

  for (const ingredientId of ingredientIds) {
    const requiredGrams = requiredByIngredient.get(ingredientId) ?? 0;
    if (requiredGrams <= 0) continue;

    const ingredient = ingredientMap.get(ingredientId);
    if (!ingredient) continue;

    const updateQuery = supabase
      .from("ingredients")
      .update({
        quantity_on_hand: toIntegerGrams(ingredient.stockInGrams - requiredGrams)
      })
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("id", ingredientId);

    const { error: updateError } = allowNegativeStock
      ? await updateQuery
      : await updateQuery.gte("quantity_on_hand", requiredGrams);

    if (updateError) {
      return { ok: false as const, code: "stock_deduction_failed", status: 500, message: updateError.message };
    }

    const { error: movementError } = await supabase.from("stock_movements").insert({
      tenant_id: auth.tenantId,
      branch_id: auth.branchId,
      ingredient_id: ingredientId,
      movement_type: "sale_deduction",
      quantity_delta: -requiredGrams,
      reason: "Auto deduction from POS sale (fallback)",
      ref_table: "orders",
      ref_id: orderId,
      created_by: auth.userId
    });
    if (movementError) {
      return { ok: false as const, code: "stock_movement_insert_failed", status: 500, message: movementError.message };
    }
  }

  return { ok: true as const };
}

export async function deductIngredientStockForPaidOrderFallback(args: {
  auth: AuthContext;
  orderId: string;
}) {
  const { auth, orderId } = args;
  if (!auth.tenantId || !auth.branchId) {
    return { ok: false as const, code: "missing_scope", status: 401, message: "Missing tenant/branch scope." };
  }

  const supabase = getSupabaseServiceClient();
  const { count: existingMovementCount, error: movementCountError } = await supabase
    .from("stock_movements")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("movement_type", "sale_deduction")
    .eq("ref_table", "orders")
    .eq("ref_id", orderId);
  if (movementCountError) {
    return { ok: false as const, code: "stock_movement_query_failed", status: 500, message: movementCountError.message };
  }
  if ((existingMovementCount ?? 0) > 0) {
    return { ok: true as const };
  }

  const [{ data: orderRow, error: orderError }, { data: itemRows, error: itemError }] = await Promise.all([
    supabase
      .from("orders")
      .select("id,order_type")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("id", orderId)
      .maybeSingle<{ id: string; order_type: OrderType }>(),
    supabase
      .from("order_items")
      .select("product_id,quantity,notes")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("order_id", orderId)
  ]);
  if (orderError) {
    return { ok: false as const, code: "order_query_failed", status: 500, message: orderError.message };
  }
  if (!orderRow) {
    return { ok: false as const, code: "order_not_found", status: 404, message: "Order is not payable in this branch." };
  }
  if (itemError) {
    return { ok: false as const, code: "order_items_query_failed", status: 500, message: itemError.message };
  }

  return deductIngredientStockForOrderFallback({
    auth,
    orderId,
    orderType: orderRow.order_type,
    items: (itemRows ?? []).map((item) => ({
      product_id: String(item.product_id),
      quantity: Number(item.quantity),
      notes: typeof item.notes === "string" ? item.notes : null
    }))
  });
}

async function executeCreatePosOrderDirectFallback(args: {
  auth: AuthContext;
  input: {
    shift_id: string;
    order_type: OrderType;
    channel: string;
    table_id?: string | null;
    external_order_code?: string | null;
    customer_name?: string | null;
    member_name?: string | null;
    member_phone?: string | null;
    member_code?: string | null;
    member_points?: number | null;
    member_stamps?: number | null;
    notes?: string | null;
    app_total_amount: number;
    discount_amount?: number;
    gp_amount?: number;
    tax_total?: number;
    grand_total?: number;
    tax_lines?: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>;
    delivery_pricing_channel?: string | null;
    delivery_app_subtotal?: number | null;
    delivery_commission_rate_pct?: number | null;
    delivery_commission_amount?: number | null;
    delivery_commission_vat_rate_pct?: number | null;
    delivery_commission_vat_amount?: number | null;
    delivery_platform_fee_amount?: number | null;
    delivery_net_payout_amount?: number | null;
    delivery_pricing_source_url?: string | null;
    delivery_pricing_note?: string | null;
    items: Array<{
      product_id: string;
      quantity: number;
      unit_price?: number | null;
      notes?: string | null;
    }>;
  };
  idempotencyKey?: string;
  orderNo?: string;
  softBypassInsufficientStock?: boolean;
}) {
  const { auth, input, idempotencyKey, orderNo: providedOrderNo } = args;
  if (!auth.tenantId || !auth.branchId) {
    return { ok: false as const, code: "missing_scope", status: 401, message: "Missing tenant/branch scope." };
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false as const, code: "invalid_items", status: 422, message: "Order items are required." };
  }

  const supabase = getSupabaseServiceClient();
  let supportsRequestId = true;

  if (idempotencyKey) {
    const { data: existingOrder, error: existingOrderError } = await supabase
      .from("orders")
      .select("id,order_no,status,created_at,table_id")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("request_id", idempotencyKey)
      .maybeSingle<{ id: string; order_no: string; status: string; created_at: string; table_id: string | null }>();

    if (existingOrderError) {
      if (isMissingColumnError(existingOrderError.message, "orders", "request_id")) {
        supportsRequestId = false;
      } else {
        return { ok: false as const, code: "order_query_failed", status: 500, message: existingOrderError.message };
      }
    }
    if (existingOrder) {
      return {
        ok: true as const,
        data: {
          id: existingOrder.id,
          order_no: existingOrder.order_no,
          status: existingOrder.status,
          order_type: input.order_type,
          channel: input.channel,
          external_order_code: input.external_order_code ?? null,
          total_amount: Number(
            (input.grand_total ?? (Number(input.app_total_amount ?? 0) - Number(input.discount_amount ?? 0) - Number(input.gp_amount ?? 0))).toFixed(2)
          ),
          table_id: existingOrder.table_id ?? input.table_id ?? null,
          created_at: existingOrder.created_at,
          duplicate_request: true
        }
      };
    }
  }

  const { data: shiftRow, error: shiftError } = await supabase
    .from("shifts")
    .select("id,status")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", input.shift_id)
    .eq("status", "open")
    .maybeSingle<{ id: string; status: string }>();

  if (shiftError) {
    return { ok: false as const, code: "shift_query_failed", status: 500, message: shiftError.message };
  }
  if (!shiftRow) {
    return { ok: false as const, code: "shift_not_open", status: 409, message: "Open shift is required before creating POS sale." };
  }

  const normalizedItems = input.items.map((item) => ({
    product_id: item.product_id,
    quantity: Number(item.quantity),
    unit_price: item.unit_price,
    notes: item.notes ?? null
  }));

  if (normalizedItems.some((item) => !item.product_id || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
    return { ok: false as const, code: "invalid_quantity", status: 422, message: "Order item quantity must be greater than zero." };
  }

  const productIds = [...new Set(normalizedItems.map((item) => item.product_id))];
  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("id,price,is_active")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .in("id", productIds);

  if (productError) {
    return { ok: false as const, code: "product_query_failed", status: 500, message: productError.message };
  }

  const productMap = new Map<string, { price: number; is_active: boolean }>();
  for (const row of productRows ?? []) {
    productMap.set(String(row.id), { price: Number(row.price), is_active: Boolean(row.is_active) });
  }

  for (const productId of productIds) {
    const product = productMap.get(productId);
    if (!product || !product.is_active) {
      return { ok: false as const, code: "product_not_found", status: 422, message: "One or more products are invalid." };
    }
  }

  const normalizedItemsWithPrice = normalizedItems.map((item) => {
    const productPrice = productMap.get(item.product_id)?.price ?? 0;
    const rawUnitPrice = item.unit_price;
    const unitPrice = Number.isFinite(rawUnitPrice) && Number(rawUnitPrice) >= 0 ? Number(rawUnitPrice) : productPrice;
    return {
      ...item,
      unit_price: Number(unitPrice.toFixed(2))
    };
  });

  const computedSubtotal = Number(
    normalizedItemsWithPrice
      .reduce((sum, item) => {
        return sum + item.unit_price * item.quantity;
      }, 0)
      .toFixed(2)
  );
  const discountAmount = Number(Math.max(0, input.discount_amount ?? 0).toFixed(2));
  const gpAmount = Number(Math.max(0, input.gp_amount ?? 0).toFixed(2));
  const baseTotalAmount = Number((computedSubtotal - discountAmount - gpAmount).toFixed(2));
  const taxTotal = Number((input.tax_total ?? 0).toFixed(2));
  const totalAmount = Number((input.grand_total ?? baseTotalAmount + taxTotal).toFixed(2));

  if (totalAmount < 0) {
    return { ok: false as const, code: "invalid_total", status: 422, message: "Order total cannot be negative." };
  }

  const orderId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const buildBaseOrderInsertPayload = (orderNo: string) => ({
    id: orderId,
    tenant_id: auth.tenantId,
    branch_id: auth.branchId,
    shift_id: input.shift_id,
    order_no: orderNo,
    order_type: input.order_type,
    channel: input.channel,
    delivery_status: input.order_type === "delivery_manual" ? "pending" : null,
    table_id: input.table_id ?? null,
    external_order_code: input.external_order_code ?? null,
    customer_name: input.customer_name ?? null,
    notes: input.notes ?? null,
    subtotal: computedSubtotal,
    discount_amount: discountAmount,
    gp_amount: gpAmount,
    delivery_pricing_channel: input.delivery_pricing_channel ?? null,
    delivery_app_subtotal: input.delivery_app_subtotal ?? null,
    delivery_commission_rate_pct: input.delivery_commission_rate_pct ?? null,
    delivery_commission_amount: input.delivery_commission_amount ?? null,
    delivery_commission_vat_rate_pct: input.delivery_commission_vat_rate_pct ?? null,
    delivery_commission_vat_amount: input.delivery_commission_vat_amount ?? null,
    delivery_platform_fee_amount: input.delivery_platform_fee_amount ?? null,
    delivery_net_payout_amount: input.delivery_net_payout_amount ?? null,
    delivery_pricing_source_url: input.delivery_pricing_source_url ?? null,
    delivery_pricing_note: input.delivery_pricing_note ?? null,
    total_amount: totalAmount,
    tax_total: taxTotal,
    grand_total: totalAmount,
    metadata: {
      tax_lines: input.tax_lines ?? [],
      member_name: input.member_name ?? null,
      member_phone: input.member_phone ?? null,
      member_code: input.member_code ?? null,
      member_points: input.member_points ?? null,
      member_stamps: input.member_stamps ?? null
    },
    status: "queued",
    created_by: auth.userId
  });
  const buildBaseOrderInsertPayloadLegacy = (orderNo: string) => ({
    id: orderId,
    tenant_id: auth.tenantId,
    branch_id: auth.branchId,
    shift_id: input.shift_id,
    order_no: orderNo,
    order_type: input.order_type,
    channel: input.channel,
    table_id: input.table_id ?? null,
    external_order_code: input.external_order_code ?? null,
    customer_name: input.customer_name ?? null,
    notes: input.notes ?? null,
    subtotal: computedSubtotal,
    discount_amount: discountAmount,
    gp_amount: gpAmount,
    total_amount: totalAmount,
    tax_total: taxTotal,
    grand_total: totalAmount,
    metadata: {
      tax_lines: input.tax_lines ?? [],
      member_name: input.member_name ?? null,
      member_phone: input.member_phone ?? null,
      member_code: input.member_code ?? null,
      member_points: input.member_points ?? null,
      member_stamps: input.member_stamps ?? null
    },
    status: "queued",
    created_by: auth.userId
  });

  let orderNo = providedOrderNo ?? await nextSharedOrderNo(input.order_type, auth.tenantId, auth.branchId);
  let orderInsertError: { code?: string | null; message: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      orderNo = await nextSharedOrderNo(input.order_type, auth.tenantId, auth.branchId);
    }

    const baseOrderInsertPayload = buildBaseOrderInsertPayload(orderNo);
    const baseOrderInsertPayloadLegacy = buildBaseOrderInsertPayloadLegacy(orderNo);
    const orderInsertPayload =
      supportsRequestId && idempotencyKey
        ? {
            ...baseOrderInsertPayload,
            request_id: idempotencyKey
          }
        : baseOrderInsertPayload;
    ({ error: orderInsertError } = await supabase.from("orders").insert(orderInsertPayload));

    if (orderInsertError && supportsRequestId && isMissingColumnError(orderInsertError.message, "orders", "request_id")) {
      supportsRequestId = false;
      ({ error: orderInsertError } = await supabase.from("orders").insert(baseOrderInsertPayload));
    }
    if (orderInsertError && hasMissingOrderDeliverySnapshotColumnError(orderInsertError.message)) {
      const legacyOrderInsertPayload =
        supportsRequestId && idempotencyKey
          ? {
              ...baseOrderInsertPayloadLegacy,
              request_id: idempotencyKey
            }
          : baseOrderInsertPayloadLegacy;
      ({ error: orderInsertError } = await supabase.from("orders").insert(legacyOrderInsertPayload));

      if (orderInsertError && supportsRequestId && isMissingColumnError(orderInsertError.message, "orders", "request_id")) {
        supportsRequestId = false;
        ({ error: orderInsertError } = await supabase.from("orders").insert(baseOrderInsertPayloadLegacy));
      }
    }

    if (!orderInsertError || providedOrderNo || !isUniqueViolationError(orderInsertError)) break;
  }

  if (orderInsertError) {
    return { ok: false as const, code: "order_insert_failed", status: 500, message: orderInsertError.message };
  }

  const orderItemsPayload = normalizedItemsWithPrice.map((item) => {
    const unitPrice = item.unit_price;
    return {
      tenant_id: auth.tenantId,
      branch_id: auth.branchId,
      order_id: orderId,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: unitPrice,
      line_total: Number((unitPrice * item.quantity).toFixed(2)),
      notes: item.notes
    };
  });

  const { error: orderItemsInsertError } = await supabase.from("order_items").insert(orderItemsPayload);
  if (orderItemsInsertError) {
    await supabase.from("orders").delete().eq("tenant_id", auth.tenantId).eq("branch_id", auth.branchId).eq("id", orderId);
    return { ok: false as const, code: "order_items_insert_failed", status: 500, message: orderItemsInsertError.message };
  }

  const stockBypassed = false;

  if (input.order_type === "dine_in" && input.table_id) {
    await attachOrderToTableSession({
      auth,
      tableId: input.table_id,
      orderId,
      orderNo
    });
  }

  void appendAuditLog({
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole,
    action: "pos_order_created_fallback",
    targetTable: "orders",
    targetId: orderId,
    metadata: {
      order_type: input.order_type,
      channel: input.channel,
      request_id: idempotencyKey ?? null
    }
  });

  return {
    ok: true as const,
    data: {
      id: orderId,
      order_no: orderNo,
      status: "queued",
      order_type: input.order_type,
      channel: input.channel,
      external_order_code: input.external_order_code ?? null,
      member_name: input.member_name ?? null,
      member_phone: input.member_phone ?? null,
      member_code: input.member_code ?? null,
      member_points: input.member_points ?? null,
      member_stamps: input.member_stamps ?? null,
      total_amount: totalAmount,
      tax_total: taxTotal,
      tax_lines: input.tax_lines ?? [],
      table_id: input.table_id ?? null,
      created_at: nowIso,
      duplicate_request: false,
      stock_bypassed: stockBypassed
    }
  };
}

async function executeCompletePosPaymentDirectFallback(args: {
  auth: AuthContext;
  input: {
    order_id: string;
    payment_lines: Array<{ method: PaymentMethod; amount: number; reference_no?: string | null }>;
  };
  requestGroupId?: string;
}) {
  const { auth, input, requestGroupId } = args;
  if (!auth.tenantId || !auth.branchId) {
    return { ok: false as const, code: "missing_scope", status: 401, message: "Missing tenant/branch scope." };
  }
  if (!Array.isArray(input.payment_lines) || input.payment_lines.length === 0) {
    return { ok: false as const, code: "payment_lines_required", status: 422, message: "At least one payment line is required." };
  }

  const supabase = getSupabaseServiceClient();
  let supportsRequestGroupId = true;

  if (requestGroupId) {
    const { data: existingPayments, error: existingPaymentsError } = await supabase
      .from("payments")
      .select("amount")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("order_id", input.order_id)
      .eq("request_group_id", requestGroupId);

    if (existingPaymentsError) {
      if (isMissingColumnError(existingPaymentsError.message, "payments", "request_group_id")) {
        supportsRequestGroupId = false;
      } else {
        return { ok: false as const, code: "payment_query_failed", status: 500, message: existingPaymentsError.message };
      }
    }

    if (supportsRequestGroupId && (existingPayments ?? []).length > 0) {
      const totalPaid = Number((existingPayments ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0).toFixed(2));
      return {
        ok: true as const,
        data: {
          payment_group_id: requestGroupId,
          total_paid: totalPaid,
          status: "completed",
          duplicate_request: true
        }
      };
    }
  }

  const { data: orderRow, error: orderError } = await supabase
    .from("orders")
    .select("id,total_amount,status")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", input.order_id)
    .maybeSingle<{ id: string; total_amount: number; status: string }>();

  if (orderError) {
    return { ok: false as const, code: "order_query_failed", status: 500, message: orderError.message };
  }
  if (!orderRow || orderRow.status === "cancelled") {
    return { ok: false as const, code: "order_not_found", status: 404, message: "Order is not payable in this branch." };
  }

  const normalizedLines = input.payment_lines.map((line) => ({
    method: line.method,
    amount: Number(line.amount),
    reference_no: line.reference_no ?? null
  }));
  if (normalizedLines.some((line) => !Number.isFinite(line.amount) || line.amount <= 0)) {
    return { ok: false as const, code: "invalid_payment_amount", status: 422, message: "Payment amount must be greater than zero." };
  }

  const totalPaid = Number(normalizedLines.reduce((sum, line) => sum + line.amount, 0).toFixed(2));
  const totalDue = Number(Number(orderRow.total_amount ?? 0).toFixed(2));
  if (Math.abs(totalPaid - totalDue) > 0.01) {
    return { ok: false as const, code: "payment_total_mismatch", status: 422, message: "Payment total must match order total." };
  }

  const paymentsPayload = normalizedLines.map((line) => ({
    tenant_id: auth.tenantId,
    branch_id: auth.branchId,
    order_id: input.order_id,
    method: line.method,
    amount: line.amount,
    reference_no: line.reference_no,
    received_by: auth.userId
  }));
  const paymentsPayloadWithRequestGroupId =
    supportsRequestGroupId && requestGroupId
      ? paymentsPayload.map((line) => ({
          ...line,
          request_group_id: requestGroupId
        }))
      : paymentsPayload;

  let { error: paymentsInsertError } = await supabase.from("payments").insert(paymentsPayloadWithRequestGroupId);
  if (paymentsInsertError && supportsRequestGroupId && isMissingColumnError(paymentsInsertError.message, "payments", "request_group_id")) {
    supportsRequestGroupId = false;
    ({ error: paymentsInsertError } = await supabase.from("payments").insert(paymentsPayload));
  }

  if (paymentsInsertError) {
    return { ok: false as const, code: "payment_insert_failed", status: 500, message: paymentsInsertError.message };
  }

  const stockDeductionResult = await deductIngredientStockForPaidOrderFallback({ auth, orderId: input.order_id });
  if (!stockDeductionResult.ok) {
    await supabase.from("payments").delete().eq("tenant_id", auth.tenantId).eq("branch_id", auth.branchId).eq("order_id", input.order_id);
    return {
      ok: false as const,
      code: stockDeductionResult.code,
      status: stockDeductionResult.status,
      message: stockDeductionResult.message
    };
  }

  const { error: orderUpdateError } = await supabase
    .from("orders")
    .update({ status: "completed" })
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("id", input.order_id)
    .neq("status", "cancelled");

  if (orderUpdateError) {
    return { ok: false as const, code: "order_update_failed", status: 500, message: orderUpdateError.message };
  }

  void appendAuditLog({
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole,
    action: "pos_payment_completed_fallback",
    targetTable: "payments",
    targetId: input.order_id,
    metadata: {
      request_group_id: requestGroupId ?? null,
      total_paid: totalPaid
    }
  });

  return {
    ok: true as const,
    data: {
      payment_group_id: requestGroupId ?? "",
      total_paid: totalPaid,
      status: "completed",
      duplicate_request: false
    }
  };
}

export async function executeCreatePosOrderTransaction(args: {
  auth: AuthContext;
  input: {
    shift_id: string;
    order_type: OrderType;
    channel: string;
    table_id?: string | null;
    external_order_code?: string | null;
    customer_name?: string | null;
    member_name?: string | null;
    member_phone?: string | null;
    member_code?: string | null;
    member_points?: number | null;
    member_stamps?: number | null;
    notes?: string | null;
    app_total_amount: number;
    discount_amount?: number;
    gp_amount?: number;
    tax_total?: number;
    grand_total?: number;
    tax_lines?: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>;
    delivery_pricing_channel?: string | null;
    delivery_app_subtotal?: number | null;
    delivery_commission_rate_pct?: number | null;
    delivery_commission_amount?: number | null;
    delivery_commission_vat_rate_pct?: number | null;
    delivery_commission_vat_amount?: number | null;
    delivery_platform_fee_amount?: number | null;
    delivery_net_payout_amount?: number | null;
    delivery_pricing_source_url?: string | null;
    delivery_pricing_note?: string | null;
    items: Array<{
      product_id: string;
      quantity: number;
      unit_price?: number | null;
      notes?: string | null;
    }>;
  };
  idempotencyKey?: string;
  invokeRpc?: RpcInvoker;
}) {
  const { auth, input, idempotencyKey, invokeRpc = defaultRpcInvoker } = args;
  if (!auth.tenantId || !auth.branchId) {
    return { ok: false as const, code: "missing_scope", status: 401, message: "Missing tenant/branch scope." };
  }
  if (shouldPreferDirectCreatePath(input.order_type)) {
    return executeCreatePosOrderDirectFallback({
      auth,
      input,
      idempotencyKey,
      softBypassInsufficientStock: shouldSoftBypassInsufficientStock(input.order_type)
    });
  }
  let sharedOrderNo = await nextSharedOrderNo(input.order_type, auth.tenantId, auth.branchId);
  let data: PosOrderTxRow[] | null = null;
  let error: { code?: string | null; message: string } | null = null;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        sharedOrderNo = await nextSharedOrderNo(input.order_type, auth.tenantId, auth.branchId);
      }
      const rpcResult = await withTimeout(
        invokeRpc<PosOrderTxRow[]>("create_pos_order_tx", {
          p_tenant_id: auth.tenantId,
          p_branch_id: auth.branchId,
          p_shift_id: input.shift_id,
          p_created_by: auth.userId,
          p_order_type: input.order_type,
          p_channel: input.channel,
          p_table_id: input.table_id ?? null,
          p_external_order_code: input.external_order_code ?? null,
          p_customer_name: input.customer_name ?? null,
          p_notes: input.notes ?? null,
          p_app_total_amount: input.app_total_amount,
          p_discount_amount: input.discount_amount ?? 0,
          p_gp_amount: input.gp_amount ?? 0,
          p_delivery_pricing_channel: input.delivery_pricing_channel ?? null,
          p_delivery_app_subtotal: input.delivery_app_subtotal ?? null,
          p_delivery_commission_rate_pct: input.delivery_commission_rate_pct ?? null,
          p_delivery_commission_amount: input.delivery_commission_amount ?? null,
          p_delivery_commission_vat_rate_pct: input.delivery_commission_vat_rate_pct ?? null,
          p_delivery_commission_vat_amount: input.delivery_commission_vat_amount ?? null,
          p_delivery_platform_fee_amount: input.delivery_platform_fee_amount ?? null,
          p_delivery_net_payout_amount: input.delivery_net_payout_amount ?? null,
          p_delivery_pricing_source_url: input.delivery_pricing_source_url ?? null,
          p_delivery_pricing_note: input.delivery_pricing_note ?? null,
          p_items: input.items,
          p_request_id: idempotencyKey ?? null,
          p_order_no: sharedOrderNo
        }),
        POS_TIMEOUT_POLICY.orderCreateMs,
        "pos_order_tx"
      );
      data = rpcResult.data;
      error = rpcResult.error;
      if (!error || !isUniqueViolationError(error)) break;
    }
  } catch (rpcTimeoutError) {
    if (rpcTimeoutError instanceof PosTimeoutError) {
      appendPosDeadLetter({
        auth,
        channel: "order",
        targetTable: "orders",
        reason: rpcTimeoutError.code,
        metadata: {
          timeout_ms: rpcTimeoutError.timeoutMs,
          request_id: idempotencyKey ?? null,
          order_type: input.order_type
        }
      });
      return {
        ok: false as const,
        code: "order_tx_timeout",
        status: 504,
        message: "Order transaction timed out. Please retry safely with the same request."
      };
    }
    throw rpcTimeoutError;
  }

  if (error) {
    void appendAuditLog({
      tenantId: auth.tenantId ?? undefined,
      branchId: auth.branchId ?? undefined,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "pos_order_create_failed",
      targetTable: "orders",
      metadata: {
        detail: error.message,
        request_id: idempotencyKey ?? null,
        order_type: input.order_type
      }
    });
    const parsed = parseOrderTxError(error.message);
    appendPosDeadLetter({
      auth,
      channel: "order",
      targetTable: "orders",
      reason: parsed.code,
      metadata: {
        detail: error.message,
        request_id: idempotencyKey ?? null
      }
    });
    if (parsed.code === "rpc_not_available" || parsed.code === "rpc_compatibility_error" || parsed.code === "missing_delivery_snapshot_columns") {
      return executeCreatePosOrderDirectFallback({ auth, input, idempotencyKey });
    }
    if (parsed.code === "insufficient_stock" && shouldSoftBypassInsufficientStock(input.order_type)) {
      return executeCreatePosOrderDirectFallback({ auth, input, idempotencyKey, softBypassInsufficientStock: true });
    }
    return { ok: false as const, ...parsed };
  }

  const row = firstRow(data);
  if (!row) {
    return { ok: false as const, code: "pos_order_tx_failed", status: 500, message: "Order transaction returned no data." };
  }

  const taxTotal = Number((input.tax_total ?? 0).toFixed(2));
  const resolvedTotalAmount = Number(
    (input.grand_total ?? (Number(input.app_total_amount ?? 0) - Number(input.discount_amount ?? 0) - Number(input.gp_amount ?? 0) + taxTotal)).toFixed(2)
  );
  if (taxTotal !== 0 || input.tax_lines?.length || input.member_name || input.member_phone || input.member_code) {
    void getSupabaseServiceClient()
      .from("orders")
      .update({
        tax_total: taxTotal,
        grand_total: resolvedTotalAmount,
        total_amount: resolvedTotalAmount,
        metadata: {
          tax_lines: input.tax_lines ?? [],
          member_name: input.member_name ?? null,
          member_phone: input.member_phone ?? null,
          member_code: input.member_code ?? null,
          member_points: input.member_points ?? null,
          member_stamps: input.member_stamps ?? null
        }
      })
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("id", row.order_id);
  }

  void appendAuditLog({
    tenantId: auth.tenantId ?? undefined,
    branchId: auth.branchId ?? undefined,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole,
    action: row.duplicate_request ? "pos_order_replayed" : "pos_order_created",
    targetTable: "orders",
    targetId: row.order_id,
    metadata: {
      order_type: input.order_type,
      channel: input.channel,
      request_id: idempotencyKey ?? null,
      duplicate_request: row.duplicate_request
    }
  });

  if (input.order_type === "dine_in" && input.table_id) {
    await attachOrderToTableSession({
      auth,
      tableId: input.table_id,
      orderId: row.order_id,
      orderNo: row.order_no
    });
  }

  return {
    ok: true as const,
    data: {
      id: row.order_id,
      order_no: row.order_no,
      status: row.order_status,
      order_type: input.order_type,
      channel: input.channel,
      external_order_code: input.external_order_code ?? null,
      member_name: input.member_name ?? null,
      member_phone: input.member_phone ?? null,
      member_code: input.member_code ?? null,
      member_points: input.member_points ?? null,
      member_stamps: input.member_stamps ?? null,
      total_amount: resolvedTotalAmount,
      tax_total: taxTotal,
      tax_lines: input.tax_lines ?? [],
      table_id: input.table_id ?? null,
      created_at: row.created_at,
      duplicate_request: row.duplicate_request
    }
  };
}

export async function executeCompletePosPaymentTransaction(args: {
  auth: AuthContext;
  input: {
    order_id: string;
    payment_lines: Array<{ method: PaymentMethod; amount: number; reference_no?: string | null }>;
  };
  requestGroupId?: string;
  invokeRpc?: RpcInvoker;
}) {
  const { auth, input, requestGroupId, invokeRpc = defaultRpcInvoker } = args;
  if (POS_FORCE_DIRECT_PAYMENT_COMPLETE) {
    return executeCompletePosPaymentDirectFallback({ auth, input, requestGroupId });
  }
  let data: PosPaymentTxRow[] | null = null;
  let error: { message: string } | null = null;
  try {
    const rpcResult = await withTimeout(
      invokeRpc<PosPaymentTxRow[]>("complete_pos_payment_tx", {
        p_tenant_id: auth.tenantId,
        p_branch_id: auth.branchId,
        p_order_id: input.order_id,
        p_received_by: auth.userId,
        p_payment_lines: input.payment_lines,
        p_request_group_id: requestGroupId ?? null
      }),
      POS_TIMEOUT_POLICY.paymentCompleteMs,
      "pos_payment_tx"
    );
    data = rpcResult.data;
    error = rpcResult.error;
  } catch (rpcTimeoutError) {
    if (rpcTimeoutError instanceof PosTimeoutError) {
      appendPosDeadLetter({
        auth,
        channel: "payment",
        targetTable: "payments",
        targetId: input.order_id,
        reason: rpcTimeoutError.code,
        metadata: {
          timeout_ms: rpcTimeoutError.timeoutMs,
          request_group_id: requestGroupId ?? null
        }
      });
      return {
        ok: false as const,
        code: "payment_tx_timeout",
        status: 504,
        message: "Payment transaction timed out. Please retry safely with the same request."
      };
    }
    throw rpcTimeoutError;
  }

  if (error) {
    void appendAuditLog({
      tenantId: auth.tenantId ?? undefined,
      branchId: auth.branchId ?? undefined,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "pos_payment_failed",
      targetTable: "payments",
      targetId: input.order_id,
      metadata: {
        detail: error.message,
        request_group_id: requestGroupId ?? null
      }
    });
    const parsed = parsePaymentTxError(error.message);
    appendPosDeadLetter({
      auth,
      channel: "payment",
      targetTable: "payments",
      targetId: input.order_id,
      reason: parsed.code,
      metadata: {
        detail: error.message,
        request_group_id: requestGroupId ?? null
      }
    });
    if (parsed.code === "rpc_not_available") {
      return executeCompletePosPaymentDirectFallback({ auth, input, requestGroupId });
    }
    return { ok: false as const, ...parsed };
  }

  const row = firstRow(data);
  if (!row) {
    return { ok: false as const, code: "payment_tx_failed", status: 500, message: "Payment transaction returned no data." };
  }

  void appendAuditLog({
    tenantId: auth.tenantId ?? undefined,
    branchId: auth.branchId ?? undefined,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? auth.platformRole,
    action: row.duplicate_request ? "pos_payment_replayed" : "pos_payment_completed",
    targetTable: "payments",
    targetId: input.order_id,
    metadata: {
      request_group_id: requestGroupId ?? null,
      total_paid: row.total_paid,
      duplicate_request: row.duplicate_request
    }
  });

  return {
    ok: true as const,
    data: {
      payment_group_id: row.payment_group_id,
      total_paid: row.total_paid,
      status: row.order_status,
      duplicate_request: row.duplicate_request
    }
  };
}
