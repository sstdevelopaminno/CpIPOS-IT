type DeliveryCartItem = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
};

type DeliveryHeldBill = {
  id: string;
  held_at: string;
  label: string;
  source_order_id?: string | null;
  source_order_status?: string | null;
  order_type: "delivery_manual";
  table_id?: string | null;
  table_code?: string | null;
  delivery_app_id?: "lineman" | "grabfood" | "shopeefood" | null;
  delivery_external_code?: string | null;
  delivery_customer_name?: string | null;
  delivery_notes?: string | null;
  queue_status?: "pending" | "editing" | "sending" | "sent" | "cancelled";
  status_history?: Array<{
    status: "pending" | "editing" | "sending" | "sent" | "cancelled";
    at: string;
    note?: string | null;
  }>;
  items: DeliveryCartItem[];
  subtotal: number;
  discount_amount?: number;
};

export function getDeliveryStageBlockingReason(args: {
  orderType: "dine_in" | "takeaway" | "delivery_manual";
  selectedDeliveryApp: "lineman" | "grabfood" | "shopeefood" | null;
  deliveryExternalCode: string;
  pricedCartSize: number;
}): "delivery_pending_bill_need_order" | "add_items_first" | null {
  const { orderType, selectedDeliveryApp, deliveryExternalCode, pricedCartSize } = args;
  if (orderType !== "delivery_manual") return "delivery_pending_bill_need_order";
  if (!selectedDeliveryApp || !deliveryExternalCode.trim()) return "delivery_pending_bill_need_order";
  if (pricedCartSize === 0) return "add_items_first";
  return null;
}

export function buildNewStagedDeliveryHeldBill(args: {
  heldAt: string;
  label: string;
  selectedDeliveryApp: "lineman" | "grabfood" | "shopeefood";
  deliveryExternalCode: string;
  deliveryNotes: string;
  pricedCart: DeliveryCartItem[];
  summaryDiscount: number;
}): DeliveryHeldBill {
  const { heldAt, label, selectedDeliveryApp, deliveryExternalCode, deliveryNotes, pricedCart, summaryDiscount } = args;
  return {
    id: crypto.randomUUID(),
    held_at: heldAt,
    label,
    source_order_id: null,
    source_order_status: null,
    order_type: "delivery_manual",
    table_id: null,
    table_code: null,
    delivery_app_id: selectedDeliveryApp,
    delivery_external_code: deliveryExternalCode.trim(),
    delivery_customer_name: null,
    delivery_notes: deliveryNotes.trim() || null,
    items: pricedCart.map((item) => ({ ...item })),
    subtotal: Number(pricedCart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)),
    discount_amount: summaryDiscount,
    queue_status: "pending",
    status_history: [
      {
        status: "pending",
        at: heldAt,
        note: null
      }
    ]
  };
}

export function applyStagedDeliveryToHeldBills(args: {
  current: Array<
    DeliveryHeldBill | {
      id: string;
      order_type: string;
      [key: string]: unknown;
    }
  >;
  editingHeldBillId: string | null;
  nextHeldBill: DeliveryHeldBill;
  heldAt: string;
  selectedDeliveryApp: "lineman" | "grabfood" | "shopeefood";
  deliveryExternalCode: string;
  deliveryNotes: string;
  pricedCart: DeliveryCartItem[];
  summaryDiscount: number;
  appendStatusHistory: (
    bill: DeliveryHeldBill | { id: string; order_type: string; [key: string]: unknown },
    status: "pending" | "editing" | "sending" | "sent" | "cancelled",
    note?: string | null
  ) => Array<{ status: "pending" | "editing" | "sending" | "sent" | "cancelled"; at: string; note?: string | null }>
}): Array<DeliveryHeldBill | { id: string; order_type: string; [key: string]: unknown }> {
  const {
    current,
    editingHeldBillId,
    nextHeldBill,
    heldAt,
    selectedDeliveryApp,
    deliveryExternalCode,
    deliveryNotes,
    pricedCart,
    summaryDiscount,
    appendStatusHistory
  } = args;
  if (editingHeldBillId) {
    return current.map((entry) => {
      if (entry.id !== editingHeldBillId || entry.order_type !== "delivery_manual") {
        return entry;
      }
      return {
        ...entry,
        held_at: heldAt,
        label: nextHeldBill.label,
        delivery_app_id: selectedDeliveryApp,
        delivery_external_code: deliveryExternalCode.trim(),
        delivery_notes: deliveryNotes.trim() || null,
        items: pricedCart.map((item) => ({ ...item })),
        subtotal: Number(pricedCart.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)),
        discount_amount: summaryDiscount,
        queue_status: "pending",
        status_history: appendStatusHistory(entry, "pending", "updated_from_edit")
      };
    });
  }
  return [nextHeldBill, ...current].slice(0, 50);
}
