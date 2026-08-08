import type { Order } from "@pos/shared-types";

export const mockOpenOrders: Order[] = [
  {
    id: "00000000-0000-0000-0000-000000001001",
    tenant_id: "00000000-0000-0000-0000-000000000001",
    branch_id: "00000000-0000-0000-0000-000000000011",
    shift_id: "00000000-0000-0000-0000-000000008001",
    order_no: "DINE-001",
    order_type: "dine_in",
    channel: "storefront",
    table_id: "00000000-0000-0000-0000-000000007001",
    external_order_code: null,
    customer_name: "A01",
    notes: null,
    subtotal: 180,
    discount_amount: 0,
    gp_amount: 0,
    total_amount: 180,
    status: "preparing",
    created_by: "00000000-0000-0000-0000-000000000101",
    cancelled_by: null,
    cancelled_reason: null,
    created_at: new Date().toISOString()
  }
];

