import type { BranchRole, CreateManualDeliveryOrderInput, PlatformRole } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type AuditFn = (input: {
  tenantId?: string;
  branchId?: string;
  actorUserId: string;
  actorRole: BranchRole | PlatformRole;
  action: string;
  targetTable: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}) => Promise<unknown>;

type RpcResult<T> = {
  data: T | null;
  error: { message: string } | null;
};

type RpcInvoker = <T>(fn: string, params: Record<string, unknown>) => Promise<RpcResult<T>>;

async function defaultRpcInvoker<T>(fn: string, params: Record<string, unknown>): Promise<RpcResult<T>> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc(fn, params as never);

  return {
    data: (data as T | null) ?? null,
    error: error ? { message: error.message } : null
  };
}

function parseRpcError(message: string) {
  if (message.includes("INSUFFICIENT_STOCK")) {
    return { code: "insufficient_stock", status: 409, message: "Insufficient ingredient stock." };
  }

  if (message.includes("ORDER_ITEMS_REQUIRED")) {
    return { code: "invalid_items", status: 422, message: "Order items are required." };
  }

  if (message.includes("INVALID_ITEM_QTY") || message.includes("INVALID_QUANTITY_DELTA")) {
    return { code: "invalid_quantity", status: 422, message: "Quantity must be greater than zero." };
  }

  if (message.includes("PRODUCT_NOT_FOUND") || message.includes("INVALID_PRODUCT_ID")) {
    return { code: "product_not_found", status: 422, message: "One or more products are invalid." };
  }

  if (message.includes("INGREDIENT_NOT_FOUND")) {
    return { code: "ingredient_not_found", status: 422, message: "Ingredient is invalid for this branch." };
  }

  if (message.includes("NEGATIVE_ORDER_TOTAL")) {
    return { code: "invalid_total", status: 422, message: "Order total cannot be negative." };
  }

  if (message.includes("Manual stock adjustment requires approval") || message.includes("Stock adjustment approval is invalid")) {
    return { code: "approval_invalid", status: 403, message: "Stock adjustment approval is invalid or expired." };
  }

  return { code: "transaction_failed", status: 500, message: "Stock transaction failed." };
}

type OrderTxRow = {
  order_id: string;
  order_status: string;
  created_at: string;
  duplicate_request: boolean;
};

type StockAdjustmentTxRow = {
  movement_id: string;
  movement_status: string;
  created_at: string;
  duplicate_request: boolean;
};

function firstRow<T>(data: T | T[] | null): T | null {
  if (!data) {
    return null;
  }

  if (Array.isArray(data)) {
    return data[0] ?? null;
  }

  return data;
}

export async function executeCreateManualDeliveryOrderTransaction(args: {
  auth: AuthContext;
  input: CreateManualDeliveryOrderInput;
  idempotencyKey?: string;
  appendAuditLog: AuditFn;
  invokeRpc?: RpcInvoker;
}): Promise<
  | {
      ok: true;
      data: {
        id: string;
        status: string;
        created_at: string;
        duplicate_request: boolean;
      };
    }
  | { ok: false; code: string; message: string; status: number }
> {
  const { auth, input, idempotencyKey, appendAuditLog, invokeRpc = defaultRpcInvoker } = args;

  if (!auth.tenantId || !auth.branchId || !auth.branchRole) {
    return { ok: false, code: "missing_scope", message: "Missing tenant/branch scope.", status: 401 };
  }

  if (!input.external_order_code?.trim()) {
    return { ok: false, code: "invalid_external_code", message: "External order code is required.", status: 422 };
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, code: "invalid_items", message: "Order items are required.", status: 422 };
  }

  if (input.items.some((item) => !item.product_id || item.quantity <= 0)) {
    return { ok: false, code: "invalid_items", message: "Each item must have valid product_id and quantity.", status: 422 };
  }

  const { data, error } = await invokeRpc<OrderTxRow[]>("create_manual_delivery_order_tx", {
    p_tenant_id: auth.tenantId,
    p_branch_id: auth.branchId,
    p_shift_id: input.shift_id,
    p_created_by: auth.userId,
    p_channel: input.channel,
    p_external_order_code: input.external_order_code,
    p_customer_name: input.customer_name ?? null,
    p_notes: input.notes ?? null,
    p_app_total_amount: input.app_total_amount,
    p_discount_amount: input.discount_amount ?? 0,
    p_gp_amount: input.gp_amount ?? 0,
    p_items: input.items,
    p_request_id: idempotencyKey ?? null,
    p_order_no: null
  });

  if (error) {
    const parsed = parseRpcError(error.message);

    await appendAuditLog({
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole,
      action: "manual_delivery_order_failed",
      targetTable: "orders",
      metadata: {
        reason: parsed.code,
        detail: error.message,
        idempotency_key: idempotencyKey ?? null
      }
    });

    return { ok: false, ...parsed };
  }

  const row = firstRow(data);

  if (!row) {
    return { ok: false, code: "transaction_failed", message: "Order transaction returned no data.", status: 500 };
  }

  await appendAuditLog({
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole,
    action: row.duplicate_request ? "manual_delivery_order_replayed" : "manual_delivery_order_created",
    targetTable: "orders",
    targetId: row.order_id,
    metadata: {
      channel: input.channel,
      external_order_code: input.external_order_code,
      app_total_amount: input.app_total_amount,
      idempotency_key: idempotencyKey ?? null,
      duplicate_request: row.duplicate_request
    }
  });

  return {
    ok: true,
    data: {
      id: row.order_id,
      status: row.order_status,
      created_at: row.created_at,
      duplicate_request: row.duplicate_request
    }
  };
}

export async function executeStockAdjustmentTransaction(args: {
  auth: AuthContext;
  input: {
    ingredient_id: string;
    quantity_delta: number;
    reason: string;
    approval_id: string;
    request_id?: string;
  };
  appendAuditLog: AuditFn;
  invokeRpc?: RpcInvoker;
}): Promise<
  | {
      ok: true;
      data: {
        id: string;
        status: string;
        created_at: string;
        duplicate_request: boolean;
      };
    }
  | { ok: false; code: string; message: string; status: number }
> {
  const { auth, input, appendAuditLog, invokeRpc = defaultRpcInvoker } = args;

  if (!auth.tenantId || !auth.branchId || !auth.branchRole) {
    return { ok: false, code: "missing_scope", message: "Missing tenant/branch scope.", status: 401 };
  }

  if (!input.approval_id) {
    return {
      ok: false,
      code: "approval_required",
      message: "Stock adjustment requires manager/owner PIN approval.",
      status: 403
    };
  }

  const { data, error } = await invokeRpc<StockAdjustmentTxRow[]>("create_stock_adjustment_tx", {
    p_tenant_id: auth.tenantId,
    p_branch_id: auth.branchId,
    p_ingredient_id: input.ingredient_id,
    p_quantity_delta: input.quantity_delta,
    p_reason: input.reason,
    p_created_by: auth.userId,
    p_approval_id: input.approval_id,
    p_request_id: input.request_id ?? null
  });

  if (error) {
    const parsed = parseRpcError(error.message);

    await appendAuditLog({
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole,
      action: "stock_adjustment_failed",
      targetTable: "stock_movements",
      metadata: {
        ingredient_id: input.ingredient_id,
        quantity_delta: input.quantity_delta,
        reason: input.reason,
        detail: error.message,
        approval_id: input.approval_id,
        request_id: input.request_id ?? null
      }
    });

    return { ok: false, ...parsed };
  }

  const row = firstRow(data);

  if (!row) {
    return { ok: false, code: "transaction_failed", message: "Stock adjustment transaction returned no data.", status: 500 };
  }

  await appendAuditLog({
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole,
    action: row.duplicate_request ? "stock_adjustment_replayed" : "stock_adjustment_created",
    targetTable: "stock_movements",
    targetId: row.movement_id,
    metadata: {
      ingredient_id: input.ingredient_id,
      quantity_delta: input.quantity_delta,
      reason: input.reason,
      approval_id: input.approval_id,
      request_id: input.request_id ?? null,
      duplicate_request: row.duplicate_request
    }
  });

  return {
    ok: true,
    data: {
      id: row.movement_id,
      status: row.movement_status,
      created_at: row.created_at,
      duplicate_request: row.duplicate_request
    }
  };
}
