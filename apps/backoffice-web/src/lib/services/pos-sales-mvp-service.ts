import "server-only";

import type { PaymentMethod } from "@pos/shared-types";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type SalesMvpCartItemInput = {
  product_id: string;
  quantity: number;
};

export type SalesMvpProductRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  price: number;
  is_active: boolean;
};

export type CalculatedSalesTotals = {
  subtotal: number;
  discount_total: number;
  tax_total: number;
  grand_total: number;
};

export function round2(value: number): number {
  return Number(value.toFixed(2));
}

export function sanitizeDiscount(input: unknown): number {
  const value = Number(input ?? 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return round2(value);
}

export async function resolveBranchProducts(args: {
  tenantId: string;
  branchId: string;
}): Promise<{ products: SalesMvpProductRow[]; error?: string }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id,name,sku,category,price,is_active")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return { products: [], error: error.message };
  }

  const products = ((data ?? []) as SalesMvpProductRow[]).map((row) => ({
    ...row,
    price: Number(row.price ?? 0),
    is_active: Boolean(row.is_active)
  }));
  return { products };
}

export async function resolveOrderPricing(args: {
  tenantId: string;
  branchId: string;
  items: SalesMvpCartItemInput[];
  discountTotal?: unknown;
}): Promise<
  | {
      ok: true;
      pricedItems: Array<{
        product_id: string;
        name: string;
        quantity: number;
        unit_price: number;
        line_total: number;
      }>;
      totals: CalculatedSalesTotals;
    }
  | { ok: false; code: string; message: string; status: number }
> {
  const cleanedItems = args.items
    .map((item) => ({
      product_id: String(item.product_id ?? "").trim(),
      quantity: Number(item.quantity)
    }))
    .filter((item) => Boolean(item.product_id));

  if (cleanedItems.length === 0) {
    return { ok: false, code: "items_required", message: "At least one item is required.", status: 422 };
  }
  if (cleanedItems.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)) {
    return { ok: false, code: "invalid_quantity", message: "Each item quantity must be greater than zero.", status: 422 };
  }

  const uniqueProductIds = [...new Set(cleanedItems.map((item) => item.product_id))];
  const supabase = getSupabaseServiceClient();
  const { data: productRows, error: productError } = await supabase
    .from("products")
    .select("id,name,price,is_active")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .in("id", uniqueProductIds);

  if (productError) {
    return { ok: false, code: "products_query_failed", message: productError.message, status: 500 };
  }

  const productMap = new Map(
    ((productRows ?? []) as Array<{ id: string; name: string; price: number; is_active: boolean }>).map((row) => [
      row.id,
      {
        price: Number(row.price ?? 0),
        is_active: Boolean(row.is_active),
        name: String(row.name ?? "")
      }
    ])
  );

  for (const item of cleanedItems) {
    const product = productMap.get(item.product_id);
    if (!product || !product.is_active) {
      return { ok: false, code: "product_unavailable", message: "One or more selected products are unavailable.", status: 422 };
    }
  }

  const pricedItems = cleanedItems.map((item) => {
    const product = productMap.get(item.product_id);
    const unitPrice = round2(productMap.get(item.product_id)?.price ?? 0);
    const lineTotal = round2(unitPrice * item.quantity);
    return {
      product_id: item.product_id,
      name: product?.name ?? "Unknown Item",
      quantity: item.quantity,
      unit_price: unitPrice,
      line_total: lineTotal
    };
  });

  const subtotal = round2(pricedItems.reduce((sum, item) => sum + item.line_total, 0));
  const discountTotal = Math.min(subtotal, sanitizeDiscount(args.discountTotal));
  const taxTotal = 0;
  const grandTotal = round2(subtotal - discountTotal + taxTotal);

  return {
    ok: true,
    pricedItems,
    totals: {
      subtotal,
      discount_total: discountTotal,
      tax_total: taxTotal,
      grand_total: grandTotal
    }
  };
}

export function normalizePaymentMethod(value: unknown): PaymentMethod | null {
  const method = String(value ?? "").trim();
  if (method === "cash" || method === "bank_transfer") {
    return method;
  }
  return null;
}

export async function hydrateOrderItems(args: {
  tenantId: string;
  branchId: string;
  orderId: string;
}) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("order_items")
    .select("id,product_id,name,quantity,unit_price,line_total,created_at")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("order_id", args.orderId)
    .order("created_at", { ascending: true });

  if (error) {
    return { items: [], error: error.message };
  }

  return {
    items: (data ?? []).map((row) => ({
      id: String(row.id),
      product_id: row.product_id ? String(row.product_id) : null,
      name: String(row.name ?? "Unknown Item"),
      quantity: Number(row.quantity ?? 0),
      unit_price: Number(row.unit_price ?? 0),
      line_total: Number(row.line_total ?? 0),
      created_at: String(row.created_at ?? "")
    }))
  };
}

export async function hydrateOrderPayments(args: {
  tenantId: string;
  branchId: string;
  orderId: string;
}) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("payments")
    .select("id,method,amount,status,reference_no,created_at")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("order_id", args.orderId)
    .order("created_at", { ascending: true });

  if (error) {
    return { payments: [], error: error.message };
  }

  return {
    payments: (data ?? []).map((row) => ({
      id: String(row.id),
      method: String(row.method ?? ""),
      amount: Number(row.amount ?? 0),
      status: String(row.status ?? "paid"),
      reference_no: row.reference_no ? String(row.reference_no) : null,
      created_at: String(row.created_at ?? "")
    }))
  };
}
