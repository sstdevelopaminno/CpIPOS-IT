import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getPackageSalesModeLimit,
  getSalesModeSelectionError,
  getSelectedSalesModeCount,
  normalizeRequestedPosSalesModes
} from "../../src/lib/pos-sales-mode-entitlements";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const growth = { sales_mode_limit: 2, default_sales_modes: ["general_sale", "takeaway"] };
const business = { sales_mode_limit: 3, default_sales_modes: ["general_sale", "takeaway", "dine_in"] };

describe("CpIPOS IT grocery mode package operations", () => {
  it("accepts takeaway + grocery on the Growth (second) tier", () => {
    const modes = normalizeRequestedPosSalesModes({ takeaway: true, general_sale: true });
    expect(modes.general_sale).toBe(true);
    expect(getSelectedSalesModeCount(modes)).toBe(2);
    expect(getSalesModeSelectionError(modes, "growth", growth)).toBeNull();
  });

  it("accepts three named modes on Business (third) tier", () => {
    const modes = normalizeRequestedPosSalesModes({ takeaway: true, general_sale: true, dine_in: true });
    expect(getSelectedSalesModeCount(modes)).toBe(3);
    expect(getSalesModeSelectionError(modes, "business", business)).toBeNull();
  });

  it("rejects 3 on Growth and 4 on Business rather than saving invisible modes", () => {
    const three = normalizeRequestedPosSalesModes({ takeaway: true, general_sale: true, dine_in: true });
    const four = normalizeRequestedPosSalesModes({ takeaway: true, general_sale: true, dine_in: true, delivery: true });
    expect(getSalesModeSelectionError(three, "growth", growth)).toBe("sales_mode_limit_exceeded");
    expect(getSalesModeSelectionError(four, "business", business)).toBe("sales_mode_limit_exceeded");
    expect(getSalesModeSelectionError(three, "starter", { sales_mode_limit: 1 })).toBe("sales_mode_limit_exceeded");
  });

  it("rejects zero, omitted input and partial payloads cannot silently grant unrelated modes", () => {
    const none = normalizeRequestedPosSalesModes(undefined);
    expect(getSalesModeSelectionError(none, "growth", growth)).toBe("sales_mode_required");
    const onlyGrocery = normalizeRequestedPosSalesModes({ general_sale: true });
    expect(onlyGrocery.general_sale).toBe(true);
    expect(onlyGrocery.takeaway).toBe(false);
    expect(onlyGrocery.dine_in).toBe(false);
    expect(getSelectedSalesModeCount(onlyGrocery)).toBe(1);
    const legacy = normalizeRequestedPosSalesModes({ home: true, general_sale: true });
    expect(legacy.takeaway).toBe(true);
    expect(getSelectedSalesModeCount(legacy)).toBe(2);
  });

  it("respects dynamically edited package quotas and never treats CUSTOM as fixed tier", () => {
    expect(getPackageSalesModeLimit("growth", growth)).toBe(2);
    expect(getPackageSalesModeLimit("business", business)).toBe(3);
    expect(getPackageSalesModeLimit("starter", {})).toBe(1);
    expect(getPackageSalesModeLimit("growth", { sales_mode_limit: 1 })).toBe(1);
    expect(getPackageSalesModeLimit("custom", { sales_mode_limit: 1 })).toBeNull();
    const custom = normalizeRequestedPosSalesModes({ takeaway: true, general_sale: true, dine_in: true, optical_retail: true });
    expect(getSalesModeSelectionError(custom, "custom", {})).toBeNull();
    expect(getSalesModeSelectionError(normalizeRequestedPosSalesModes({ optical_retail: true }), "growth", growth))
      .toBe("optical_mode_requires_custom");
  });

  it("checks quotas both on IT sales-mode updates and package changes", () => {
    const control = source("src/lib/services/it-admin/tenant-control-service.ts");
    expect(control).toContain('if (action === "update_sales_modes")');
    expect(control).toContain("getSalesModeSelectionError(nextModes, pkg.data.code, pkg.data.metadata)");
    expect(control).toContain("sales_mode_limit_exceeded");
    expect(control).toContain("getSalesModeSelectionError(previousModes, selected.data.code, selected.data.metadata)");
    expect(control).toContain("normalizeRequestedPosSalesModes(input.sales_modes)");
  });

  it("validates the selected modes BEFORE provisioning customer identity and contract", () => {
    const registrations = source("src/app/api/it-admin/v1/store-registrations/route.ts");
    expect(registrations).toContain("getSalesModeSelectionError(selectedModes, pkg.data.code, pkg.data.metadata)");
    expect(registrations.indexOf("getSalesModeSelectionError(selectedModes")).toBeLessThan(registrations.indexOf("const claimed ="));
    expect(registrations).toContain("getSalesModeSelectionError(patch.sales_modes, proposed.data.code, proposed.data.metadata)");
    expect(registrations).toContain("const modes = selectedModes;");
  });
});
