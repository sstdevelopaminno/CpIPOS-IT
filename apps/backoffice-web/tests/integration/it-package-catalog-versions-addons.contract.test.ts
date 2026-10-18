import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(),path),"utf8");
const versionRoute=read("src/app/api/it-admin/v1/packages/versions/route.ts");
const addonRoute=read("src/app/api/it-admin/v1/tenants/[tenantId]/addon-proposals/route.ts");
const versionPage=read("src/app/(it-admin)/it-admin/packages/versions/page.tsx");
const addonPage=read("src/app/(it-admin)/it-admin/tenants/[tenantId]/addons/page.tsx");
const packageUi=read("src/components/it-admin/package-catalog-manager.tsx");
const tenantUi=read("src/components/it-admin/tenant-control-center.tsx");
const migration=read("../../supabase/migrations/20261018180000_package_catalog_versions_tenant_addon_proposals.sql");

describe("Catalog versions and Add-on proposals",()=>{
 it("provides additive, RLS-protected tables without mutating financial or active contract rows",()=>{
  expect(migration).toContain("create table if not exists public.it_package_catalog_versions");
  expect(migration).toContain("create table if not exists public.it_tenant_addon_proposals");
  expect(migration).toContain("enable row level security");
  expect(migration).toContain("revoke all on table public.it_tenant_addon_proposals from anon,authenticated");
  expect(migration).not.toMatch(/(?:update|delete from|truncate|alter table)\s+public\.(tenant_subscription_contracts|subscription_packages|tenant_feature_subscriptions)/i);
 });
 it("protects catalog modifications with IT Admin identity, version isolation and audit",()=>{
  expect(versionRoute).toContain("await requireItAdmin()");
  expect(versionRoute).toContain('onlyAdmin(admin.profile.platform_role)');
  expect(versionRoute).toContain("it_package_catalog_versions");
  expect(versionRoute).toContain("catalog_version_drafted");
  expect(versionRoute).toContain("catalog_version_approved");
  expect(versionRoute).toContain('state: "draft"');
  expect(versionRoute).toContain("no_live_package_change: true");
  expect(versionRoute).not.toContain('.from("tenant_subscription_contracts")');
  expect(versionRoute).not.toContain('.from("tenant_feature_subscriptions")');
 });
 it("requires valid future date, prices, packages and usage quotas before creating a version",()=>{
  expect(versionRoute).toContain("start.getTime() <= Date.now()");
  expect(versionRoute).toContain('quota_mode !== "standard"');
  expect(versionRoute).toContain("positiveInteger");
  expect(versionRoute).toContain("monthly_price_required");
  expect(versionPage).toContain("บันทึก Draft ราคา/โควตาใหม่");
 });
 it("requires matching tenant and current contract for Add-on proposals",()=>{
  expect(addonRoute).toContain('eq("tenant_id", tenantId)');
  expect(addonRoute).toContain('eq("tenant_id",tenantId)');
  expect(addonRoute).toContain('["trial","active"].includes(contract.data.status)');
  expect(addonRoute).toContain("protected_feature");
  expect(addonRoute).toContain("feature_not_available");
  expect(addonRoute).toContain("it_addon_quote_approved");
  expect(addonRoute).toContain("no_entitlement: true");
  expect(addonRoute).toContain("contract_currency: contract.data?.currency ?? null");
  expect(addonPage).toContain('data?.contract_currency==="THB"');
  expect(addonPage).toContain("LAK/USD ต้องกำหนดราคาเอง");
  expect(addonRoute).not.toContain('.from("tenant_feature_subscriptions")');
  expect(addonRoute).not.toContain('.from("tenant_billing_cycles")');
 });
 it("provides discoverable controls for standard and CUSTOM tenants",()=>{
  expect(packageUi).toContain("/it-admin/packages/versions");
  expect(tenantUi).toContain("/addons");
  expect(addonPage).toContain("บันทึกข้อเสนอ Add-on");
  expect(addonPage).toContain("อนุมัติข้อเสนอ");
 });
});