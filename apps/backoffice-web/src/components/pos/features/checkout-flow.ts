import type { OrderType } from "@pos/shared-types";

export type CheckoutCartItem = {
  cart_line_id?: string;
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

export type CheckoutActiveOrder = {
  id: string;
  order_no: string;
  status: string;
  order_type?: OrderType;
  channel?: string | null;
  external_order_code?: string | null;
  member_name?: string | null;
  member_phone?: string | null;
  member_code?: string | null;
  member_points?: number | null;
  member_stamps?: number | null;
  total_amount?: number;
  table_id?: string | null;
  created_at?: string;
};

export type CheckoutTableRef = {
  id: string;
  active_session_id?: string | null;
};

export type CheckoutReviewOrder = {
  order_id: string;
  order_no: string;
  order_type?: OrderType;
  channel?: string | null;
  external_order_code?: string | null;
  member_name?: string | null;
  member_phone?: string | null;
  member_code?: string | null;
  member_points?: number | null;
  member_stamps?: number | null;
  table_id?: string | null;
  created_at: string;
  items: CheckoutCartItem[];
  total_amount: number;
  discount_amount?: number;
  tax_total?: number;
  tax_lines?: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>;
};

export type PendingSubmitPayload = {
  order_id?: string;
  shift_id: string;
  order_type: OrderType;
  channel: string;
  table_id?: string;
  customer_name?: string;
  external_order_code?: string;
  member_name?: string;
  member_phone?: string;
  member_code?: string;
  member_points?: number;
  member_stamps?: number;
  notes?: string;
  app_total_amount: number;
  discount_amount?: number;
  gp_amount?: number;
  tax_total?: number;
  grand_total?: number;
  tax_lines?: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>;
  items: Array<{ product_id: string; quantity: number; unit_price?: number; notes?: string | null }>;
};

export type PendingSubmitShape = {
  idempotencyKey: string;
  payload: PendingSubmitPayload;
};

export function getCheckoutBlockingReason(args: {
  shiftId: string | null | undefined;
  cartSize: number;
  orderType: OrderType;
  selectedTable: CheckoutTableRef | null;
  selectedDeliveryApp: string | null;
  deliveryExternalCode: string;
}): "open_shift_required" | "add_items_first" | "open_bill_required" | "delivery_app_required" | "delivery_external_required" | null {
  const { shiftId, cartSize, orderType, selectedTable, selectedDeliveryApp, deliveryExternalCode } = args;
  if (!shiftId) return "open_shift_required";
  if (cartSize === 0) return "add_items_first";
  if (orderType === "dine_in" && !selectedTable) return "open_bill_required";
  if (orderType === "dine_in" && selectedTable && !selectedTable.active_session_id) return "open_bill_required";
  if (orderType === "delivery_manual" && !selectedDeliveryApp) return "delivery_app_required";
  if (orderType === "delivery_manual" && !deliveryExternalCode.trim()) return "delivery_external_required";
  return null;
}

export function shouldSkipDineInSubmit(args: {
  orderType: OrderType;
  currentQueuedOrder: CheckoutActiveOrder | null;
  selectedTable: CheckoutTableRef | null;
  lastCommittedCartSignature: string | null;
  cartSnapshotSignature: string;
  total: number;
}): boolean {
  const { orderType, currentQueuedOrder, selectedTable, lastCommittedCartSignature, cartSnapshotSignature, total } = args;
  return (
    orderType === "dine_in" &&
    Boolean(currentQueuedOrder?.id) &&
    Boolean(selectedTable?.active_session_id) &&
    Boolean(lastCommittedCartSignature) &&
    lastCommittedCartSignature === cartSnapshotSignature &&
    Math.abs(Number(currentQueuedOrder?.total_amount ?? 0) - total) < 0.01
  );
}

export function buildCheckoutSubmitPayload(args: {
  idempotencyKey: string;
  activeOrder: CheckoutActiveOrder | null;
  shiftId: string;
  orderType: OrderType;
  selectedTableId?: string;
  subtotal: number;
  summaryDiscount: number;
  cart: CheckoutCartItem[];
  member?: {
    name: string;
    phone: string;
    code?: string | null;
    points?: number | null;
    stamps?: number | null;
  } | null;
}): PendingSubmitShape {
  const { idempotencyKey, activeOrder, shiftId, orderType, selectedTableId, subtotal, summaryDiscount, cart, member } = args;
  return {
    idempotencyKey,
    payload: {
      order_id: activeOrder?.status === "queued" ? activeOrder.id : undefined,
      shift_id: shiftId,
      order_type: orderType,
      channel: orderType === "takeaway" ? "walk_home" : "storefront",
      table_id: orderType === "dine_in" ? selectedTableId : undefined,
      customer_name: undefined,
      external_order_code: undefined,
      member_name: member?.name ?? undefined,
      member_phone: member?.phone ?? undefined,
      member_code: member?.code ?? undefined,
      member_points: member?.points ?? undefined,
      member_stamps: member?.stamps ?? undefined,
      notes: undefined,
      app_total_amount: subtotal,
      discount_amount: summaryDiscount,
      gp_amount: 0,
      items: cart.map((item) => ({ product_id: item.product_id, quantity: item.quantity, unit_price: item.price, notes: item.notes ?? null }))
    }
  };
}

export function buildReviewOrder(args: {
  order: CheckoutActiveOrder;
  fallbackOrderType: OrderType;
  fallbackTableId?: string | null;
  fallbackTotal: number;
  items: CheckoutCartItem[];
  discountAmount: number;
  taxTotal?: number;
  taxLines?: Array<{ id: string; label: string; rate_pct: number; mode: string; amount: number }>;
  createdAt?: string;
}): CheckoutReviewOrder {
  const { order, fallbackOrderType, fallbackTableId, fallbackTotal, items, discountAmount, taxTotal, taxLines, createdAt } = args;
  return {
    order_id: order.id,
    order_no: order.order_no,
    order_type: order.order_type ?? fallbackOrderType,
    channel: order.channel ?? null,
    external_order_code: order.external_order_code ?? null,
    member_name: order.member_name ?? null,
    member_phone: order.member_phone ?? null,
    member_code: order.member_code ?? null,
    member_points: order.member_points ?? null,
    member_stamps: order.member_stamps ?? null,
    table_id: order.table_id ?? fallbackTableId ?? null,
    created_at: order.created_at ?? createdAt ?? new Date().toISOString(),
    items,
    total_amount: Number(order.total_amount ?? fallbackTotal),
    discount_amount: discountAmount,
    tax_total: taxTotal,
    tax_lines: taxLines
  };
}
