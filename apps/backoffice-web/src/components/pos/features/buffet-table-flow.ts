import type { DiningTableItem } from "@/components/tables/types";
import {
  DEFAULT_BUFFET_PRICE_PLANS,
  buildBuffetCartItem,
  calculateBuffetPlanTotal,
  type PosBuffetCartItem,
  type PosBuffetPricePlan
} from "@/lib/pos-buffet-pricing";

type BuffetQuickMode = "buffet_table";

export type PosBuffetTableModeState = {
  quick_mode: BuffetQuickMode;
  selected_table_id: string | null;
  selected_table_code: string | null;
  should_prompt_price_plan: boolean;
};

export type OpenBuffetTableResult = {
  state: PosBuffetTableModeState;
  selected_table: DiningTableItem;
  plans: PosBuffetPricePlan[];
};

export type ConfirmBuffetPlanInput = {
  plan_id: string;
  quantity: number;
  plans?: PosBuffetPricePlan[];
  table_code?: string | null;
};

export type ConfirmBuffetPlanResult = {
  plan: PosBuffetPricePlan;
  item: PosBuffetCartItem;
  line_total: number;
};

export function buildBuffetTableModeState(table: DiningTableItem): PosBuffetTableModeState {
  return {
    quick_mode: "buffet_table",
    selected_table_id: table.id,
    selected_table_code: table.table_code,
    should_prompt_price_plan: true
  };
}

export function shouldPromptBuffetPricePicker(args: {
  quickMode: string;
  table: DiningTableItem | null;
  alreadyPrompted: boolean;
}): boolean {
  return args.quickMode === "buffet_table" && Boolean(args.table?.id) && !args.alreadyPrompted;
}

export function createOpenBuffetTableResult(table: DiningTableItem, plans: PosBuffetPricePlan[] = DEFAULT_BUFFET_PRICE_PLANS): OpenBuffetTableResult {
  return {
    state: buildBuffetTableModeState(table),
    selected_table: table,
    plans
  };
}

export function confirmBuffetPricePlan(input: ConfirmBuffetPlanInput): ConfirmBuffetPlanResult {
  const plans = input.plans?.length ? input.plans : DEFAULT_BUFFET_PRICE_PLANS;
  const plan = plans.find((entry) => entry.id === input.plan_id && entry.is_active);
  if (!plan) {
    throw new Error("BUFFET_PRICE_PLAN_NOT_FOUND");
  }
  const quantity = Math.max(1, Math.trunc(Number(input.quantity || 1)));
  const item = buildBuffetCartItem({
    plan,
    quantity,
    tableCode: input.table_code
  });
  return {
    plan,
    item,
    line_total: calculateBuffetPlanTotal(plan, quantity)
  };
}

export function appendBuffetCartItem<TCartItem extends { product_id: string; quantity: number; price: number }>(
  currentCart: TCartItem[],
  buffetItem: TCartItem
): TCartItem[] {
  const existingIndex = currentCart.findIndex((item) => item.product_id === buffetItem.product_id && item.price === buffetItem.price);
  if (existingIndex < 0) {
    return [...currentCart, buffetItem];
  }
  return currentCart.map((item, index) =>
    index === existingIndex ? { ...item, quantity: item.quantity + buffetItem.quantity } : item
  );
}
