import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";

type PolicyPayload = {
  branch_id?: string;
  require_registered_device?: boolean;
  allow_pin_login?: boolean;
  allow_staff_card_login?: boolean;
  allow_multi_device?: boolean;
  max_devices?: number;
};

export async function GET(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { supabase } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branch_id")?.trim();

    let query = supabase
      .from("branch_login_policies")
      .select(
        "id,tenant_id,branch_id,require_registered_device,allow_pin_login,allow_staff_card_login,allow_shared_devices,max_devices,updated_at"
      )
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false });

    if (branchId) {
      query = query.eq("branch_id", branchId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return ok({
      policies:
        data?.map((item) => ({
          ...item,
          allow_multi_device: item.allow_shared_devices
        })) ?? []
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = (await req.json()) as PolicyPayload;
    const branchId = String(body.branch_id ?? "").trim();

    if (!branchId) {
      return fail("invalid_payload", "branch_id is required.", 422);
    }

    const { data: current, error: currentError } = await supabase
      .from("branch_login_policies")
      .select(
        "id,tenant_id,branch_id,require_registered_device,allow_pin_login,allow_staff_card_login,allow_shared_devices,max_devices"
      )
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .maybeSingle();

    if (currentError) {
      throw new Error(currentError.message);
    }

    if (!current) {
      return fail("policy_not_found", "Login policy does not exist for this branch.", 404);
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.require_registered_device === "boolean") patch.require_registered_device = body.require_registered_device;
    if (typeof body.allow_pin_login === "boolean") patch.allow_pin_login = body.allow_pin_login;
    if (typeof body.allow_staff_card_login === "boolean") patch.allow_staff_card_login = body.allow_staff_card_login;
    if (typeof body.allow_multi_device === "boolean") patch.allow_shared_devices = body.allow_multi_device;

    if (typeof body.max_devices === "number") {
      const maxDevices = Math.max(1, Math.trunc(body.max_devices));
      patch.max_devices = maxDevices;
    }

    if (Object.keys(patch).length === 0) {
      return fail("empty_patch", "No policy changes were provided.", 422);
    }

    const { data: updated, error: updateError } = await supabase
      .from("branch_login_policies")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .select(
        "id,tenant_id,branch_id,require_registered_device,allow_pin_login,allow_staff_card_login,allow_shared_devices,max_devices,updated_at"
      )
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    await appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "admin_login_policy_updated",
      targetTable: "branch_login_policies",
      targetId: current.id,
      beforeData: current,
      afterData: updated,
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({
      policy: {
        ...updated,
        allow_multi_device: updated.allow_shared_devices
      }
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}

