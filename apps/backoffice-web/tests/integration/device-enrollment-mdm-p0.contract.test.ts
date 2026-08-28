import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const supportPage = source("../../src/app/(it-admin)/it-admin/devices/page.tsx");
const supportRoute = source("../../src/app/api/it-admin/v1/device-support/route.ts");
const healthRoute = source("../../src/app/api/it-admin/v1/devices/[deviceId]/health/route.ts");
const activationRoute = source("../../src/app/api/it-admin/admin/activation-tokens/route.ts");
const commandRoute = source("../../src/app/api/it-admin/v1/device-commands/route.ts");

describe("Device Enrollment + MDM P0 contract", () => {
  it("keeps device pairing token one-time and hashed at rest", () => {
    expect(activationRoute).toContain("crypto.randomBytes(32)");
    expect(activationRoute).toContain("hashToken(rawToken)");
    expect(activationRoute).toContain("token_hash: tokenHash");
    expect(activationRoute).not.toContain("token_plaintext");
    expect(supportPage).toContain("One-time token");
  });

  it("reads business enrollment from CpiPOS-001 and operational telemetry from CpiPOS-002", () => {
    expect(supportRoute).toContain('supabase.from("device_enrollments")');
    expect(supportRoute).toContain('itSupabase.from("it_devices")');
    expect(supportRoute).toContain('itSupabase.from("it_device_health_latest")');
    expect(supportRoute).toContain('itSupabase.from("it_device_commands")');
    expect(supportRoute).toContain('identity_plane: "CpiPOS-001"');
    expect(supportRoute).toContain('operational_plane: "CpiPOS-002"');
  });

  it("exposes full support telemetry without inventing health", () => {
    for (const field of [
      "connectivity",
      "system_health",
      "runtime_health",
      "peripheral_health",
      "offline_sale_health",
      "security_signals",
      "last_error"
    ]) {
      expect(healthRoute).toContain(field);
    }
    expect(healthRoute).toContain('telemetry_state: health?.last_seen_at ? "reporting" : "awaiting_heartbeat"');
    expect(supportPage).toContain("CPU / RAM / Storage");
    expect(supportPage).toContain("Printer / Peripheral");
  });

  it("keeps remote commands scoped and shows ACK execution result", () => {
    expect(commandRoute).toContain("tenant_id, branch_id, and pos_device_id are required");
    expect(commandRoute).toContain('.eq("tenant_id", tenantId)');
    expect(commandRoute).toContain('.eq("branch_id", branchId)');
    expect(commandRoute).toContain('from("it_device_commands")');
    expect(supportPage).toContain("execution_status");
    expect(supportPage).toContain("Command / ACK History");
  });

  it("uses existing enrollment approval API instead of creating a second enrollment authority", () => {
    expect(supportPage).toContain("/api/it-admin/v1/device-enrollments");
    expect(supportPage).toContain("/approve");
    expect(supportPage).toContain("/api/it-admin/v1/activation-tokens");
  });
});
