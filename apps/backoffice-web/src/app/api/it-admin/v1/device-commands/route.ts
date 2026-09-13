import { appendAuditLog } from "@/lib/audit-log";
import {
  DEVICE_COMMAND_TTL_MS,
  isDeviceCommandType,
  isImmediateDeviceCommand,
  type DeviceCommandType
} from "@/lib/device-commands";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { appendItAuditLog } from "@/lib/it-control-plane";
import { enforceRateLimit } from "@/lib/server/rate-limit";

type DeviceCommandRequestBody = {
  tenant_id?: string;
  branch_id?: string;
  pos_device_id?: string;
  command_type?: string;
};

type ItDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  status: string;
};

function sanitizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    const { auth, supabase, itSupabase, requestMeta } = await requireItAdmin();

    const rateLimit = await enforceRateLimit({
      namespace: "it_admin_device_command",
      key: auth.userId,
      max: 30,
      windowMs: 60_000
    });
    if (!rateLimit.ok) {
      return fail("rate_limited", "Too many device commands issued. Please wait and try again.", 429);
    }

    const body = (await req.json().catch(() => ({}))) as DeviceCommandRequestBody;
    const tenantId = sanitizeId(body.tenant_id);
    const branchId = sanitizeId(body.branch_id);
    const posDeviceId = sanitizeId(body.pos_device_id);
    const commandTypeRaw = sanitizeId(body.command_type);

    if (!tenantId || !branchId || !posDeviceId) {
      return fail("missing_scope", "tenant_id, branch_id, and pos_device_id are required.", 422);
    }
    if (!isDeviceCommandType(commandTypeRaw)) {
      return fail("invalid_command_type", "Unknown device command type.", 422);
    }
    const commandType: DeviceCommandType = commandTypeRaw;

    const { data: device, error: deviceError } = await itSupabase
      .from("it_devices")
      .select("id,tenant_id,branch_id,device_code,status")
      .eq("id", posDeviceId)
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .maybeSingle<ItDeviceRow>();

    if (deviceError) throw new Error(`it_device_query_failed:${deviceError.message}`);
    if (!device) return fail("device_not_found", "Device was not found for this tenant/branch.", 404);

    // The primary CpIPOS plane is authoritative for command delivery. Confirm that
    // the mirrored IT device still resolves to the same tenant/branch before queueing.
    const { data: primaryDevice, error: primaryDeviceError } = await supabase
      .from("branch_devices")
      .select("id,tenant_id,branch_id,status")
      .eq("id", device.id)
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .maybeSingle<{ id: string; tenant_id: string; branch_id: string; status: string }>();

    if (primaryDeviceError) throw new Error(`primary_device_query_failed:${primaryDeviceError.message}`);
    if (!primaryDevice) {
      return fail("primary_device_not_found", "Device is not linked to the CpIPOS command plane.", 409);
    }

    const now = new Date();
    const isImmediate = isImmediateDeviceCommand(commandType);

    if (isImmediate) {
      const nextStatus = commandType === "disable_device" ? "inactive" : "active";

      const { error: primaryUpdateError } = await supabase
        .from("branch_devices")
        .update({ status: nextStatus, updated_at: now.toISOString() })
        .eq("id", device.id)
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId);
      if (primaryUpdateError) throw new Error(`primary_device_update_failed:${primaryUpdateError.message}`);

      const { error: itUpdateError } = await itSupabase
        .from("it_devices")
        .update({ status: nextStatus, is_active: nextStatus === "active", synced_at: now.toISOString() })
        .eq("id", device.id);
      if (itUpdateError) throw new Error(`it_device_update_failed:${itUpdateError.message}`);
    }

    // Delivery authority lives on the primary device_commands queue consumed by
    // CpIPOS heartbeat. it_device_commands below is an operational mirror/audit only.
    const { data: commandRow, error: primaryInsertError } = await supabase
      .from("device_commands")
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        pos_device_id: device.id,
        command_type: commandType,
        status: isImmediate ? "delivered" : "pending",
        issued_by_user_id: auth.userId,
        issued_at: now.toISOString(),
        expires_at: new Date(now.getTime() + DEVICE_COMMAND_TTL_MS).toISOString(),
        delivered_at: isImmediate ? now.toISOString() : null,
        result: isImmediate ? { applied: true, primary_plane_updated: true } : {},
        metadata: {
          source: "cpipos_it_admin",
          authority_plane: "CpiPOS-001",
          mirror_plane: "CpiPOS-002"
        }
      })
      .select("id,command_type,status,issued_at,expires_at,delivered_at")
      .single();

    if (primaryInsertError || !commandRow) {
      throw new Error(primaryInsertError?.message ?? "Failed to issue device command on primary plane.");
    }

    const { error: mirrorInsertError } = await itSupabase
      .from("it_device_commands")
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        pos_device_id: device.id,
        command_type: commandType,
        status: isImmediate ? "delivered" : "pending",
        issued_by_user_id: auth.userId,
        issued_at: now.toISOString(),
        expires_at: new Date(now.getTime() + DEVICE_COMMAND_TTL_MS).toISOString(),
        delivered_at: isImmediate ? now.toISOString() : null,
        result: isImmediate ? { applied: true, primary_plane_updated: true } : {},
        metadata: {
          source: "cpipos_it_admin",
          primary_command_id: commandRow.id,
          delivery_authority: "device_commands"
        }
      });

    // A mirror failure must not cancel a command already accepted by the authoritative
    // delivery queue. Record it in server logs and the primary audit metadata instead.
    if (mirrorInsertError) {
      console.error("[it-admin-device-command] operational mirror insert failed", {
        command_id: commandRow.id,
        message: mirrorInsertError.message
      });
    }

    const auditMetadata = {
      device_id: device.id,
      device_code: device.device_code,
      command_type: commandType,
      immediate: isImmediate,
      delivery_authority: "CpiPOS-001.device_commands",
      operational_mirror: "CpiPOS-002.it_device_commands",
      operational_mirror_ok: !mirrorInsertError
    };

    await Promise.all([
      appendAuditLog({
        tenantId,
        branchId,
        actorUserId: auth.userId,
        actorRole: auth.platformRole,
        action: "device_command_issued",
        targetTable: "device_commands",
        targetId: commandRow.id,
        metadata: auditMetadata,
        ipAddress: requestMeta.ipAddress ?? undefined,
        userAgent: requestMeta.userAgent ?? undefined
      }),
      appendItAuditLog({
        tenantId,
        branchId,
        actorUserId: auth.userId,
        action: "device_command_issued",
        targetType: "device_commands",
        targetId: commandRow.id,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
        metadata: auditMetadata
      })
    ]);

    const response = ok({
      command: commandRow,
      integration: {
        mode: "shared_control_plane",
        delivery_authority: "CpiPOS-001.device_commands",
        operational_mirror: "CpiPOS-002.it_device_commands",
        operational_mirror_ok: !mirrorInsertError
      }
    });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
