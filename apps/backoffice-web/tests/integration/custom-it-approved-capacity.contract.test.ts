import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,it,expect} from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261021210000_custom_it_operational_provisioning_limits.sql"),"utf8");
describe("CUSTOM IT-approved store capacity is independent of price approval",()=>{
  it("migration must contain exactly one complete CREATE FUNCTION body (protect dollar-quoted regex)",()=>{
   expect(sql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
   expect(sql.match(/AS \\$function\\$/g)).toHaveLength(1);
   expect(sql.match(/\\n\\$function\\$;/g)).toHaveLength(1);
   expect(sql.match(/-- Trial registrations do not yet/g)).toHaveLength(1);
   expect(sql).toContain("'^[1-9][0-9]*$'");
   expect(sql.match(/custom_provisioning_approval_invalid/g)).toHaveLength(1);
  });

 it("accepts only the exact saved IT terms and preserves previously applied capacity when draft pricing changes",()=>{
  for(const needle of ["it_approved_custom_limits","v_approval->>'terms_version'","v_terms.version","v_terms.max_branches","v_terms.max_devices","v_terms.max_users","v_stored_previous=v_approval","new.max_branches:=","new.max_devices:=","new.max_users:="]){
    expect(sql).toContain(needle);
  }
  expect(sql).toContain("custom_provisioning_approval_does_not_match_it_terms");
  expect(sql).toContain("custom_provisioning_approval_invalid");
  expect(sql).toContain("custom_terms_snapshot");
  expect(sql).toContain("coalesce(v_quota_mode,'standard') <> 'custom'");
 });
 it("IT applies terms to operational contract without price settlement or quota confusion",()=>{
  const it=src("lib/services/it-admin/tenant-control-service.ts");
  expect(it).toContain('action === "apply_custom_provisioning_limits"');
  expect(it).toContain("it_approved_custom_limits:approvedCapacity");
  expect(it).toContain("price_approval:false,subscription_settlement:false");
  const gate=src("lib/feature-gate.ts");
  expect(gate).toContain("const isCustom=String(packageResult.data?.code??\"\").toLowerCase()===\"custom\"");
  expect(gate).toContain("if (branchId && !isCustom)");
  expect(gate).toContain('FeatureGateError("quota_blocked"');
 });
 it("does not grant unrelated tenants unlimited slots",()=>{
  expect(sql).toContain("where tenant_id=new.tenant_id and package_id=new.package_id");
  expect(sql).toContain("if not v_still_same then");
  expect(sql).toContain("new.max_branches := 1");
  expect(sql).toContain("new.max_devices := 1");
  expect(sql).toContain("new.max_users := 1");
 });
});