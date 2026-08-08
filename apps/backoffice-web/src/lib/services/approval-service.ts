import { requiresPinApproval } from "@pos/pos-domain";
import type { BranchRole, PinApprovalInput, PlatformRole } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import type { PinApprovalResult } from "@/lib/pin-approval";

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

export async function executePinApproval(args: {
  auth: AuthContext;
  input: PinApprovalInput;
  validatePin: () => Promise<PinApprovalResult>;
  appendAuditLog: AuditFn;
}): Promise<
  | {
      ok: true;
      data: { approved: true; approved_by: string; approver_role: "staff" | "manager" | "owner" | "it_admin"; action: string; approved_at: string };
    }
  | { ok: false; code: string; message: string; status: number }
> {
  const { auth, input, validatePin, appendAuditLog } = args;

  if (!requiresPinApproval(input.action)) {
    return { ok: false, code: "invalid_action", message: "This action does not support PIN approval.", status: 422 };
  }

  const result = await validatePin();

  if (!result.approved || !result.approverUserId || !result.approverRole) {
    await appendAuditLog({
      tenantId: auth.tenantId ?? undefined,
      branchId: auth.branchId ?? undefined,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "pin_approval_failed",
      targetTable: input.target_table,
      targetId: input.target_id,
      metadata: { action: input.action }
    });

    return { ok: false, code: "pin_rejected", message: "PIN approval rejected.", status: 403 };
  }

  await appendAuditLog({
    tenantId: auth.tenantId ?? undefined,
    branchId: auth.branchId ?? undefined,
    actorUserId: result.approverUserId,
    actorRole: result.approverRole,
    action: "pin_approval_granted",
    targetTable: input.target_table,
    targetId: input.target_id,
    metadata: { action: input.action, requestedBy: auth.userId }
  });

  return {
    ok: true,
    data: {
      approved: true,
      approved_by: result.approverUserId,
      approver_role: result.approverRole,
      action: input.action,
      approved_at: new Date().toISOString()
    }
  };
}

