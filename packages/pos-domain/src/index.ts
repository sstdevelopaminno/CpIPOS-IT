import type { ApprovalAction, BranchRole, Order, Shift } from "@pos/shared-types";

const escalationActions: ApprovalAction[] = [
  "cancel_bill",
  "stock_adjustment",
  "employee_delete",
  "shift_close_override",
  "table_move_bill",
  "transfer_payment_override",
  "payment_account_delete",
  "sales_record_edit",
  "sales_record_delete"
];

export function requiresPinApproval(action: ApprovalAction): boolean {
  return escalationActions.includes(action);
}

export function canRoleApprove(role: BranchRole): boolean {
  return role === "manager" || role === "owner";
}

export function canStaffCancelBill(): boolean {
  return false;
}

export function hasUnpaidDineIn(orders: Order[]): boolean {
  return orders.some((order) => order.order_type === "dine_in" && order.status !== "completed" && order.status !== "cancelled");
}

export function canCloseShift(
  shift: Shift,
  options: {
    hasUnpaidDineInBills: boolean;
    isMismatch: boolean;
    hasManagerOverride: boolean;
  }
): { allowed: boolean; reason?: string } {
  if (shift.status !== "open") {
    return { allowed: false, reason: "Shift already closed." };
  }

  if ((options.hasUnpaidDineInBills || options.isMismatch) && !options.hasManagerOverride) {
    return {
      allowed: false,
      reason: "Manager/owner PIN override required for unpaid dine-in bills or mismatched close cash."
    };
  }

  return { allowed: true };
}

export * from "./subscription-pricing";

