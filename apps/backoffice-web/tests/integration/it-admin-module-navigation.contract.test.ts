import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const layout = source("../../src/app/(it-admin)/layout.tsx");
const moduleRoute = source("../../src/app/api/it-admin/v1/modules/[module]/route.ts");
const moduleService = source("../../src/lib/services/it-admin/control-plane-module-service.ts");
const tenantsPage = source("../../src/app/(it-admin)/it-admin/tenants/page.tsx");
const provisioningPage = source("../../src/app/(it-admin)/it-admin/store-provisioning/page.tsx");
const monitoringPage = source("../../src/app/(it-admin)/it-admin/monitoring/page.tsx");
const errorBoundary = source("../../src/app/(it-admin)/error.tsx");

describe("IT Admin connected module navigation", () => {
  it("opens every sidebar module instead of leaving disabled placeholders", () => {
    for (const href of [
      "/it-admin/branches",
      "/it-admin/devices",
      "/it-admin/android",
      "/it-admin/printer",
      "/it-admin/entitlements",
      "/it-admin/incidents",
      "/it-admin/audit"
    ]) expect(layout).toContain(`href: "${href}"`);
    expect(layout).not.toContain("disabled: true");
  });

  it("loads module data through authenticated Control Plane bridges", () => {
    expect(moduleRoute).toContain("requireItAdmin()");
    expect(moduleRoute).toContain("session.access_token");
    expect(moduleRoute).toContain("loadItAdminModule(module, session.access_token)");
    expect(moduleService).toContain("cpipos-it-module-primary");
    expect(moduleService).toContain("cpipos-it-module-operational");
    expect(moduleService).not.toContain("SERVICE_ROLE");
  });

  it("removes direct service-role page rendering from high-traffic menu pages", () => {
    expect(tenantsPage).not.toContain("requireItAdmin");
    expect(tenantsPage).not.toContain("context.supabase");
    expect(provisioningPage).not.toContain("context.supabase");
    expect(monitoringPage).toContain('module="monitoring"');
    expect(monitoringPage).not.toContain("/api/it-admin/v1/monitor");
  });

  it("keeps a route-level recovery UI so one module failure cannot blank the whole IT portal", () => {
    expect(errorBoundary).toContain("reset");
    expect(errorBoundary).toContain("หน้านี้โหลดข้อมูลไม่สำเร็จ");
  });
});
