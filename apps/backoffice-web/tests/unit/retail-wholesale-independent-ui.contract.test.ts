import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const read=(p:string)=>readFileSync(new URL("../../src/"+p,import.meta.url),"utf8");
describe("RW independent IT control",()=>{
  it("allows SD off in both editors and persists canonical contract metadata",()=>{
    for(const p of ["components/it-admin/tenant-control-center.tsx","components/it-admin/tenant-section-console.tsx"]){
      const ui=read(p);
      expect(ui).toContain("{ general_sale: false }");
      expect(ui).not.toContain("&& salesModeDrafts.retail_wholesale} onChange");
      expect(ui).not.toContain("{ general_sale: true } : {})");
    }
    expect(read("app/api/it-admin/admin/tenants/[tenantId]/contract/route.ts")).toContain("metadata.sales_modes = normalizeRequestedPosSalesModes(raw)");
    expect(read("lib/services/it-admin/tenant-control-service.ts")).toContain("sales_modes: nextModes");
    expect(read("lib/services/it-admin/custom-sales-mode-provisioning.ts")).toContain("|| modes.retail_wholesale");
  });
});
