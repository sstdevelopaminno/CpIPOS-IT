import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POS_MENU_CATALOG, isPosMenuEnabled, posMenuKeyForRoute } from "../../src/lib/pos-menu-policy";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const api = read("../../src/app/api/it-admin/v1/tenants/[tenantId]/pos-menu-policies/route.ts");
const legacy = read("../../src/app/api/it-admin/v1/tenants/[tenantId]/menu-visibility/route.ts");
const ui = read("../../src/components/it-admin/tenant-pos-menu-policies.tsx");
const availability = read("../../src/lib/pos-menu-effective-state.ts");

describe("IT ↔ POS single-source menu policy", () => {
  it("maps every legacy menu switch to exactly one canonical key (including shift)", () => {
    const canonical = POS_MENU_CATALOG.map(item => item.key).sort();
    const aliases = [...legacy.matchAll(/\b[a-z_]+: "((?:main|more|settings)\.[a-z_]+)"/g)].map(match => match[1]);
    expect(canonical).toHaveLength(31);
    expect(new Set(canonical).size).toBe(canonical.length);
    expect(new Set(aliases).size).toBe(aliases.length);
    expect(aliases.sort()).toEqual(canonical);
    expect(posMenuKeyForRoute("/preview/pos/shift")).toBe("main.shift");
  });

  it("locks only an exact key; an enabled shift is not locked by IT menu policy", () => {
    for (const item of POS_MENU_CATALOG) {
      const overrides = { [item.key]: false };
      expect(isPosMenuEnabled(item.key, overrides)).toBe(false);
      for (const other of POS_MENU_CATALOG) {
        if (other.key !== item.key) expect(isPosMenuEnabled(other.key, overrides)).toBe(true);
      }
    }
    expect(isPosMenuEnabled("main.shift", { "main.shift": true, "main.more": false })).toBe(true);
  });

  it("reads and writes the same tenant-scoped Supabase table, not subscription metadata", () => {
    expect(api.match(/from\("tenant_pos_menu_policies"\)/g)).toHaveLength(3);
    expect(api).toContain('.eq("tenant_id", tenantId)');
    expect(api).toContain('onConflict: "tenant_id,menu_key"');
    expect(api).toContain("resolvePosMenuAvailability");
    expect(api).toContain('from("tenant_feature_subscriptions")');
    expect(api).toContain('from("subscription_package_features")');
    expect(api).toContain('from("branches")');
    expect(availability).toContain("POS_MENU_NAV_FEATURES");
    expect(api).not.toContain("pos_menu_visibility");
    expect(legacy).toContain('.from("tenant_pos_menu_policies")');
    expect(legacy).not.toContain('.update({ metadata:');
  });

  it("renders actual effective status as OFF without silently granting package entitlements", () => {
    expect(ui).toContain("เปิดใช้งานใน POS");
    expect(ui).toContain("feature_allowed");
    expect(ui).toContain("aria-checked={effective}");
    expect(ui).toContain("disabled={busy !== null || !entitlement || !allowed}");
    expect(ui).toContain("/features");
    expect(ui).toContain("สิทธิ์พนักงานรายคนตรวจแยก");
  });
});
