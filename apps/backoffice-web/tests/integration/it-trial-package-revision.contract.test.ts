import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const code = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const service = code("src/lib/services/it-admin/tenant-control-service.ts");
const screen = code("src/components/it-admin/tenant-control-center.tsx");
const legacyRoute = code("src/app/api/it-admin/admin/tenants/[tenantId]/contract/route.ts");
const legacyScreen = code("src/components/it-admin/tenant-section-console.tsx");
const confirm = code("src/components/it-admin/tenant-action-confirm.tsx");

describe("CpIPOS IT repeatable unpaid Trial package changes", () => {
  it("has a dedicated tenant-scoped action for ordinary trial stores, not QA-only", () => {
    expect(service).toContain('if (action === "revise_trial_package")');
    expect(service).toContain('decideTrialPackageRevision({');
    expect(service).toContain('hasOpenPaymentRequest:');
    expect(service).toContain('hasSettledTrialPayment:');
    expect(service).toContain('prepaidActivationPending:');
    expect(service).toContain('tenant.package_id !== previous.package_id');
    expect(service).toContain('if (rollback.error || !rollback.data)');
    expect(service).toContain('.eq("status", "trial")');
    expect(service).toContain('status_unchanged: "trial"');
    expect(service).toContain('payment_facts_unchanged: true');
    expect(service).toContain('delete metadata.sales_modes');
    expect(service).toContain('invalidateTenantFeatureGateCache(tenantId)');
    expect(service).toContain('"it_trial_package_revised"');
  });

  it("exposes a separate form during trial and requires a reason and confirmation", () => {
    expect(screen).toContain('TRIAL PACKAGE REVISION · IT ADMIN');
    expect(screen).toContain('canReviseTrialPackage');
    expect(screen).toContain('action: "revise_trial_package"');
    expect(screen).toContain('admin_reason: changeReason');
    expect(screen).toContain('ไม่สร้างใบเสร็จ');
    expect(confirm).toContain('revise_trial_package:');
  });

  it("keeps the financial activation route settlement-only, even in legacy editor", () => {
    expect(service).toContain('if (action === "prepare_paid_package")');
    expect(service).toContain('if (action === "change_package")');
    expect(service).toContain('"paid_activation_requires_settlement"');
    expect(legacyRoute).toContain('trial_reactivation_requires_review');
    expect(legacyRoute).toContain('trial_package_use_store_control');
    expect(legacyRoute).toContain('paid_plan_change_requires_settlement');
    expect(legacyScreen).toContain('การเปลี่ยนแพ็กเกจ Trial ต้องใช้ ร้านค้า');
    expect(service).toContain('prepaid_trial_contract_protected');
  });
});
