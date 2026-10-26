import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT tenant POS sales-mode control", () => {
  const contractApi = src("src/app/api/it-admin/admin/tenants/[tenantId]/contract/route.ts");
  const consoleUi = src("src/components/it-admin/tenant-section-console.tsx");
  const menuApi = src("src/app/api/it-admin/v1/tenants/[tenantId]/pos-menu-policies/route.ts");

  it("persists tenant sales modes in the canonical subscription contract metadata", () => {
    expect(contractApi).toContain("sales_modes?: Partial<Record<PosSalesModeKey, boolean>> | null");
    expect(contractApi).toContain('metadata.sales_modes = Object.fromEntries');
    expect(contractApi).toContain('delete metadata.sales_modes');
    expect(contractApi).toContain("POS_SALES_MODE_KEYS.map");
    expect(contractApi).toContain("sales_mode_limit_exceeded");
    expect(contractApi).toContain("enabledCount > salesModeLimit");
  });

  it("clears stale sales-mode overrides when the package changes without an explicit replacement", () => {
    expect(contractApi).toContain("latestContract.package_id !== patch.package_id");
    expect(contractApi).toContain("!hasSalesModesField");
    expect(contractApi).toContain("new package's default_sales_modes");
  });

  it("exposes explicit sales-mode controls and package reset in IT Admin", () => {
    expect(consoleUi).toContain("POS Sales Modes");
    expect(consoleUi).toContain("บันทึกโหมดขาย");
    expect(consoleUi).toContain("ใช้ค่าเริ่มต้นของแพ็กเกจ");
    expect(consoleUi).toContain("เมนู “หน้าขาย” และ Sales Mode เป็นคนละสิทธิ์กัน");
    expect(consoleUi).toContain("sales_mode_limit");
  });

  it("shows the same effective mode limit beside the IT menu that CpIPOS enforces", () => {
    expect(menuApi).toContain("rawSalesModeLimit");
    expect(menuApi).toContain("enabledKeys.length > salesModeLimit");
    expect(menuApi).toContain("sales_modes: effectiveSalesModes");
    expect(menuApi).toContain('"package_default"');
  });
});
