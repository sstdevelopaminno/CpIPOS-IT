import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const DESKTOP_MDM_COMMANDS = [
  "force_sync",
  "refresh_license",
  "recheck_printer",
  "check_update",
  "collect_health"
] as const;

export type DesktopMdmCommandType = (typeof DESKTOP_MDM_COMMANDS)[number];
export type DesktopMdmCommandResult = {
  id: string;
  ok: boolean;
  code?: string | null;
  result?: Record<string, unknown> | null;
  completedAt?: string | null;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function versionParts(value: string) {
  return value.replace(/^v/i, "").split(".").map((part) => Number.parseInt(part, 10) || 0).slice(0, 3);
}

function compareVersion(a: string, b: string) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export async function issueDesktopMdmCommand(input: {
  contractId: string;
  deviceId: string;
  commandType: DesktopMdmCommandType;
  payload?: Record<string, unknown>;
  issuedBy?: string | null;
}) {
  if (!DESKTOP_MDM_COMMANDS.includes(input.commandType)) throw new Error("MDM_COMMAND_NOT_ALLOWED");
  const supabase = getPrimarySupabaseServiceClient();
  const { data: device, error: deviceError } = await supabase
    .from("desktop_license_devices")
    .select("id,license_contract_id,is_authorized,remote_management_enabled")
    .eq("id", input.deviceId)
    .eq("license_contract_id", input.contractId)
    .maybeSingle();
  if (deviceError) throw deviceError;
  if (!device || !(device as any).is_authorized) throw new Error("MDM_DEVICE_NOT_AUTHORIZED");
  if ((device as any).remote_management_enabled === false) throw new Error("MDM_DISABLED_FOR_DEVICE");

  const { data, error } = await supabase
    .from("desktop_mdm_commands")
    .insert({
      license_contract_id: input.contractId,
      license_device_id: input.deviceId,
      command_type: input.commandType,
      payload: input.payload ?? {},
      issued_by: input.issuedBy || null
    })
    .select("id,command_type,status,issued_at,expires_at")
    .single();
  if (error) throw error;
  return data;
}

async function applyCommandResults(deviceId: string, results: DesktopMdmCommandResult[]) {
  if (!results.length) return;
  const supabase = getPrimarySupabaseServiceClient();
  for (const item of results.slice(0, 20)) {
    const id = clean(item.id);
    if (!id) continue;
    const now = item.completedAt && Number.isFinite(Date.parse(item.completedAt)) ? item.completedAt : new Date().toISOString();
    const status = item.ok ? "acknowledged" : "failed";
    await supabase
      .from("desktop_mdm_commands")
      .update({
        status,
        acknowledged_at: now,
        result: { ok: Boolean(item.ok), code: item.code || null, ...(item.result ?? {}) }
      })
      .eq("id", id)
      .eq("license_device_id", deviceId)
      .in("status", ["pending", "delivered"]);
  }
}

export async function getDesktopControlEnvelope(input: {
  licenseId: string;
  deviceCode: string;
  appVersion?: string | null;
  commandResults?: DesktopMdmCommandResult[];
}) {
  const supabase = getPrimarySupabaseServiceClient();
  const { data: contract, error: contractError } = await supabase
    .from("desktop_license_contracts")
    .select("id,license_id,status,update_channel,auto_update,features")
    .eq("license_id", clean(input.licenseId))
    .is("deleted_at", null)
    .maybeSingle();
  if (contractError) throw contractError;
  if (!contract) throw new Error("LICENSE_NOT_REGISTERED");

  const { data: device, error: deviceError } = await supabase
    .from("desktop_license_devices")
    .select("id,remote_management_enabled")
    .eq("license_contract_id", (contract as any).id)
    .eq("device_code", clean(input.deviceCode).toUpperCase())
    .eq("is_authorized", true)
    .maybeSingle();
  if (deviceError) throw deviceError;
  if (!device) throw new Error("LICENSE_DEVICE_NOT_ALLOWED");

  await applyCommandResults((device as any).id, Array.isArray(input.commandResults) ? input.commandResults : []);

  const now = new Date().toISOString();
  await supabase
    .from("desktop_mdm_commands")
    .update({ status: "expired", result: { code: "COMMAND_EXPIRED" } })
    .eq("license_device_id", (device as any).id)
    .in("status", ["pending", "delivered"])
    .lt("expires_at", now);

  let commands: any[] = [];
  if ((device as any).remote_management_enabled !== false) {
    const { data: pending, error: pendingError } = await supabase
      .from("desktop_mdm_commands")
      .select("id,command_type,payload,issued_at,expires_at,status")
      .eq("license_device_id", (device as any).id)
      .in("status", ["pending", "delivered"])
      .gt("expires_at", now)
      .order("issued_at", { ascending: true })
      .limit(10);
    if (pendingError) throw pendingError;
    commands = pending ?? [];
    const pendingIds = commands.filter((row) => row.status === "pending").map((row) => row.id);
    if (pendingIds.length) {
      await supabase.from("desktop_mdm_commands").update({ status: "delivered", delivered_at: now }).in("id", pendingIds);
      await supabase.from("desktop_license_devices").update({ last_command_at: now, updated_at: now }).eq("id", (device as any).id);
    }
  }

  const channel = clean((contract as any).update_channel) || "stable";
  const { data: policy, error: policyError } = await supabase
    .from("desktop_release_policies")
    .select("channel,latest_version,minimum_version,mandatory,rollout_percent,download_url,notes,updated_at")
    .eq("channel", channel)
    .maybeSingle();
  if (policyError) throw policyError;

  const currentVersion = clean(input.appVersion) || "0.0.0";
  const latestVersion = clean((policy as any)?.latest_version) || currentVersion;
  const minimumVersion = clean((policy as any)?.minimum_version) || latestVersion;
  const updateAvailable = compareVersion(currentVersion, latestVersion) < 0;
  const belowMinimum = compareVersion(currentVersion, minimumVersion) < 0;
  const autoInstall = Boolean((contract as any).auto_update && updateAvailable);
  const updateStatus = updateAvailable ? (belowMinimum ? "required" : "available") : "current";

  await supabase
    .from("desktop_license_devices")
    .update({ update_status: updateStatus, target_version: updateAvailable ? latestVersion : null, updated_at: now })
    .eq("id", (device as any).id);

  const features = Array.isArray((contract as any).features) ? (contract as any).features.map(String) : [];
  const salesModes = [
    features.includes("sales-grocery") ? "grocery" : null,
    features.includes("sales-takeaway") ? "takeaway" : null,
    features.includes("sales-dine-in") ? "dine-in" : null
  ].filter(Boolean);

  return {
    remote_management_enabled: (device as any).remote_management_enabled !== false,
    commands: commands.map((row) => ({ id: row.id, type: row.command_type, payload: row.payload ?? {}, issued_at: row.issued_at, expires_at: row.expires_at })),
    entitlements: {
      sales_modes: salesModes.length ? salesModes : ["grocery"],
      features
    },
    update: {
      channel,
      current_version: currentVersion,
      latest_version: latestVersion,
      minimum_version: minimumVersion,
      update_available: updateAvailable,
      below_minimum: belowMinimum,
      mandatory: Boolean((policy as any)?.mandatory || belowMinimum),
      auto_install: autoInstall,
      download_url: (policy as any)?.download_url || null,
      notes: (policy as any)?.notes || null
    }
  };
}
