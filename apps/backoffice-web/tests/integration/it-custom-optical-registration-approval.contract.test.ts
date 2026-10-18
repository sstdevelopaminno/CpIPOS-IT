import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePosSalesModes } from "../../src/lib/pos-sales-modes";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const ui = read("src/components/it-admin/store-registrations-console.tsx");
const route = read("src/app/api/it-admin/v1/store-registrations/route.ts");

describe("CUSTOM Optical registration approval", () => {
  it("preserves Optical sales mode on existing CUSTOM applications", () => {
    expect(normalizePosSalesModes({ general_sale: false, optical_retail: true }).optical_retail).toBe(true);
    expect(ui).toContain('optical_retail: Boolean(r.sales_modes?.optical_retail)');
    expect(ui).toContain('key: "optical_retail"');
  });
  it("offers Optical only for CUSTOM and clears it on package downgrade", () => {
    expect(ui).toContain('m.key !== "optical_retail" || dialogCustom');
    expect(ui).toContain('optical_retail: custom ? prev.sales_modes.optical_retail : false');
  });
  it("enforces CUSTOM-only Optical at both edit and activation, not just the UI", () => {
    expect(route).toContain("patch.sales_modes.optical_retail");
    expect(route).toContain('proposed.data.code !== "custom" && proposed.data.quota_mode !== "custom"');
    expect(route).toContain("normalizePosSalesModes(row.sales_modes).optical_retail && !isCustom");
    expect(route.match(/optical_mode_requires_custom/g)?.length).toBe(2);
    expect(route).toContain('status: "processing"');
  });
  it("retains authorized trial provisioning, contract price validation and audit", () => {
    expect(ui).toContain("resolveCustomRegistrationBilling");
    expect(route).toContain("custom_price_required");
    expect(route).toContain('billing_interval: customBilling?.billing_interval ?? "monthly"');
    expect(route).toContain("amount_per_cycle: customBilling?.amount_per_cycle");
    expect(route).toContain("requireItAdmin()");
    expect(route).toContain("appendAuditLog");
    expect(route).toContain('contract: { status: "trial"');
  });
});
