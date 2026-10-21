import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const migration=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261021140000_it_custom_settlement_preserve_approved_limits.sql"),"utf8");
const route=readFileSync(resolve(process.cwd(),"src/app/api/it-admin/v1/subscription-payments/settle/[requestId]/route.ts"),"utf8");
describe("settlement uses only signed and approved CUSTOM limits",()=>{
 it("does not escalate tenants to unlimited global CUSTOM quotas at settlement",()=>{
   expect(migration).toContain("CREATE OR REPLACE FUNCTION public.settle_subscription_payment");
   expect(migration).toContain("v_req.metadata->>'source'='it_custom_agreement'");
   expect(migration).toContain("v_req.metadata->'custom_terms_snapshot'");
   expect(migration).toContain("v_approved_terms.approved_at is null");
   expect(migration).toContain("custom_terms_limits_mismatch");
   expect(migration).toContain("custom_terms_price_mismatch");
   expect(migration).toContain("v_effective_max_branches");
   expect(migration).toContain("v_effective_max_devices");
   expect(migration).toContain("v_effective_max_users");
   expect(migration).not.toContain("max_branches = v_package.max_branches");
   expect(migration).not.toContain("max_devices = v_package.max_devices");
   expect(migration).not.toContain("max_users = v_package.max_users");
 });
 it("preserves Optical shift/stock flags when trial converts to an active CUSTOM contract",()=>{
  expect(migration).toContain("coalesce(v_contract.metadata,'{}'::jsonb)");
  expect(migration).toContain("'custom_terms_snapshot',v_terms_snapshot");
  expect(migration).toContain("v_effective_retention_months");
 });
 it("IT receives clear guard errors without pretending settlement succeeded",()=>{
  expect(route).toContain("custom_terms_limits_mismatch");
  expect(route).toContain("custom_terms_price_mismatch");
  expect(route).toContain('if (result.error)');
  expect(route).toContain('supabase.rpc("settle_subscription_payment"');
 });
});
