import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { appendItAuditLog } from "@/lib/it-control-plane";
import { validateMdmCommandRequest } from "@/lib/mdm/commandPolicy";
import { type MdmCommandType, type MdmDeviceSnapshot } from "@/lib/mdm/eligibility";
import { getMdmConsoleBanner, getMdmConsoleControls } from "@/lib/mdm/webConsoleControls";
import { enforceRateLimit } from "@/lib/server/rate-limit";

const MDM_COMMAND_TYPES: readonly MdmCommandType[] = [
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
];

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
  last_heartbeat_at: string | null;
  display_name?: string | null;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isMdmCommandType(value: string): value is MdmCommandType {
  return (MDM_COMMAND_TYPES as readonly string[]).includes(value);
}

function capabilityList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item).toLowerCase()).filter(Boolean) : [];
}

function toSnapshot(device: MdmDeviceRow): MdmDeviceSnapshot {
  return {
    tenantId: device.tenant_id,
    deviceId: device.device_id,
    platform: device.platform,
    appVersion: device.app_version,
    appFlavor: device.app_flavor,
    nativeGeneration: device.native_generation,
    ownershipType: device.ownership_type,
    enrollmentMode: device.enrollment_mode,
    isDeviceOwner: device.is_device_owner,
    capabilities: capabilityList(device.capabilities)
  };
}

async function loadMdmDevice(
  supabase: Awaited<ReturnType<typeof requireItAdmin>>["supabase"],
  tenantId: string,
  deviceId: string
): Promise<MdmDeviceRow | null> {
  const { data: device, error } = await supabase
    .from("mdm_devices")
    .select("tenant_id,device_id,display_name,platform,app_version,app_flavor,native_generation,ownership_type,enrollment_mode,is_device_owner,is_full_mdm_eligible,capabilities,last_heartbeat_at")
    .eq("tenant_id", tenantId)
    .eq("device_id", deviceId)
    .maybeSingle<MdmDeviceRow>();

  if (error) throw new Error(`mdm_device_query_failed:${error.message}`);
  return device ?? null;
}

export async function GET(req: Request) {
  const startedAt = Date.now();

  try {
    const { supabase } = await requireItAdmin();
    const url = new URL(req.url);
    const tenantId = text(url.searchParams.get("tenant_id"));
    const deviceId = text(url.searchParams.get("device_id"));
    if (!tenantId || !deviceId) return fail("missing_scope", "tenant_id and device_id are required.", 422);

    const device = await loadMdmDevice(supabase, tenantId, deviceId);
    if (!device) return fail("mdm_device_not_found", "Device has not been enrolled in the Full MDM registry.", 404);

    const snapshot = toSnapshot(device);
    const controls = getMdmConsoleControls(snapshot);
    const banner = getMdmConsoleBanner(snapshot);

    const { data: commands, error: commandError } = await supabase
      .from("mdm_commands")
      .select("id,command_type,status,reason,queued_at,picked_up_at,completed_at,failed_at,expires_at,command_result")
      .eq("tenant_id", tenantId)
      .eq("device_id", deviceId)
      .order("queued_at", { ascending: false })
      .limit(25);
    if (commandError) throw new Error(`mdm_command_history_failed:${commandError.message}`);

    const response = ok({
      device: {
        tenant_id: device.tenant_id,
        device_id: device.device_id,
        display_name: device.display_name ?? null,
        platform: device.platform,
        app_version: device.app_version,
        app_flavor: device.app_flavor,
        native_generation: device.native_generation,
        ownership_type: device.ownership_type,
        enrollment_mode: device.enrollment_mode,
        is_device_owner: device.is_device_owner,
        is_full_mdm_eligible: device.is_full_mdm_eligible,
        capabilities: capabilityList(device.capabilities),
        last_heartbeat_at: device.last_heartbeat_at
      },
      banner,
      controls,
      commands: commands ?? [],
      control_plane: { authority: "CpiPOS-001.mdm_commands" }
    });
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
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

    const device = await loadMdmDevice(supabase, tenantId, deviceId);
    if (!device) return fail("mdm_device_not_found", "Device has not been enrolled in the Full MDM registry.", 404);

    const snapshot = toSnapshot(device);
    const validation = validateMdmCommandRequest({
      tenantId,
      deviceId,
      commandType,
      requestedBy: auth.userId,
      requestedByRole: "it_admin",
      reason,
      payload
    }, snapshot);

    const eligibilitySnapshot = {
      platform: device.platform,
      app_version: device.app_version,
      app_flavor: device.app_flavor,
      native_generation: device.native_generation,
      ownership_type: device.ownership_type,
      enrollment_mode: device.enrollment_mode,
      is_device_owner: device.is_device_owner,
      is_full_mdm_eligible: validation.eligibility.isEligible,
      capabilities: capabilityList(device.capabilities),
      allowed_commands: validation.eligibility.allowedCommands,
      denied_commands: validation.eligibility.deniedCommands
    };

    if (!validation.accepted) {
      const rejection = validation.reasons.join(",");
      await supabase.from("mdm_command_audit").insert({
        tenant_id: tenantId,
        device_id: deviceId,
        command_type: commandType,
        event_type: "queue_request",
        decision: "rejected",
        reason: rejection,
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
        metadata: { command_type: commandType, rejection_reasons: validation.reasons }
      });
      return fail("mdm_command_rejected", rejection || "MDM command is not allowed for this device.", 409);
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

    if (commandType === "start_remote_support") {
      const sessionMode = text(payload.sessionMode).toLowerCase();
      const requestedTtl = Math.min(Math.max(Number(payload.ttlMinutes ?? ttlMinutes), 1), 60);
      const { error: supportError } = await supabase.from("mdm_remote_support_sessions").insert({
        tenant_id: tenantId,
        device_id: deviceId,
        status: "requested",
        session_mode: sessionMode,
        started_by: auth.userId,
        command_id: command.id,
        expires_at: new Date(now.getTime() + requestedTtl * 60_000).toISOString(),
        audit_metadata: { source: "cpipos_it_admin", reason }
      });
      if (supportError) {
        await supabase.from("mdm_commands").update({
          status: "failed",
          failed_at: new Date().toISOString(),
          command_result: { code: "remote_support_session_create_failed" }
        }).eq("id", command.id);
        throw new Error(`mdm_remote_support_session_failed:${supportError.message}`);
      }
    }

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
      controls: getMdmConsoleControls(snapshot),
      control_plane: {
        authority: "CpiPOS-001.mdm_commands",
        executor_required: true,
        device_eligible: validation.eligibility.isEligible
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
