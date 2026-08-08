export type PosBuffetPricingMode = "per_person" | "set";

export type PosBuffetPricePlan = {
  id: string;
  code: string;
  name: string;
  mode: PosBuffetPricingMode;
  price: number;
  is_active: boolean;
  description?: string | null;
};

export type PosBuffetCartItem = {
  cart_line_id: string;
  product_id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

export const DEFAULT_BUFFET_PRICE_PLANS: PosBuffetPricePlan[] = [
  {
    id: "buffet-per-person-standard",
    code: "BUFFET-PER-PERSON",
    name: "บุฟเฟ่รายท่าน",
    mode: "per_person",
    price: 199,
    is_active: true,
    description: "คิดราคาต่อจำนวนลูกค้า"
  },
  {
    id: "buffet-set-standard",
    code: "BUFFET-SET",
    name: "บุฟเฟ่แบบชุด",
    mode: "set",
    price: 599,
    is_active: true,
    description: "คิดราคาตามจำนวนชุด"
  }
];

export function normalizeBuffetQuantity(value: number | string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.trunc(parsed));
}

export function buildBuffetCartItem(args: {
  plan: PosBuffetPricePlan;
  quantity: number | string;
  tableCode?: string | null;
}): PosBuffetCartItem {
  const quantity = normalizeBuffetQuantity(args.quantity);
  const tableCode = String(args.tableCode ?? "").trim();
  const modeLabel = args.plan.mode === "per_person" ? "รายท่าน" : "แบบชุด";
  return {
    cart_line_id: `buffet-${args.plan.id}-${Date.now()}`,
    product_id: `BUFFET:${args.plan.id}`,
    name: args.plan.name,
    quantity,
    price: Number(args.plan.price || 0),
    notes: ["บุฟเฟ่", modeLabel, tableCode ? `โต๊ะ ${tableCode}` : ""].filter(Boolean).join(" / ")
  };
}

export function calculateBuffetPlanTotal(plan: PosBuffetPricePlan, quantity: number | string): number {
  return Number((Number(plan.price || 0) * normalizeBuffetQuantity(quantity)).toFixed(2));
}
