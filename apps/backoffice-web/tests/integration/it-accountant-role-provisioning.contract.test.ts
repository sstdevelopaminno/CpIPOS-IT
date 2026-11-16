import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const api = read("../../src/app/api/it-admin/v1/platform-users/route.ts");
const ui = read("../../src/components/it-admin/platform-users-console.tsx");
const menuApi = read("../../src/app/api/it-admin/v1/tenants/[tenantId]/pos-menu-policies/route.ts");

describe("IT Accountant is provisioned with explicit tenant scope", () => {
  it("offers the actual Accountant branch role in both UI and server validation", () => {
    expect(ui).toContain('<option value="accountant">บัญชี / Accountant</option>');
    expect(api).toContain('const BRANCH_ROLES: BranchRole[] = ["owner", "manager", "staff", "accountant"]');
    expect(api).toContain('body.accountant_all_branches === true');
    expect(ui).toContain('checked={form.accountant_all_branches}');
  });
  it("requires numeric employee code, securely hashed PIN, active branch scope, and protected owners", () => {
    expect(api).toContain('accountant_code_required');
    expect(api).toContain('accountant_pin_required');
    expect(api).toContain('await bcrypt.hash(posPin, 12)');
    expect(api).toContain('.eq("tenant_id", input.tenantId).eq("is_active", true)');
    expect(api).toContain('.eq("tenant_id", input.tenantId).eq("user_id", input.userId)');
    expect(api).toContain('row.role === "owner" || row.role === "manager"');
    expect(api).toContain('role: "accountant", is_default: id === defaultId');
    expect(api).toContain('permission_role: "accountant"');
  });
  it("returns shared finance and Accountant menu profile without cross-tenant writes", () => {
    expect(menuApi).toContain('finance_package_allowed: financePackageAllowed');
    expect(menuApi).toContain('ACCOUNTANT_MORE_MENU_KEYS');
    expect(menuApi).toContain('ACCOUNTANT_SETTINGS_MENU_KEYS');
    expect(menuApi).toContain('from("tenant_pos_menu_policies")');
    expect(menuApi).toContain('from("tenant_subscription_contracts")');
  });
});
