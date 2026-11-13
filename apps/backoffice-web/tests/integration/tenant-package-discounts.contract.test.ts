import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src=(file:string)=>readFileSync(resolve(process.cwd(),file),"utf8");
const migration=src("../../supabase/migrations/20261113190000_tenant_package_discounts.sql");
const ui=src("src/components/it-admin/tenant-discount-manager.tsx");
const tenantControl=src("src/components/it-admin/tenant-control-center.tsx");
const api=src("src/app/api/it-admin/v1/tenants/[tenantId]/discounts/route.ts");
const itBilling=src("src/lib/services/it-admin/tenant-control-service.ts");

describe("tenant package discounts: IT financial safety contract",()=>{
  it("requires privileged IT access, validates dates, and audits changes",()=>{
    expect(api).toContain("requireItAdmin()");
    expect(api).toContain("readBoundedJson");
    expect(api).toContain("retroactive_discount_blocked");
    expect(api).toContain("tenant_package_discount_created");
    expect(api).toContain("tenant_package_discount_cancelled");
    expect(api).toContain("appendAuditLog");
    expect(api).not.toContain("getSupabaseBrowserClient");
  });

  it("keeps discounts scoped, dated and non-overlapping",()=>{
    expect(migration).toContain("references public.tenants(id) on delete cascade");
    expect(migration).toContain("valid_from date not null");
    expect(migration).toContain("valid_until date not null");
    expect(migration).toContain("tenant_package_discount_no_overlap exclude");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.tenant_package_discounts from anon,authenticated");
    expect(migration).toContain("grant execute on function public.tenant_discount_quote");
  });

  it("prices canonical unpaid cycles only and preserves settled financial history",()=>{
    expect(migration).toContain("tenant_discount_before_billing_cycle");
    expect(migration).toContain("new.status in ('paid','cancelled')");
    expect(migration).toContain("tenant_subscription_settlements");
    expect(migration).toContain("preserve_contract_base_price_for_promotion");
    expect(migration).toContain("new.amount_per_cycle:=v_base");
    expect(migration).not.toContain("delete from public.tenant_subscription_settlements");
    expect(migration).not.toContain("update public.tenant_subscription_receipts");
  });

  it("puts time-based approval in the per-store package entitlement section",()=>{
    expect(tenantControl).toContain("<TenantDiscountManager tenantId={tenantId} />");
    expect(ui).toContain("กำหนดส่วนลดแพ็กเกจของร้านค้า");
    expect(ui).toContain("วันสิ้นสุด");
    expect(ui).toContain("ส่วนลด (%)");
    expect(ui).toContain("onClick={()=>void cancel(d)}");
    expect(itBilling).toContain('rpc("tenant_discount_quote"');
  });
});