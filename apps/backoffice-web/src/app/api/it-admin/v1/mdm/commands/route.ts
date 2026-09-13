import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { appendItAuditLog } from "@/lib/it-control-plane";
import { enforceRateLimit } from "@/lib/server/rate-limit";

const MDM_COMMAND_TYPES = [
  "lock_device",
  "unlock_device",
  "request_location",
  "start_remote_support",
  "stop_remote_support",
  "install_app",
  "uninstall_app",
  "sync_policy",
  "revoke_device_access",
  "financing_lock",
  "diagnostics_ping"
] as const;

type MdmCommandType = (typeof MDM_COMMAND_TYPES)[number];

type MdmCommandRequestBody = {
  tenant_id?: string;
  device_id?: string;
  command_type?: string;
  reason?: string;
  payload?: Record<string, unknown>;
  ttl_minutes?: number;
};

type MdmDeviceRow = {
  tenant_id: string;
  device_id: string;
  platform: string;
  app_version: string;
  app_flavor: string;
  native_generation: string | null;
  ownership_type: string;
  enrollment_mode: string;
  is_device_owner: boolean;
  is_full_mdm_eligible: boolean;
  capabilities: unknown;
};

const COMMAND_CAPABILITY: Partial<Record<MdmCommandType, string>> = {
  lock_device: "remote_lock",
  unlock_device: "remote_lock",
  financing_lock: "remote_lock",
  revoke_device_access: "remote_lock",
  request_location: "location",
  start_remote_support: "remote_support",
  stop_remote_support: "remote_support",
  install_app: "app_install",
  uninstall_app: "app_uninstall",
  sync_policy: "policy_sync"
};

const SENSITIVE_COMMANDS = new Set<MdmCommandType>([
  "lock_device",
  "unlock_device",
  "request_location",
  "start_remote_support",
  "install_app",
  "uninstall_app",
  "revoke_device_access",
  "financing_lock"
]);

const CORE_AGENT_PACKAGES = new Set([
  "com.cpipos",
  "com.cpipos.pos",
  "com.cpipos.mdm",
  "com.cuttingpoint.cpipos"
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMdmCommandType(value: string): value is MdmCommandType {
  return (MDM_COMMAND_TYPES as readonly string[]).includes(value);
}

function capabilities(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item).toLowerCase()).filter(Boolean) : [];
}

function rejectionReason(
  commandType: MdmCommandType,
  reason: string,
  payload: Record<string, unknown>,
  device: MdmDeviceRow
): string | null {
  if (commandType !== "diagnostics_ping" && !device.is_full_mdm_eligible) {
    return "device_not_eligible_for_full_mdm";
  }

  const requiredCapability = COMMAND_CAPABILITY[commandType];
  if (requiredCapability && !capabilities(device.capabilities).includes(requiredCapability)) {
    return `device_capability_required:${requiredCapability}`;
  }

  if (SENSITIVE_COMMANDS.has(commandType) && reason.length < 8) {
    return "reason_required_for_sensitive_mdm_command";
  }

  if (commandType === "install_app" || commandType === "uninstall_app") {
    const packageName = text(payload.packageName);
    if (!packageName) return "android_package_name_required";
    if (commandType === "uninstall_app" && CORE_AGENT_PACKAGES.has(packageName.toLowerCase())) {
      return "core_agent_uninstall_blocked_use_revoke_access_policy";
    }
  }

  if (commandType === "start_remote_support") {
    const sessionMode = text(payload.sessionMode).toLowerCase();
    const sessionTtl = Number(payload.ttlMinutes ?? 0);
    if (!new Set(["attended", "company_kiosk"]).has(sessionMode)) {
      return "remote_support_requires_attended_or_company_kiosk_mode";
    }
    if (!Number.isFinite(sessionTtl) || sessionTtl <= 0 || sessionTtl > 60) {
      return "remote_support_ttl_must_be_1_to_60_minutes";
    }
  }

  return null;
}

export async function POST(req: Request) {
  const startedAt = Date.now();

  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const rateLimit = await enforceRateLimit({
      namespace: "it_admin_full_mdm_command",
      key: auth.userId,
      max: 20,
      windowMs: 60_000
    });
    if (!rateLimit.ok) return fail("rate_limited", "Too many MDM commands. Please wait and try again.", 429);

    const body = (await req.json().catch(() => ({}))) as MdmCommandRequestBody;
    const tenantId = text(body.tenant_id);
    const deviceId = text(body.device_id);
    const commandTypeRaw = text(body.command_type);
    const reason = text(body.reason);
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : {};
    const ttlMinutes = Math.min(Math.max(Number(body.ttl_minutes ?? 30), 1), 60);

    if (!tenantId || !deviceId) return fail("missing_scope", "tenant_id and device_id are required.", 422);
    if (!isMdmCommandType(commandTypeRaw)) return fail("invalid_mdm_command_type", "Unknown MDM command type.", 422);
    const commandType: MdmCommandType = commandTypeRaw;

    const { data: device, error: deviceError } = await supabase
      .from("mdm_devices")
      .select("tenant_id,device_id,platform,app_version,app_flavor,native_generation,ownership_type,enrollment_mode,is_device_owner,is_full_mdm_eligible,capabilities")
      .eq("tenant_id", tenantId)
      .eq("device_id", deviceId)
      .maybeSingle<MdmDeviceRow>();

    if (deviceError) throw new Error(`mdm_device_query_failed:${deviceError.message}`);
    if (!device) return fail("mdm_device_not_found", "Device has not been enrolled in the Full MDM registry.", 404);

    const rejected = rejectionReason(commandType, reason, payload, device);
    const eligibilitySnapshot = {
      platform: device.platform,
      app_version: device.app_version,
      app_flavor: device.app_flavor,
      native_generation: device.native_generation,
      ownership_type: device.ownership_type,
      enrollment_mode: device.enrollment_mode,
      is_device_owner: device.is_device_owner,
      is_full_mdm_eligible: device.is_full_mdm_eligible,
      capabilities: capabilities(device.capabilities)
    };

    if (rejected) {
      await supabase.from("mdm_command_audit").insert({
        tenant_id: tenantId,
        device_id: deviceId,
        command_type: commandType,
        event_type: "queue_request",
        decision: "rejected",
        reason: rejected,
        actor_id: auth.userId,
        actor_role: "it_admin",
        metadata: { reason_text: reason, payload, eligibility: eligibilitySnapshot }
      });
      await appendItAuditLog({
        tenantId,
        actorUserId: auth.userId,
        action: "mdm_command_rejected",
        targetType: "mdm_device",
        targetId: deviceId,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
        metadata: { command_type: commandType, rejection: rejected }
      });
      return fail("mdm_command_rejected", rejected, 409);
    }

    const now = new Date();
    const { data: command, error: commandError } = await supabase
      .from("mdm_commands")
      .insert({
        tenant_id: tenantId,
        device_id: deviceId,
        command_type: commandType,
        status: "queued",
        reason: reason || null,
        payload,
        requested_by: auth.userId,
        requested_by_role: "it_admin",
        eligibility_snapshot: eligibilitySnapshot,
        queued_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ttlMinutes * 60_000).toISOString()
      })
      .select("id,tenant_id,device_id,command_type,status,queued_at,expires_at")
      .single();

    if (commandError || !command) throw new Error(commandError?.message ?? "mdm_command_insert_failed");

    await Promise.all([
      supabase.from("mdm_command_audit").insert({
        tenant_id: tenantId,
        device_id: deviceId,
        command_id: command.id,
        command_type: commandType,
        event_type: "queued",
        decision: "accepted",
        reason: reason || null,
        actor_id: auth.userId,
        actor_role: "it_admin",
        metadata: { payload, eligibility: eligibilitySnapshot }
      }),
      appendItAuditLog({
        tenantId,
        actorUserId: auth.userId,
        action: "mdm_command_queued",
        targetType: "mdm_commands",
        targetId: command.id,
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
        metadata: { device_id: deviceId, command_type: commandType, ttl_minutes: ttlMinutes }
      })
    ]);

    const response = ok({
      command,
      control_plane: {
        authority: "CpiPOS-001.mdm_commands",
        executor_required: true,
        device_eligible: device.is_full_mdm_eligible
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
