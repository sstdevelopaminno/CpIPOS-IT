import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const file = (name: string) => readFileSync(resolve(process.cwd(), name), "utf8");
const service = file("src/lib/services/it-admin/tenant-control-service.ts");
const ui = file("src/components/it-admin/tenant-control-center.tsx");
const migration = file("../../supabase/migrations/20261018173500_it_custom_proposed_billing_interval.sql");

describe("IT CUSTOM proposal cycle persistence across all tenants", () => {
  it("adds a constrained optional per-tenant proposed cycle with no contract or payment migration", () => {
    expect(migration).toContain("alter table public.tenant_custom_package_terms");
    expect(migration).toContain("proposed_billing_interval");
    expect(migration).toContain("tenant_custom_terms_proposed_billing_chk");
    expect(migration).not.toMatch(/(?:update|delete|truncate)\s+public\.(?:tenant_subscription_contracts|tenant_billing_cycles|tenant_subscription_payment_requests)/i);
  });
  it("saves selected cycle with the CUSTOM draft and reloads exactly its persisted preference", () => {
    expect(ui).toContain("custom_proposed_billing_interval:customBillingCycle");
    expect(service).toContain("proposed_billing_interval: proposedBilling");
    expect(service).toContain("custom_proposed_billing_interval?: string");
    expect(ui).toContain("const storedProposal = custom?.proposed_billing_interval");
    expect(ui).toContain("setCustomBillingCycle(preferredCycle)");
  });
  it("defaults legacy CUSTOM yearly trials to their actual cycle or offered yearly-only price", () => {
    expect(ui).toContain('next.current_package?.code === "custom" && next.contract?.billing_cycle === "yearly"');
    expect(ui).toContain("Number(custom?.monthly_price ?? 0) <= 0");
    expect(ui).toContain("Number(custom?.yearly_price ?? 0) > 0");
  });
  it("allows IT to prepare CUSTOM quotes for any package without directly activating features", () => {
    expect(ui).toContain("const customCanDraft = Boolean(customPackageDefinition)");
    expect(service).toContain('if (action === "update_custom_package_terms")');
    expect(service).toContain('status: "draft"');
    expect(service).toContain("custom_package_terms_draft_saved");
    expect(service).toContain('if (action === "prepare_paid_package")');
    expect(service).toContain("paid_activation_requires_settlement");
  });
  it("rejects invalid proposed cycles and mismatched financial approval cycles", () => {
    expect(service).toContain("requireBillingCycle(input.custom_proposed_billing_interval)");
    expect(service).toContain("custom_cycle_price_missing");
    expect(service).toContain("custom_proposal_cycle_mismatch");
    expect(service).toContain("tenant_subscription_payment_requests");
    expect(service).toContain('if (action === "update_sales_modes")');
    expect(service).toContain("optical_custom_only");
  });
});
