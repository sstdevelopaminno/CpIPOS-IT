import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {CRM_MENU_CATALOG,isCrmMenuEnabled,isValidCrmMenuKey} from "../../src/lib/crm-menu-policy";
import {POS_MENU_CATALOG} from "../../src/lib/pos-menu-policy";

const read=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
const api=read("../../src/app/api/it-admin/v1/tenants/[tenantId]/crm-menu-policies/route.ts");
const card=read("../../src/components/it-admin/tenant-control-center.tsx");
const ui=read("../../src/components/it-admin/tenant-crm-menu-policies.tsx");

describe("IT CRM tenant main and submenu switches",()=>{
 it("keeps all CRM keys unique, namespaced, and separate from POS",()=>{
  const keys=CRM_MENU_CATALOG.map(x=>x.key);
  expect(keys).toHaveLength(41);
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.every(key=>/^(main|more|settings)\.crm_[a-z_]+$/.test(key))).toBe(true);
  expect(keys.every(key=>!POS_MENU_CATALOG.some(pos=>pos.key===key))).toBe(true);
  expect(keys.every(isValidCrmMenuKey)).toBe(true);
  expect(isValidCrmMenuKey("settings.store")).toBe(false);
  expect(isValidCrmMenuKey("main.fake_menu")).toBe(false);
  for(const key of [
    "settings.crm_optical_api_work_orders",
    "settings.crm_optical_api_deposits",
    "settings.crm_optical_api_inventory",
    "settings.crm_optical_api_customers",
    "settings.crm_optical_api_payment_verification"
  ])expect(isValidCrmMenuKey(key)).toBe(true);
 });
 it("defaults to visible for legacy tenants; parent OFF masks child without changing its setting",()=>{
  for(const m of CRM_MENU_CATALOG)expect(isCrmMenuEnabled(m.key,{})).toBe(true);
  expect(isCrmMenuEnabled("settings.crm_branding",{"main.crm_settings":false,"settings.crm_branding":true})).toBe(false);
  expect(isCrmMenuEnabled("settings.crm_branding",{"main.crm_settings":true,"settings.crm_branding":true})).toBe(true);
  expect(isCrmMenuEnabled("main.crm_sales",{"main.crm_settings":false})).toBe(true);
  expect(isCrmMenuEnabled("main.unknown",{})).toBe(false);
  expect(isCrmMenuEnabled("settings.crm_optical_api_deposits",
    {"settings.crm_optical_api_deposits":false})).toBe(false);
  // API kill switches are independent from CRM navigation parent switches.
  expect(isCrmMenuEnabled("settings.crm_optical_api_deposits",
    {"main.crm_optical":false})).toBe(true);
 });
 it("exposes a distinct tenant card and IT-only audited CRM policy writes",()=>{
  expect(card).toContain('setTab("crmMenus")');
  expect(card).toContain('<TenantCrmMenuPolicies tenantId={tenantId} storeName={storeName}');
  expect(ui).toContain('role="switch"');
  expect(ui).toContain('group==="optical_api"');
  expect(ui).toContain('IT ปิด POS Optical API');
  expect(ui).toContain("isCrmMenuEnabled(item.key,data.overrides)");
  expect(api).toContain("requireItAdmin()");
  expect(api).toContain("isValidCrmMenuKey(key)");
  expect(api).toContain('.eq("tenant_id",tenantId)');
  expect(api).toContain("onConflict:\"tenant_id,menu_key\"");
  expect(api).toContain("appendAuditLog");
  expect(api).toContain("tenant_pos_menu_policies");
  expect(api).not.toContain("subscription_contracts");
 });
});
