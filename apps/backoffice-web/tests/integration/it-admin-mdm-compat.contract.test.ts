import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const compat = source("../../src/lib/legacy-mdm-compat.ts");
const deviceCommands = source("../../src/lib/device-commands.ts");
const healthRoute = source("../../src/app/api/it-admin/v1/devices/[deviceId]/health/route.ts");
const commandRoute = source("../../src/app/api/it-admin/v1/device-commands/route.ts");
const pairingConsole = source("../../src/components/it-admin/device-pairing-console.tsx");
const healthConsole = source("../../src/components/it-admin/device-health-console.tsx");
const devicePage = source("../../src/app/(it-admin)/tenants/[tenantId]/devices/page.tsx");

describe("IT Admin MDM compatibility and pairing contract", () => {
  it("keeps the legacy bridge available for rollback without synthesizing CPU or RAM", () => {
    expect(compat).toContain('from("pos_device_health_latest")');
    expect(compat).toContain('from("it_device_health_latest")');
    expect(compat).toContain('from("pos_device_incidents")');
    expect(compat).toContain('from("it_device_incidents")');
    expect(compat).toContain('compat_source: "CpiPOS-001.pos_device_health_latest"');
    expect(compat).toContain("system_health: row.system_health");
    expect(compat).toContain("runtime_health: row.runtime_health");
    expect(compat).toContain("peripheral_health: row.peripheral_health");
    expect(compat).not.toContain("cpu_percent:");
    expect(compat).not.toContain("memory_percent:");
  });

  it("runs legacy mirroring only for devices without an active enrollment", () => {
    expect(compat).toContain('from("device_enrollments")');
    expect(compat).toContain('.eq("enrollment_status", "active")');
    expect(compat).toContain("if (activeEnrollment) return null");
  });

  it("keeps the IT legacy device command contract aligned with CpIPOS production", () => {
    for (const command of [
      "request_diagnostics_bundle",
      "request_diagnostics",
      "reload_ui",
      "restart_app",
      "test_network",
      "test_printer",
      "clear_print_queue",
      "restart_local_bridge",
      "restart_print_service",
      "refresh_config",
      "check_update",
      "disable_device",
      "enable_device"
    ]) {
      expect(deviceCommands).toContain(`"${command}"`);
    }
    expect(deviceCommands).toContain('"restart_print_service"');
    expect(deviceCommands).toContain("UNSUPPORTED_DEVICE_COMMAND_TYPES");
  });

  it("keeps CpiPOS-001 as command authority and retains the old mirror only for rollback compatibility", () => {
    expect(commandRoute).toContain('from("device_commands")');
    expect(commandRoute).toContain("primary_command_id: commandRow.id");
    expect(compat).toContain("primary_command_id");
    expect(compat).toContain('from("device_commands")');
    expect(compat).toContain('from("it_device_commands")');
    expect(compat).toContain('delivery_authority: "CpiPOS-001.device_commands"');
    expect(compat).not.toContain('from("device_commands").upsert');
    expect(compat).not.toContain('nextStatus = "acknowledged"');
  });

  it("reads current device health directly from the authoritative CpiPOS-001 tables", () => {
    expect(healthRoute).toContain('from("branch_devices")');
    expect(healthRoute).toContain('from("pos_device_health_latest")');
    expect(healthRoute).toContain('from("pos_device_incidents")');
    expect(healthRoute).toContain('from("device_commands")');
    expect(healthRoute).toContain("latest_heartbeat");
    expect(healthRoute).toContain("isNativeAgentHealth");
    expect(healthRoute).toContain('mode: "single_pos_database"');
    expect(healthRoute).not.toContain("syncLegacyDeviceCompatibility");
  });

  it("keeps legacy devices unpaired while allowing short-lived POS pairing tokens", () => {
    expect(pairingConsole).toContain("Legacy · not enrolled");
    expect(pairingConsole).toContain('token_type: "pos_terminal"');
    expect(pairingConsole).toContain('purpose: "device_activation"');
    expect(pairingConsole).toContain("expires_in_minutes: 10");
    expect(pairingConsole).toContain("Do not treat token creation itself as successful pairing");
    expect(devicePage).toContain("DevicePairingConsole");
  });

  it("shows missing CPU/RAM honestly and exposes Android/printer diagnostics when reported", () => {
    expect(healthConsole).toContain('"CPU"');
    expect(healthConsole).toContain('"RAM"');
    expect(healthConsole).toContain("Not reported");
    expect(healthConsole).toContain("native_android_diagnostics");
    expect(healthConsole).toContain("Detected printer hardware");
    expect(healthConsole).toContain("Command history / ACK");
    expect(healthConsole).toContain("30_000");
  });
});
