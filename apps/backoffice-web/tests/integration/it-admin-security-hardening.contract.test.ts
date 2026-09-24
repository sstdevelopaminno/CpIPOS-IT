import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
function source(path: string) { return readFileSync(new URL(path, import.meta.url), "utf8"); }
describe("privileged IT security boundaries", () => {
  it("rechecks current admin status instead of trusting stale JWT roles", () => {
    const guard = source("../../src/lib/it-admin-guard.ts");
    expect(guard).toContain('from("users_profiles")');
    expect(guard).toContain("profileLookup.data?.is_active !== true");
    expect(guard).toContain('profileLookup.data.platform_role !== "it_admin"');
    expect(guard).toContain("admin_profile_unavailable");
  });
  it("bounds actual incoming bytes across sensitive IT mutations", () => {
    for (const file of [
      "../../src/app/api/it-admin/v1/mdm/commands/route.ts",
      "../../src/app/api/it-admin/v1/device-commands/route.ts",
      "../../src/app/api/it-admin/v1/store-registrations/route.ts",
      "../../src/app/api/it-admin/v1/store-provisioning/route.ts",
      "../../src/app/api/it-admin/v1/tenants/route.ts",
      "../../src/app/api/it-admin/v1/tenants/[tenantId]/control/route.ts",
      "../../src/app/api/it-admin/v1/tenants/[tenantId]/pos-menu-policies/route.ts"
    ]) expect(source(file)).toContain("readBoundedJson");
  });
  it("stores sanitized audit metadata in both audit planes", () => {
    expect(source("../../src/lib/audit-log.ts")).toContain("sanitizeAuditObject(value)");
    expect(source("../../src/lib/it-control-plane.ts")).toContain("sanitizeAuditObject(input.metadata)");
    const mdm = source("../../src/app/api/it-admin/v1/mdm/commands/route.ts");
    expect(mdm).toContain("safeReason");
    expect(mdm).not.toContain("await req.json()");
  });
});
