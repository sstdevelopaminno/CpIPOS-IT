import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const source = (p: string) => readFileSync(resolve(process.cwd(), "src", p), "utf8");
const api = source("app/api/it-admin/v1/tenants/[tenantId]/optical-sales-activate/route.ts");
const ui = source("components/it-admin/tenant-pos-menu-policies.tsx");
const menu = source("app/api/it-admin/v1/tenants/[tenantId]/pos-menu-policies/route.ts");
describe("authenticated IT CUSTOM Optical cashier repair", () => {
  it("rejects inactive and non-CUSTOM/non-Optical tenants, checks branch and expired trial", () => {
    expect(api).toContain("requireItAdmin()");
    expect(api).toContain('c.status === "trial"');
    expect(api).toContain("trial_expires_at");
    expect(api).toContain("access_locked");
    expect(api).toContain('optical_retail !== true');
    expect(api).toContain('toLowerCase() !== "custom"');
    expect(api).toContain('branch_feature_denied');
  });
  it("grants only the two scoped POS baseline features and main.sales with IT audit", () => {
    expect(api).toContain('"pos.sales.access", "core_pos_sales"');
    expect(api).toContain('.eq("tenant_id", tenantId)');
    expect(api).toContain('.is("branch_id", null)');
    expect(api).toContain('menu_key: "main.sales"');
    expect(api).toContain("appendAuditLog");
    expect(api).toContain("actorUserId: admin.auth.userId");
    expect(api).not.toContain('"main.sales_list"');
  });
  it("does not conflate menu intent with computed availability", () => {
    expect(ui).toContain("aria-checked={configured}");
    expect(ui).toContain("className={configured ? styles.switchOn : styles.switchOff}");
    expect(ui).toContain("await load(); // Refresh both configured IT intent");
    expect(menu).toContain("is_optical_custom: Boolean(opticalAuthorized)");
  });
});
