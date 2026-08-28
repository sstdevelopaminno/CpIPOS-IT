import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const compat = source("../../src/lib/legacy-mdm-compat.ts");
const healthRoute = source("../../src/app/api/it-admin/v1/devices/[deviceId]/health/route.ts");
const commandRoute = source("../../src/app/api/it-admin/v1/device-commands/route.ts");
const pairingConsole = source("../../src/components/it-admin/device-pairing-console.tsx");
const healthConsole = source("../../src/components/it-admin/device-health-console.tsx");
const devicePage = source("../../src/app/(it-admin)/tenants/[tenantId]/devices/page.tsx");

describe("IT Admin MDM legacy compatibility and pairing contract", () => {
  it("mirrors real legacy health and incidents into the IT operational plane without synthesizing metrics", () => {
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

  it("runs the compatibility bridge only for devices that are not actively enrolled", () => {
    expect(compat).toContain('from("device_enrollments")');
    expect(compat).toContain('.eq("enrollment_status", "active")');
    expect(compat).toContain("if (activeEnrollment) return null");
  });

  it("keeps command identity stable across both planes and reconciles legacy ACK results", () => {
    expect(commandRoute).toContain("mirrorLegacyDeviceCommand");
    expect(compat).toContain('from("device_commands").upsert');
    expect(compat).toContain("id: command.id");
    expect(compat).toContain('nextStatus = "acknowledged"');
    expect(compat).toContain("compat_inferred_ack");
    expect(commandRoute).toContain('status: "failed"');
    expect(commandRoute).toContain("compatibility_bridge_failed");
  });

  it("keeps the health read path fail-soft if the legacy bridge is temporarily unavailable", () => {
    expect(healthRoute).toContain("syncLegacyDeviceCompatibility");
    expect(healthRoute).toContain("legacy compatibility sync failed");
    expect(healthRoute).toContain('from("it_device_health_latest")');
    expect(healthRoute).toContain("latest_heartbeat");
    expect(healthRoute).toContain("isNativeAgentHealth");
  });

  it("keeps legacy devices explicitly unpaired while allowing short-lived POS pairing tokens", () => {
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
  });
});
