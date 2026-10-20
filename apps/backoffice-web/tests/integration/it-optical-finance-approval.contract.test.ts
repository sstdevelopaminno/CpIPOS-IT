import {readFileSync} from "node:fs";
import {describe,it,expect} from "vitest";
const read=(p:string)=>readFileSync(new URL("../../src/"+p,import.meta.url),"utf8");
describe("IT Optical finance approval is tenant-scoped and separate from global finance rollout",()=>{
 it("rejects unapproved CUSTOM Optical and requires explicit admin and scoped Audit",()=>{
  const api=read("app/api/it-admin/v1/tenants/[tenantId]/optical-finance-approval/route.ts");
  expect(api).toContain("requireItAdmin()");
  expect(api).toContain("access_locked");
  expect(api).toContain("trial_expires_at");
  expect(api).toContain("optical_retail");
  expect(api).toContain('"custom"');
  expect(api).toContain("OPTICAL");
  expect(api).toContain("appendAuditLog");
  expect(api).toContain("updated_at");
  expect(api).toContain("optical_deposit");
  expect(api).toContain("work_orders_approval_required");
  expect(api).not.toContain('OPTICAL_FINANCE_V1_ENABLED: "true"');
 });
 it("exposes approval button in tenant console without auto-enabling Vercel production",()=>{
  const card=read("components/it-admin/optical-finance-approval-card.tsx");
  const console=read("components/it-admin/tenant-control-center.tsx");
  const sections=read("components/it-admin/tenant-section-console.tsx");
  expect(card).toContain("กดอนุมัติ");
  expect(card).toContain("OPTICAL_FINANCE_V1_ENABLED=true");
  expect(console).toContain("features#optical-finance-approval");
  expect(sections).toContain("OpticalFinanceApprovalCard");
 });
});
