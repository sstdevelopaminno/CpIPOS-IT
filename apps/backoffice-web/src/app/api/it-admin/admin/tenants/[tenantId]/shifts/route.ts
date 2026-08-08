import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";

type ShiftPatchPayload = {
  shift_id?: string;
  action?: "close" | "suspend";
  closing_cash?: number;
};

export async function GET(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { supabase } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branch_id")?.trim();

    let query = supabase
      .from("shifts")
      .select("id,tenant_id,branch_id,opened_by,closed_by,status,opened_at,closed_at,opening_cash,closing_cash,expected_cash,actual_cash,device_code")
      .eq("tenant_id", tenantId)
      .order("opened_at", { ascending: false })
      .limit(300);

    if (branchId) {
      query = query.eq("branch_id", branchId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return ok({ shifts: data ?? [] });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = (await req.json()) as ShiftPatchPayload;
    const shiftId = String(body.shift_id ?? "").trim();
    const action = body.action ?? "suspend";

    if (!shiftId) {
      return fail("invalid_payload", "shift_id is required.", 422);
    }

    const { data: current, error: currentError } = await supabase
      .from("shifts")
      .select("id,tenant_id,branch_id,status,closed_at,closed_by,actual_cash,closing_cash")
      .eq("tenant_id", tenantId)
      .eq("id", shiftId)
      .maybeSingle();

    if (currentError) {
      throw new Error(currentError.message);
    }

    if (!current) {
      return fail("shift_not_found", "Shift was not found.", 404);
    }

    const patch: Record<string, unknown> = {};

    if (action === "close") {
      patch.status = "closed";
      patch.closed_at = current.closed_at ?? new Date().toISOString();
      patch.closed_by = current.closed_by ?? auth.userId;
      if (typeof body.closing_cash === "number") {
        patch.closing_cash = body.closing_cash;
        patch.actual_cash = body.closing_cash;
      }
    }

    if (action === "suspend") {
      patch.status = "suspended";
    }

    const { data: updated, error: updateError } = await supabase
      .from("shifts")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", shiftId)
      .select("id,tenant_id,branch_id,status,closed_at,closed_by,actual_cash,closing_cash,opened_at")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    await appendAuditLog({
      tenantId,
      branchId: current.branch_id,
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: action === "close" ? "admin_shift_closed" : "admin_shift_suspended",
      targetTable: "shifts",
      targetId: shiftId,
      beforeData: current,
      afterData: updated,
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ shift: updated });
  } catch (error) {
    return guardItAdminError(error);
  }
}

