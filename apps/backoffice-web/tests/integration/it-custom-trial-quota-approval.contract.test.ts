import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const root = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const route = root("src/app/api/it-admin/v1/tenants/[tenantId]/approve-custom-trial/route.ts");
const page = root("src/app/(it-admin)/it-admin/tenants/[tenantId]/approve-custom-trial/page.tsx");
describe("IMDC CUSTOM trial approval controls", () => {
  it("targets the exact tenant and uses authenticated IT session", () => {
    expect(route).toContain('const IMDC_TENANT_ID = "29d295e3-6707-4476-8ca5-c8a4fdf0a3b0"');
    expect(route).toContain("await requireItAdmin()");
    expect(route).toContain("checkTarget");
  });
  it("requires approval of the current draft version and fixed 2/2/8", () => {
    expect(route).toContain("APPROVE_IMDC_CUSTOM_2_2_8");
    expect(route).toContain('.eq("status", "draft").eq("version", current.terms.version)');
    expect(route).toContain("max_branches: 2, max_devices: 2, max_users: 8");
  });
  it("preserves commercial terms and protects against settlement/usage conflicts", () => {
    expect(route).toContain("YEARLY_PRICE = 5000");
    expect(route).toContain('c.billing_interval !== "yearly"');
    expect(route).toContain('c.currency !== "THB"');
    expect(route).toContain("stats.settled_payments > 0");
    expect(route).toContain("stats.open_payment_requests > 0");
    expect(route).toContain('c.status !== "trial"');
    expect(route).toContain('.eq("amount_per_cycle", YEARLY_PRICE)');
  });
  it("approves draft before touching contract so trigger applies terms instead of min quotas", () => {
    const approve = route.indexOf('.update({ status: "approved"');
    const contract = route.indexOf('.from("tenant_subscription_contracts")\n      .update');
    expect(approve).toBeGreaterThan(0);
    expect(contract).toBeGreaterThan(approve);
    expect(route).toContain("custom_trial_post_apply_verification_failed");
    expect(route).toContain("it_custom_trial_quotas_approved");
    expect(route).toContain('max_devices: TARGET.max_devices, updated_at: now');
  });
  it("requires a human confirmation, shows actual and draft quotas", () => {
    expect(page).toContain("window.confirm(message)");
    expect(page).toContain("โควตาปัจจุบัน:");
    expect(page).toContain("ร่างเวอร์ชัน");
    expect(page).toContain("view.applied");
  });
});
