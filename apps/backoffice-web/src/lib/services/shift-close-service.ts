import { canCloseShift, hasUnpaidDineIn } from "@pos/pos-domain";
import type { BranchRole, Order, PlatformRole, Shift } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";

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

export async function executeShiftClose(args: {
  auth: AuthContext;
  input: {
    shift_id: string;
    expected_cash: number;
    actual_cash: number;
    manager_override_approval_id?: string;
  };
  openOrders: Order[];
  appendAuditLog: AuditFn;
}): Promise<
  | { ok: true; data: { shift_id: string; status: "closed"; closed_at: string } }
  | { ok: false; code: string; message: string; status: number }
> {
  const { auth, input, openOrders, appendAuditLog } = args;

  if (!auth.tenantId || !auth.branchId || !auth.branchRole) {
    return { ok: false, code: "missing_scope", message: "Missing tenant/branch scope.", status: 401 };
  }

  const isMismatch = input.expected_cash !== input.actual_cash;
  const unpaidDineIn = hasUnpaidDineIn(openOrders);
  const hasManagerOverride = Boolean(input.manager_override_approval_id);

  const verdict = canCloseShift(
    {
      id: input.shift_id,
      tenant_id: auth.tenantId,
      branch_id: auth.branchId,
      opened_by: auth.userId,
      closed_by: null,
      opened_at: new Date().toISOString(),
      closed_at: null,
      opening_cash: 0,
      expected_cash: input.expected_cash,
      actual_cash: input.actual_cash,
      status: "open"
    } as Shift,
    {
      hasUnpaidDineInBills: unpaidDineIn,
      isMismatch,
      hasManagerOverride
    }
  );

  if (!verdict.allowed) {
    await appendAuditLog({
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      actorUserId: auth.userId,
      actorRole: auth.branchRole,
      action: "shift_close_blocked",
      targetTable: "shifts",
      targetId: input.shift_id,
      metadata: {
        reason: verdict.reason,
        has_unpaid_dine_in: unpaidDineIn,
        is_mismatch: isMismatch
      }
    });

    return { ok: false, code: "shift_close_blocked", message: verdict.reason ?? "Shift close blocked.", status: 409 };
  }

  await appendAuditLog({
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    actorUserId: auth.userId,
    actorRole: auth.branchRole,
    action: "shift_closed",
    targetTable: "shifts",
    targetId: input.shift_id,
    metadata: {
      expected_cash: input.expected_cash,
      actual_cash: input.actual_cash,
      manager_override_approval_id: input.manager_override_approval_id ?? null
    }
  });

  return {
    ok: true,
    data: {
      shift_id: input.shift_id,
      status: "closed",
      closed_at: new Date().toISOString()
    }
  };
}

