import { describe, expect, it } from "vitest";
import { POS_MENU_CATALOG } from "../../src/lib/pos-menu-policy";
import {
  POS_MENU_NAV_FEATURES, resolvePosMenuAvailability
} from "../../src/lib/pos-menu-effective-state";

const base = {
  overrides: {} as Record<string, boolean>,
  contract: { status: "trial", ended_at: null },
  plan: [{ feature_code: "core_pos_sales", included: true }, { feature_code: "attendance_tracking", included: false }],
  feature_overrides: [] as { feature_code: string; is_enabled: boolean; branch_id?: string | null }[],
  active_branch_ids: ["b1"],
  now: Date.parse("2026-09-25T00:00:00Z")
};

describe("IT POS menu switch reflects ACTUAL menu availability", () => {
  it("covers the exact same 31 tenant-specific menu controls", () => {
    expect(Object.keys(POS_MENU_NAV_FEATURES).sort()).toEqual(POS_MENU_CATALOG.map(m => m.key).sort());
  });
  it("shows OFF when IT is ON but package lacks feature; no other menu is cascaded", () => {
    const result = resolvePosMenuAvailability(base);
    expect(result["main.shift"]).toMatchObject({ feature_code: "attendance_tracking", feature_allowed: false, reason: "package" });
    expect(result["main.sales"]).toMatchObject({ feature_code: "core_pos_sales", feature_allowed: true, reason: "available" });
    expect(result["main.more"]).toMatchObject({ feature_code: null, feature_allowed: true, reason: "available" });
  });
  it("becomes ON as soon as the existing tenant feature override is enabled", () => {
    const result = resolvePosMenuAvailability({
      ...base, feature_overrides: [{ feature_code: "attendance_tracking", is_enabled: true, branch_id: null }]
    });
    expect(result["main.shift"]).toMatchObject({ feature_allowed: true, reason: "available" });
  });
  it("honors branch overrides with lower priority than safety but higher than tenant plan", () => {
    const result = resolvePosMenuAvailability({
      ...base, active_branch_ids: ["b1", "b2"],
      feature_overrides: [
        { feature_code: "attendance_tracking", is_enabled: true, branch_id: null },
        { feature_code: "attendance_tracking", is_enabled: false, branch_id: "b2" }
      ]
    });
    expect(result["main.shift"]).toMatchObject({
      feature_allowed: false, available_branches: 1, total_branches: 2, reason: "partial_branches"
    });
  });
  it("does not claim accessible menus for an expired contract or tenant with no active branches", () => {
    expect(resolvePosMenuAvailability({ ...base, contract: { status: "trial", ended_at: "2026-09-20T00:00:00Z" } })["main.sales"].reason).toBe("contract_inactive");
    expect(resolvePosMenuAvailability({ ...base, active_branch_ids: [] })["main.sales"].reason).toBe("no_active_branch");
  });
  it("IT OFF always stays OFF independently of package and other menu keys", () => {
    const result = resolvePosMenuAvailability({ ...base, overrides: { "main.sales": false } });
    expect(result["main.sales"]).toMatchObject({ feature_allowed: true, reason: "it_locked" });
    expect(result["main.more"].reason).toBe("available");
  });
});
