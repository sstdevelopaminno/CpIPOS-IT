import { describe, expect, it } from "vitest";
import { getSalesModeSelectionError, getSelectedSalesModeCount, normalizeRequestedPosSalesModes } from "@/lib/pos-sales-mode-entitlements";
import { normalizePosSalesModes } from "@/lib/pos-sales-modes";
describe("CUSTOM-only RW activation", () => {
  const rw = normalizeRequestedPosSalesModes({ retail_wholesale: true, general_sale: true });
  it("requires a real CUSTOM selection and counts its SD engine as one mode", () => {
    expect(getSalesModeSelectionError(rw, "custom", {})).toBeNull();
    expect(getSelectedSalesModeCount(rw)).toBe(1);
    for (const code of ["starter","growth","business"]) expect(getSalesModeSelectionError(rw, code, {})).toBe("retail_wholesale_requires_custom");
  });
  it("never defaults or coerces RW to enabled", () => {
    expect(normalizePosSalesModes(null).retail_wholesale).toBe(false);
    expect(normalizeRequestedPosSalesModes({general_sale:true}).retail_wholesale).toBe(false);
    expect(normalizeRequestedPosSalesModes({retail_wholesale:"true"}).retail_wholesale).toBe(false);
  });
  it("rejects unsupported mixing and missing SD engine", () => {
    expect(getSalesModeSelectionError(normalizeRequestedPosSalesModes({retail_wholesale:true}), "custom", {})).toBe("retail_wholesale_requires_isolated_sd_engine");
    for(const mode of ["takeaway","dine_in","buffet_table","delivery","optical_retail","recycling"]) {
      expect(getSalesModeSelectionError(normalizeRequestedPosSalesModes({...rw,[mode]:true}), "custom", {})).toBe("retail_wholesale_requires_isolated_sd_engine");
    }
  });
});
