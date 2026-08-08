import { appendAuditLog } from "@/lib/audit-log";
import { enforceQuota, FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";

type DevicePayload = {
  device_id?: string;
  action?: "approve" | "activate" | "deactivate" | "block" | "update";
  device_name?: string;
  device_type?: "pos_terminal" | "mobile_scanner" | "kiosk";
  lock_mode?: "locked" | "unlocked";
};

type DeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  device_type: string;
  status: string;
  is_locked: boolean;
  metadata: Record<string, unknown> | null;
  last_seen_at: string | null;
  updated_at: string;
};

export async function GET(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { supabase } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    await requireTenantFeature(tenantId, "device_management");
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branch_id")?.trim();

    let query = supabase
      .from("branch_devices")
      .select("id,tenant_id,branch_id,device_code,device_name,device_type,status,is_locked,last_seen_at,metadata,created_at,updated_at")
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
      devices:
        data?.map((item) => ({
          ...item,
          lock_mode: item.is_locked ? "locked" : "unlocked"
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
    const body = (await req.json()) as DevicePayload;
    const deviceId = String(body.device_id ?? "").trim();
    const action = body.action ?? "update";

    if (!deviceId) {
      return fail("invalid_payload", "device_id is required.", 422);
    }

    await requireTenantFeature(tenantId, "device_management");

    const { data: current, error: currentError } = await supabase
      .from("branch_devices")
      .select("id,tenant_id,branch_id,device_code,device_name,device_type,status,is_locked,metadata,last_seen_at,updated_at")
      .eq("tenant_id", tenantId)
      .eq("id", deviceId)
      .maybeSingle<DeviceRow>();

    if (currentError) {
      throw new Error(currentError.message);
    }

    if (!current) {
      return fail("device_not_found", "Device was not found.", 404);
    }

    const patch: Record<string, unknown> = {};
    const metadata = { ...(current.metadata ?? {}) };

    if (action === "approve") {
      if (current.status !== "active") {
        try {
          await enforceQuota(tenantId, "devices", current.branch_id);
        } catch (error) {
          if (error instanceof FeatureGateError && error.code === "quota_blocked") {
            await appendAuditLog({
              tenantId,
              branchId: current.branch_id,
              actorUserId: auth.userId,
              actorRole: "it_admin",
              action: "quota_blocked",
              targetTable: "branch_devices",
              targetId: current.id,
              metadata: {
                resource_type: "devices",
                reason: error.message
              },
              ipAddress: requestMeta.ipAddress ?? undefined,
              userAgent: requestMeta.userAgent ?? undefined
            });
          }
          throw error;
        }
      }
      patch.status = "active";
      metadata.approved_at = new Date().toISOString();
      metadata.approved_by = auth.userId;
      metadata.approval_source = "it_admin";
    }

    if (action === "activate") {
      if (current.status !== "active") {
        try {
          await enforceQuota(tenantId, "devices", current.branch_id);
        } catch (error) {
          if (error instanceof FeatureGateError && error.code === "quota_blocked") {
            await appendAuditLog({
              tenantId,
              branchId: current.branch_id,
              actorUserId: auth.userId,
              actorRole: "it_admin",
              action: "quota_blocked",
              targetTable: "branch_devices",
              targetId: current.id,
              metadata: {
                resource_type: "devices",
                reason: error.message
              },
              ipAddress: requestMeta.ipAddress ?? undefined,
              userAgent: requestMeta.userAgent ?? undefined
            });
          }
          throw error;
        }
      }
      patch.status = "active";
    }

    if (action === "deactivate") {
      patch.status = "inactive";
    }

    if (action === "block") {
      patch.status = "inactive";
      patch.is_locked = true;
      metadata.compromised = true;
      metadata.blocked_at = new Date().toISOString();
      metadata.blocked_by = auth.userId;
    }

    if (action === "update") {
      if (typeof body.device_name === "string" && body.device_name.trim()) {
        patch.device_name = body.device_name.trim();
      }
      if (typeof body.device_type === "string") {
        patch.device_type = body.device_type;
      }
      if (body.lock_mode === "locked" || body.lock_mode === "unlocked") {
        patch.is_locked = body.lock_mode === "locked";
      }
    }

    if (Object.keys(patch).length === 0) {
      return fail("empty_patch", "No device changes were provided.", 422);
    }

    patch.metadata = metadata;

    const { data: updated, error: updateError } = await supabase
      .from("branch_devices")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", deviceId)
      .select("id,tenant_id,branch_id,device_code,device_name,device_type,status,is_locked,last_seen_at,metadata,updated_at")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    await appendAuditLog({
      tenantId,
      branchId: current.branch_id,
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: `admin_device_${action}`,
      targetTable: "branch_devices",
      targetId: current.id,
      metadata: {
        device_code: current.device_code,
        before_status: current.status,
        after_status: updated.status,
        before_lock_mode: current.is_locked ? "locked" : "unlocked",
        after_lock_mode: updated.is_locked ? "locked" : "unlocked"
      },
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({
      device: {
        ...updated,
        lock_mode: updated.is_locked ? "locked" : "unlocked"
      }
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}

