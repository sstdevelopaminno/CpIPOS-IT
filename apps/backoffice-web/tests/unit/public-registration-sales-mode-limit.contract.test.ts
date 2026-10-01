import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public registration package sales-mode limits", () => {
  const migration = src("../../supabase/migrations/20261001174500_public_registration_sales_mode_limits.sql");
  const publicApi = src("src/app/api/store-registration/route.ts");
  const manager = src("src/components/it-admin/package-catalog-manager.tsx");
  const service = src("src/lib/services/it-admin/package-admin-service.ts");

  it("sets Starter/Growth/Business limits to 1/2/3", () => {
    expect(migration).toContain("'sales_mode_limit', 1");
    expect(migration).toContain("'sales_mode_limit', 2");
    expect(migration).toContain("'sales_mode_limit', 3");
    expect(migration).toContain("where code = 'starter'");
    expect(migration).toContain("where code = 'growth'");
    expect(migration).toContain("where code = 'business'");
  });

  it("lets IT Admin edit the package limit and clamps the public catalog to supported modes", () => {
    expect(manager).toContain("โหมดขายสูงสุด");
    expect(manager).toContain('update("sales_mode_limit"');
    expect(manager).toContain("sales_mode_limit: custom ? null");
    expect(service).toContain("sales_mode_limit?: number | null");
    expect(service).toContain("metadata.sales_mode_limit");
    expect(service).toContain("Math.min(3");
  });

  it("publishes the limit and rejects registrations that exceed it", () => {
    expect(publicApi).toContain("sales_mode_limit: salesModeLimit");
    expect(publicApi).toContain("sales_mode_limit_exceeded");
    expect(publicApi).toContain("selectedModeCount > salesModeLimit");
    expect(publicApi).toContain('.select("id,code,quota_mode,monthly_price,metadata")');
  });
});
