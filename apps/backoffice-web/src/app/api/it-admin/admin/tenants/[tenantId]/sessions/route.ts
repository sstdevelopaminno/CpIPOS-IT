import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";

type SessionPatchPayload = {
  session_id?: string;
  action?: "revoke";
};

export async function GET(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { supabase } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branch_id")?.trim();

    let query = supabase
      .from("pos_sessions")
      .select("id,tenant_id,branch_id,device_code,user_id,role,login_method,status,issued_at,expires_at,revoked_at,shift_id")
      .eq("tenant_id", tenantId)
      .order("issued_at", { ascending: false })
      .limit(300);

    if (branchId) {
      query = query.eq("branch_id", branchId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return ok({ sessions: data ?? [] });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = (await req.json()) as SessionPatchPayload;
    const sessionId = String(body.session_id ?? "").trim();

    if (!sessionId) {
      return fail("invalid_payload", "session_id is required.", 422);
    }

    const { data: current, error: currentError } = await supabase
      .from("pos_sessions")
      .select("id,tenant_id,branch_id,user_id,device_code,status,revoked_at")
      .eq("tenant_id", tenantId)
      .eq("id", sessionId)
      .maybeSingle();

    if (currentError) {
      throw new Error(currentError.message);
    }

    if (!current) {
      return fail("session_not_found", "POS session was not found.", 404);
    }

    if (current.status === "revoked") {
      return ok({ session: current, already_revoked: true });
    }

    const revokeAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("pos_sessions")
      .update({ status: "revoked", revoked_at: revokeAt })
      .eq("tenant_id", tenantId)
      .eq("id", sessionId)
      .select("id,tenant_id,branch_id,user_id,device_code,status,revoked_at,expires_at")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    await appendAuditLog({
      tenantId,
      branchId: current.branch_id,
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "admin_session_revoked",
      targetTable: "pos_sessions",
      targetId: sessionId,
      targetUserId: current.user_id,
      beforeData: current,
      afterData: updated,
      metadata: {
        device_code: current.device_code
      },
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ session: updated });
  } catch (error) {
    return guardItAdminError(error);
  }
}

