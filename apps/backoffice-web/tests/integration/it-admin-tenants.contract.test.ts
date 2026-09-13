import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const tenantsPage = source("../../src/app/(it-admin)/it-admin/tenants/page.tsx");
const tenantsUi = source("../../src/components/it-admin/tenant-directory-console.tsx");
const primaryBridge = source("../../../../supabase/control-plane-functions/cpipos-it-module-primary/index.ts");

describe("IT Admin tenant directory", () => {
  it("uses a dedicated tenant directory UI instead of the generic module table", () => {
    expect(tenantsPage).toContain("TenantDirectoryConsole");
    expect(tenantsPage).not.toContain("ItAdminModuleConsole");
    expect(tenantsUi).toContain('fetch("/api/it-admin/v1/modules/tenants"');
    expect(tenantsUi).toContain("statusFilter");
    expect(tenantsUi).toContain("setSelected(row)");
  });

  it("keeps POS store login out of the IT Control Plane route surface", () => {
    expect(tenantsUi).not.toContain("/login/store");
    expect(tenantsUi).toContain('href="/it-admin/store-provisioning"');
    expect(tenantsUi).toContain('href="/it-admin/branches"');
    expect(tenantsUi).toContain('href="/it-admin/devices"');
  });

  it("enriches tenant detail from the existing IT authority view without exposing credentials", () => {
    expect(primaryBridge).toContain('module === "tenants"');
    expect(primaryBridge).toContain('.from("it_admin_tenant_summary_v")');
    expect(primaryBridge).toContain('.from("tenant_access_codes")');
    expect(primaryBridge).toContain('.from("subscription_packages")');
    expect(primaryBridge).toContain('.from("user_branch_roles")');
    expect(primaryBridge).toContain("contract_status");
    expect(primaryBridge).toContain("active_session_count");
    expect(primaryBridge).toContain("open_shift_count");
    expect(primaryBridge).not.toContain('select("pin_hash');
    expect(tenantsUi).toContain("การใช้งานเทียบโควตา");
    expect(tenantsUi).toContain("Active POS sessions");
    expect(tenantsUi).toContain("Open shifts");
  });
});
