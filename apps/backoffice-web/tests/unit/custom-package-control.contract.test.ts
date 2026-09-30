import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("CUSTOM package control plane", () => {
  const packageService = src("src/lib/services/it-admin/package-admin-service.ts");
  const tenantService = src("src/lib/services/it-admin/tenant-control-service.ts");
  const tenantUi = src("src/components/it-admin/tenant-control-center.tsx");
  const registrationApi = src("src/app/api/it-admin/v1/store-registrations/route.ts");
  const publicRegistrationApi = src("src/app/api/store-registration/route.ts");
  const migration = src("../../supabase/migrations/20260928210000_custom_package_controls_compat.sql");
  const businessMigration = src("../../supabase/migrations/20260930090000_business_package_catalog.sql");

  it("keeps CUSTOM terms tenant-scoped and lets fixed packages own retention", () => {
    expect(migration).toContain("tenant_custom_package_terms");
    expect(businessMigration).toContain("Starter 6 months, Growth 12 months, Business 24 months");
    expect(businessMigration).toContain("else coalesce(sp.retention_months, 6)");
    expect(packageService).toContain("toNullablePositiveInteger(input.retention_months, 6)");
  });

  it("keeps CUSTOM commercial terms per tenant", () => {
    expect(migration).toContain("tenant_custom_package_terms");
    expect(tenantService).toContain('action === "update_custom_package_terms"');
    expect(tenantService).toContain('action === "approve_custom_package_request"');
    expect(tenantService).toContain("custom_terms_snapshot");
  });

  it("adds the clean custom-package submenu in the tenant popup", () => {
    expect(tenantUi).toContain('"customPackage"');
    expect(tenantUi).toContain("กำหนดรายละเอียดแพ็กเกจ");
    expect(tenantUi).toContain("อนุมัติและส่งยอดให้ POS");
  });

  it("allows IT package pricing, discounts and safe deletion", () => {
    expect(packageService).toContain("monthly_discount_percent");
    expect(packageService).toContain("yearly_discount_percent");
    expect(packageService).toContain("it_delete_subscription_package_safe");
  });

  it("accepts website CUSTOM requests but requires IT-reviewed terms before activation", () => {
    expect(publicRegistrationApi).toContain("custom_requirements");
    expect(publicRegistrationApi).toContain('quota_mode", ["standard","custom"]');
    expect(registrationApi).toContain("sanitizeCustomTerms");
    expect(registrationApi).toContain("tenant_custom_package_terms");
    expect(registrationApi).toContain("custom_terms: approvedCustomTerms");
  });
});
