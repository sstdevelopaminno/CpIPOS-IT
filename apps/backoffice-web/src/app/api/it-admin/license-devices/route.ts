import { getAuthContext } from "@/lib/auth-context";
import { appendDesktopLicenseAudit } from "@/lib/desktop-license-audit";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { fail, ok } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireItAdmin() {
  const auth = await getAuthContext({ requireBranchScope: false });
  if (auth.platformRole !== "it_admin") throw new Error("FORBIDDEN");
  return auth;
}

export async function POST(request: Request) {
  try {
    const auth = await requireItAdmin();
    const body = (await request.json().catch(() => ({}))) as { deviceId?: string; contractId?: string; action?: string; reason?: string };
    const deviceId = String(body.deviceId ?? "").trim();
    const contractId = String(body.contractId ?? "").trim();
    const action = String(body.action ?? "").trim();
    const reason = String(body.reason ?? "Updated by IT admin").trim();
    const supabase = getPrimarySupabaseServiceClient();
    const now = new Date().toISOString();

    if (action === "reset_device") {
      if (!deviceId) return fail("device_id_required", "deviceId is required", 400);
      const { error } = await supabase
        .from("desktop_license_devices")
        .update({
          machine_id: null,
          device_name: null,
          status: "never_seen",
          is_authorized: true,
          last_seen_at: null,
          last_license_check_at: null,
          last_sales_sync_at: null,
          security_signals: { reset_reason: reason, reset_at: now },
          updated_at: now
        })
        .eq("id", deviceId);
      if (error) throw error;
      await appendDesktopLicenseAudit({ auth, action: "desktop_license_device_reset", targetId: deviceId, request, metadata: { device_id: deviceId, reason } });
      return ok({ reset: true, device_id: deviceId });
    }

    if (action === "block_device" || action === "unblock_device") {
      if (!deviceId) return fail("device_id_required", "deviceId is required", 400);
      const authorized = action === "unblock_device";
      const { error } = await supabase
        .from("desktop_license_devices")
        .update({
          is_authorized: authorized,
          status: authorized ? "offline" : "blocked",
          security_signals: { action, reason, updated_at: now },
          updated_at: now
        })
        .eq("id", deviceId);
      if (error) throw error;
      await appendDesktopLicenseAudit({ auth, action: `desktop_license_device_${authorized ? "unblocked" : "blocked"}`, targetId: deviceId, request, metadata: { device_id: deviceId, reason } });
      return ok({ updated: true, device_id: deviceId, is_authorized: authorized });
    }

    if (action === "enable_mdm" || action === "disable_mdm") {
      if (!deviceId) return fail("device_id_required", "deviceId is required", 400);
      const enabled = action === "enable_mdm";
      const { error } = await supabase
        .from("desktop_license_devices")
        .update({
          remote_management_enabled: enabled,
          security_signals: { action, reason, updated_at: now },
          updated_at: now
        })
        .eq("id", deviceId);
      if (error) throw error;
      await appendDesktopLicenseAudit({
        auth,
        action: `desktop_license_mdm_${enabled ? "enabled" : "disabled"}`,
        targetId: deviceId,
        request,
        metadata: { device_id: deviceId, reason, remote_management_enabled: enabled }
      });
      return ok({ updated: true, device_id: deviceId, remote_management_enabled: enabled });
    }

    if (action === "reset_contract_devices") {
      if (!contractId) return fail("contract_id_required", "contractId is required", 400);
      const { error } = await supabase
        .from("desktop_license_devices")
        .update({
          machine_id: null,
          device_name: null,
          status: "never_seen",
          is_authorized: true,
          last_seen_at: null,
          last_license_check_at: null,
          last_sales_sync_at: null,
          security_signals: { reset_reason: reason, reset_at: now },
          updated_at: now
        })
        .eq("license_contract_id", contractId);
      if (error) throw error;
      await appendDesktopLicenseAudit({ auth, action: "desktop_license_contract_devices_reset", targetId: contractId, request, metadata: { contract_id: contractId, reason } });
      return ok({ reset: true, contract_id: contractId });
    }

    return fail("unknown_action", "Use reset_device, block_device, unblock_device, enable_mdm, disable_mdm or reset_contract_devices.", 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can manage desktop license devices.", 403);
    return fail("license_device_management_failed", message, 500);
  }
}
