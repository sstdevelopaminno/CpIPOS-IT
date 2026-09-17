import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { validateDesktopLicenseOnline, type DesktopHeartbeatInput } from "@/lib/desktop-license-registry";

function normalizeMachineId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export async function enforceDesktopMachineBinding(input: DesktopHeartbeatInput) {
  const incoming = normalizeMachineId(input.machineId);
  if (!incoming) return;

  const validation = await validateDesktopLicenseOnline(input.token, input.deviceCode);
  const current = normalizeMachineId(validation.device.machine_id);
  if (!current || current === incoming) return;

  const supabase = getPrimarySupabaseServiceClient();
  const now = new Date().toISOString();
  const deviceId = String(validation.device.id);

  await supabase
    .from("desktop_license_devices")
    .update({
      status: "tamper_warning",
      integrity_status: "tamper_detected",
      tamper_detected: true,
      security_signals: {
        machine_id_mismatch: true,
        expected_machine_id: current,
        observed_machine_id: incoming,
        detected_at: now
      },
      updated_at: now
    })
    .eq("id", deviceId);

  await supabase.from("desktop_license_security_events").insert({
    license_device_id: deviceId,
    event_type: "windows_machine_id_mismatch",
    severity: "critical",
    details: {
      device_code: input.deviceCode,
      expected_machine_id: current,
      observed_machine_id: incoming,
      app_version: input.appVersion ?? null
    },
    captured_at: now
  });

  throw new Error("LICENSE_MACHINE_MISMATCH");
}
