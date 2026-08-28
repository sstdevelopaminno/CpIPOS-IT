import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const monitorPage = source("../../src/app/(it-admin)/it-admin/monitoring/page.tsx");
const monitorRoute = source("../../src/app/api/it-admin/v1/monitor/route.ts");
const healthRoute = source("../../src/app/api/it-admin/v1/health/route.ts");
const deviceHealthRoute = source("../../src/app/api/it-admin/v1/devices/[deviceId]/health/route.ts");
const itAdminGuard = source("../../src/lib/it-admin-guard.ts");

describe("IT Admin <-> POS shared-control-plane contract", () => {
  it("keeps the monitoring page on the IT Admin API namespace", () => {
    expect(monitorPage).toContain("/api/it-admin/v1/monitor");
    expect(monitorPage).not.toContain("/api/admin/pos/monitor");
    expect(monitorRoute).toContain("requireItAdmin()");
    expect(monitorRoute).toContain('mode: "shared_supabase"');
  });

  it("checks the shared Supabase bridge instead of requiring POS runtime secrets", () => {
    expect(healthRoute).toContain('"pos_device_health_latest"');
    expect(healthRoute).toContain('"device_commands"');
    expect(healthRoute).toContain('mode: "shared_supabase"');
    expect(healthRoute).not.toContain('"POS_SESSION_HANDOFF_SECRET"');
    expect(healthRoute).not.toContain('"TABLE_QR_SIGNING_SECRET"');
  });

  it("fails closed if any device-health source query fails", () => {
    expect(deviceHealthRoute).toContain("device_health_query_failed");
    expect(deviceHealthRoute).toContain("device_incidents_query_failed");
    expect(deviceHealthRoute).toContain("device_commands_query_failed");
    expect(deviceHealthRoute).toContain('.eq("tenant_id", device.tenant_id)');
    expect(deviceHealthRoute).toContain('.eq("branch_id", device.branch_id)');
  });

  it("does not return raw internal database errors to API callers", () => {
    expect(itAdminGuard).toContain('fail("it_admin_internal_error", "Internal server error.", 500)');
    expect(itAdminGuard).not.toContain('error instanceof Error ? error.message : "Internal server error."');
  });
});
