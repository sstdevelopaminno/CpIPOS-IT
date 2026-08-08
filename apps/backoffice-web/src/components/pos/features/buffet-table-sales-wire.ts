import type { OrderType } from "@pos/shared-types";
import type { DiningTableItem } from "@/components/tables/types";
import {
  appendBuffetCartItem,
  confirmBuffetPricePlan,
  shouldPromptBuffetPricePicker,
  type ConfirmBuffetPlanInput,
  type ConfirmBuffetPlanResult
} from "@/components/pos/features/buffet-table-flow";

export type BuffetTableQuickMode = "buffet_table";
export type PosSalesQuickModeWithBuffet = "home" | "dine_in" | "delivery" | BuffetTableQuickMode;

export type BuffetTablePickerState = {
  open: boolean;
  table: DiningTableItem | null;
  prompted_table_id: string | null;
};

export function isBuffetTableMode(mode: string): mode is BuffetTableQuickMode {
  return mode === "buffet_table";
}

export function isTableSalesMode(mode: string): boolean {
  return mode === "dine_in" || mode === "buffet_table";
}

export function orderTypeForQuickMode(mode: PosSalesQuickModeWithBuffet): OrderType {
  if (mode === "delivery") return "delivery_manual";
  if (mode === "dine_in" || mode === "buffet_table") return "dine_in";
  return "takeaway";
}

export function shouldShowTableBrowserForMode(args: {
  quickMode: string;
  tableBrowserOpen: boolean;
}): boolean {
  return isTableSalesMode(args.quickMode) && args.tableBrowserOpen;
}

export function shouldOpenBuffetPickerAfterTableOpen(args: {
  quickMode: string;
  table: DiningTableItem | null;
  promptedTableId: string | null;
}): boolean {
  return shouldPromptBuffetPricePicker({
    quickMode: args.quickMode,
    table: args.table,
    alreadyPrompted: Boolean(args.table?.id && args.promptedTableId === args.table.id)
  });
}

export function buildOpenBuffetPickerState(args: {
  quickMode: string;
  table: DiningTableItem | null;
  promptedTableId: string | null;
}): BuffetTablePickerState {
  if (!shouldOpenBuffetPickerAfterTableOpen(args)) {
    return { open: false, table: args.table, prompted_table_id: args.promptedTableId };
  }
  return { open: true, table: args.table, prompted_table_id: args.table?.id ?? null };
}

export function closeBuffetPickerState(current: BuffetTablePickerState): BuffetTablePickerState {
  return { ...current, open: false };
}

export function confirmBuffetPickerSelection(input: ConfirmBuffetPlanInput): ConfirmBuffetPlanResult {
  return confirmBuffetPricePlan(input);
}

export function appendConfirmedBuffetItem<TCartItem extends { product_id: string; quantity: number; price: number }>(
  currentCart: TCartItem[],
  buffetItem: TCartItem
): TCartItem[] {
  return appendBuffetCartItem(currentCart, buffetItem);
}
