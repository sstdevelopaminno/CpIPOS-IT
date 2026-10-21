import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
const featureGate=read("../../src/lib/feature-gate.ts");
const branchApi=read("../../src/app/api/it-admin/admin/tenants/[tenantId]/branches/route.ts");
const userApi=read("../../src/app/api/it-admin/admin/tenants/[tenantId]/users/route.ts");
const deviceApi=read("../../src/app/api/it-admin/admin/tenants/[tenantId]/devices/route.ts");

describe("IT-authorized Optical CUSTOM management access",()=>{
 it("mirrors POS opt-in rules and never bypasses explicit feature denial",()=>{
  expect(featureGate).toContain('featureCode === "user_management" ? "settings.users"');
  expect(featureGate).toContain('featureCode === "branch_management" ? "settings.branches"');
  expect(featureGate).toContain('optical_retail === true');
  expect(featureGate).toContain('!tenantOverride && !branchOverride && opticalManagementMenu && opticalRetail');
  expect(featureGate).toContain('.eq("menu_key", opticalManagementMenu)');
  expect(featureGate).toContain('toLowerCase() === "custom"');
  expect(featureGate).toContain('menuResult.data?.is_enabled === true');
 });
 it("IT retains its existing admin guards and checks negotiated resource quotas",()=>{
  expect(branchApi).toContain('requireTenantFeature(tenantId, "branch_management")');
  expect(branchApi).toContain('enforceQuota(tenantId, "branches")');
  expect(userApi).toContain('requireTenantFeature(tenantId, "user_management")');
  expect(userApi).toContain('enforceQuota(tenantId, "users")');
  expect(deviceApi).toContain('enforceQuota(tenantId, "devices"');
  expect(featureGate).toContain('Device quota exceeded');
  expect(featureGate).toContain('isCustom');
  expect(featureGate).toContain('limits.usage.users >= limits.maxUsers');
 });
});
