import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_POS_SALES_MODES, normalizePosSalesModes, POS_SALES_MODE_KEYS } from "../../src/lib/pos-sales-modes";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT internal QA permissions and Optical gating", () => {
  it("allows only authenticated IT staff on the verified internal store", () => {
    const service = source("src/lib/services/it-admin/tenant-control-service.ts");
    const guard = source("src/lib/server/internal-it-test-store.ts");
    expect(service).toContain('["it_admin", "it_support"].includes');
    expect(service).toContain("getItQaMode(context, tenantId)");
    expect(guard).toContain('tenant.data?.code !== "NDL-TH-001"');
    expect(guard).toContain('access.data?.access_code!=="900001"');
    expect(service).toContain('audit(context, tenantId, "internal_test_mode_changed"');
    expect(service).toContain('"internal_test_package_changed"');
  });
  it("optical is disabled by default and only available for CUSTOM/verified IT", () => {
    expect(POS_SALES_MODE_KEYS).toContain("optical_retail");
    expect(DEFAULT_POS_SALES_MODES.optical_retail).toBe(false);
    expect(normalizePosSalesModes({optical_retail:true}).optical_retail).toBe(true);
    const service = source("src/lib/services/it-admin/tenant-control-service.ts");
    expect(service).toContain('"optical_custom_only"');
    const ui = source("src/components/it-admin/tenant-control-center.tsx");
    expect(ui).toContain('mode.key !== "optical_retail"');
  });
});
