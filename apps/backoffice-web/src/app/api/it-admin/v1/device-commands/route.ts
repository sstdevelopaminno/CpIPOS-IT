import { appendAuditLog } from "@/lib/audit-log";
import {
  DEVICE_COMMAND_TTL_MS,
  isDeviceCommandType,
  isImmediateDeviceCommand,
  type DeviceCommandType
} from "@/lib/device-commands";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";

type DeviceCommandRequestBody = {
  tenant_id?: string;
  branch_id?: string;
  pos_device_id?: string;
  command_type?: string;
};

type BranchDeviceRow = {
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
    const { auth, supabase, requestMeta } = await requireItAdmin();

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

    const { data: device, error: deviceError } = await supabase
      .from("branch_devices")
      .select("id,tenant_id,branch_id,device_code,status")
      .eq("id", posDeviceId)
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .maybeSingle<BranchDeviceRow>();

    if (deviceError) throw new Error(deviceError.message);
    if (!device) return fail("device_not_found", "Device was not found for this tenant/branch.", 404);

    const now = new Date();
    const isImmediate = isImmediateDeviceCommand(commandType);

    if (isImmediate) {
      const nextStatus = commandType === "disable_device" ? "inactive" : "active";
      const { error: updateError } = await supabase
        .from("branch_devices")
        .update({ status: nextStatus, updated_at: now.toISOString() })
        .eq("id", device.id);
      if (updateError) throw new Error(updateError.message);
    }

    const { data: commandRow, error: insertError } = await supabase
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
        result: isImmediate ? { applied: true } : {}
      })
      .select("id,command_type,status,issued_at,expires_at,delivered_at")
      .single();

    if (insertError || !commandRow) {
      throw new Error(insertError?.message ?? "Failed to issue device command.");
    }

    await appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole: auth.platformRole,
      action: "device_command_issued",
      targetTable: "device_commands",
      targetId: commandRow.id,
      metadata: {
        device_id: device.id,
        device_code: device.device_code,
        command_type: commandType,
        immediate: isImmediate
      },
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    const response = ok({ command: commandRow });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
