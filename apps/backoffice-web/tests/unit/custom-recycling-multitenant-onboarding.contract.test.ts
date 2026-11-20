import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getSalesModeSelectionError, normalizeRequestedPosSalesModes } from "@/lib/pos-sales-mode-entitlements";

const src=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");

describe("CUSTOM Recycling is a reusable tenant entitlement, not a one-store code path",()=>{
 const provision=src("src/lib/services/it-admin/custom-sales-mode-provisioning.ts");
 const control=src("src/lib/services/it-admin/tenant-control-service.ts");
 const contract=src("src/app/api/it-admin/admin/tenants/[tenantId]/contract/route.ts");
 const ui=src("src/components/it-admin/tenant-control-center.tsx");

 it("provisions only selected CUSTOM tenant id with standard cashier and recycling stock",()=>{
   expect(provision).toContain("tenantId: string, modes: PosSalesModeMap");
   expect(provision).toContain('"main.sales", "main.more", "more.stock"');
   expect(provision).toContain('"main.settings", "settings.store", "settings.printers"');
   expect(provision).toContain('"core_pos_sales", "stock_management"');
   expect(provision).toContain('"tenant_pos_menu_policies"');
   expect(provision).toContain('"tenant_feature_subscriptions"');
   expect(provision).toContain("ignoreDuplicates:true");
   expect(provision).not.toContain("155858");
   expect(provision).not.toContain("T-2CCCB6BBCE4C");
 });
 it("respects IT denials and audits concrete sales mode grants",()=>{
   expect(provision).toContain("is_enabled === false");
   expect(provision).toContain("custom_mode_dependency_explicitly_disabled");
   expect(control).toContain("ensureCustomSalesModePrerequisites");
   expect(contract).toContain("ensureCustomSalesModePrerequisites");
   expect(control).toContain("provisioned_custom_dependencies");
 });
 it("does not grant Recycling/Optical to fixed price packages",()=>{
   const modes=normalizeRequestedPosSalesModes({recycling:true});
   expect(getSalesModeSelectionError(modes,"starter",{})).toBe("recycling_mode_requires_custom");
   expect(getSalesModeSelectionError(modes,"custom",{})).toBeNull();
   expect(getSalesModeSelectionError(normalizeRequestedPosSalesModes({general_sale:true}),"growth",{})).toBeNull();
   expect(ui).toContain('mode.key !== "recycling" || data.current_package?.code === "custom"');
   expect(contract).toContain("recycling_mode_requires_custom");
 });
});
