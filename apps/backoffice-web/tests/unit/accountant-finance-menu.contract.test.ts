import { describe, expect, it } from "vitest";
import { POS_MENU_CATALOG, isCustomPosMenuVisible } from "../../src/lib/pos-menu-policy";
import { isFinancePackageAllowed } from "../../src/lib/finance-package-policy";
import { ACCOUNTANT_ALLOWED_MENU_KEYS, ACCOUNTANT_MORE_MENU_KEYS, ACCOUNTANT_SETTINGS_MENU_KEYS } from "../../src/lib/accountant-menu-policy";
import { resolvePosMenuAvailability } from "../../src/lib/pos-menu-effective-state";

describe("IT and POS Finance menu contract", () => {
  it("exposes the canonical Finance key and matches the fixed Accountant navigation", () => {
    expect(POS_MENU_CATALOG.some(item => item.key === "main.finance" && item.group === "main")).toBe(true);
    expect(ACCOUNTANT_MORE_MENU_KEYS).toEqual([
      "more.sales_summary", "more.receipts", "more.tax_invoices", "more.stock", "more.product_sales"
    ]);
    expect(ACCOUNTANT_SETTINGS_MENU_KEYS).toHaveLength(18);
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("settings.users");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("main.sales");
    expect(ACCOUNTANT_ALLOWED_MENU_KEYS).not.toContain("main.shift");
    for (const key of ACCOUNTANT_ALLOWED_MENU_KEYS) {
      expect(POS_MENU_CATALOG.some(item => item.key === key)).toBe(true);
    }
  });

  it("only Business and CUSTOM are entitled to Finance, even if IT QA unlocks other menus", () => {
    const base = { contractStatus: "active", endedAt: null, runtime: null };
    expect(isFinancePackageAllowed({ ...base, packageCode: "business" })).toBe(true);
    expect(isFinancePackageAllowed({ ...base, packageCode: "custom" })).toBe(true);
    expect(isFinancePackageAllowed({ ...base, packageCode: "starter" })).toBe(false);
    expect(isFinancePackageAllowed({ ...base, packageCode: "growth" })).toBe(false);
    expect(isFinancePackageAllowed({ ...base, packageCode: "business", contractStatus: "suspended" })).toBe(false);
  });

  it("CUSTOM Finance does not need IT opt-in, but an explicit lock wins", () => {
    expect(isCustomPosMenuVisible("main.finance", {}, true)).toBe(true);
    expect(isCustomPosMenuVisible("main.finance", { "main.finance": false }, true)).toBe(false);
  });
  it("reports the same Finance eligibility in IT status as the POS package gate", () => {
    const base = {
      overrides: {}, contract: { status: "active", ended_at: null },
      plan: [], feature_overrides: [], active_branch_ids: ["branch"], is_custom: false,
      finance_package_allowed: true
    };
    expect(resolvePosMenuAvailability(base)["main.finance"]).toMatchObject({
      feature_code: null, feature_allowed: true, reason: "available"
    });
    expect(resolvePosMenuAvailability({ ...base, finance_package_allowed: false })["main.finance"].reason).toBe("package");
    expect(resolvePosMenuAvailability({ ...base, overrides: { "main.finance": false } })["main.finance"].reason).toBe("it_locked");
  });
});
