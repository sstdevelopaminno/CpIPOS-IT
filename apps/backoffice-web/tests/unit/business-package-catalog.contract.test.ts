import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT Business package control plane", () => {
  const migration = src("../../supabase/migrations/20260930090000_business_package_catalog.sql");
  const manager = src("src/components/it-admin/package-catalog-manager.tsx");
  const service = src("src/lib/services/it-admin/package-admin-service.ts");
  const navigation = src("src/app/(it-admin)/layout.tsx");
  const catalog = src("src/lib/subscription-catalog.ts");
  const shared = src("../../packages/shared-types/src/index.ts");
  const aiAdmin = src("src/lib/services/it-admin/cpipos-ai-admin-service.ts");

  it("makes Business a canonical 1,500 THB package with annual 10% discount", () => {
    expect(migration).toContain("monthly_price = 1500");
    expect(migration).toContain("yearly_price = 16200");
    expect(migration).toContain("'yearly_list_price', 18000");
    expect(migration).toContain("'annual_discount_percent', 10");
    expect(migration).toContain("display_order = 3");
    expect(catalog).toContain('code: "business"');
    expect(catalog).not.toContain('code: "enterprise"');
  });

  it("records Business limits, all sales modes and AI quota", () => {
    expect(migration).toContain("max_branches = 2");
    expect(migration).toContain("max_devices = 4");
    expect(migration).toContain("max_users = 20");
    expect(migration).toContain("max_products = 5000");
    expect(migration).toContain("monthly_bill_limit = 10000");
    expect(migration).toContain("retention_months = 24");
    expect(migration).toContain("'sales_mode_limit', 5");
    expect(migration).toContain("'ai_monthly_requests', 2000");
    expect(shared).toContain('| "cpipos_ai"');
  });

  it("shows package management to IT Admin and surfaces AI/sales-mode policy", () => {
    expect(navigation).toContain('{ href: "/it-admin/packages", label: text.items.packages');
    expect(manager).toContain("Starter · Growth · Business · CUSTOM");
    expect(manager).toContain("AI / โหมดขาย");
    expect(manager).toContain('metaBoolean(row,"ai_included")');
    expect(manager).toContain("AI Quota");
    expect(aiAdmin).toContain("syncPackageAiFeature");
    expect(aiAdmin).toContain("syncTenantAiFeatureOverride");
    expect(aiAdmin).toContain('"cpipos_ai"');
  });

  it("allows package-specific retention instead of the retired global six-month rule", () => {
    expect(service).toContain("toNullablePositiveInteger(input.retention_months, 6)");
    expect(service).toContain('["starter","growth","business","custom"]');
    expect(manager).toContain("Sales Retention (เดือน)");
    expect(migration).toContain("else coalesce(sp.retention_months, 6)");
  });
});
