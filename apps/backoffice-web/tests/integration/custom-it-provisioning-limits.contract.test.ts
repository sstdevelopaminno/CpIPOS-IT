import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const service=readFileSync(resolve(process.cwd(),"src/lib/services/it-admin/tenant-control-service.ts"),"utf8");
const ui=readFileSync(resolve(process.cwd(),"src/components/it-admin/tenant-control-center.tsx"),"utf8");
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261021141500_custom_explicit_it_provisioning_limits.sql"),"utf8");
describe("IT CUSTOM live capacity independent from unpaid draft pricing",()=>{
 it("only current active/trial CUSTOM contract can receive saved IT capacity",()=>{
  expect(service).toContain('action === "apply_custom_provisioning_limits"');
  expect(service).toContain('pkg.data?.code!=="custom"');
  expect(service).toContain('["active","trial"].includes(contract.status)');
  expect(service).toContain('it_approved_custom_limits:approvedCapacity');
  expect(service).toContain('version:limits.version');
  expect(service).toContain("custom_provisioning_limits_applied");
  expect(service).toContain("price_approval:false,subscription_settlement:false");
 });
 it("requires quota at least usage and is separate from billing settlement",()=>{
  expect(service).toContain('limits.max_branches<Number(branches.count??0)');
  expect(service).toContain('limits.max_devices<Number(devices.count??0)');
  expect(service).toContain('limits.max_users<userCount');
  expect(service).toContain('updated.data.max_branches!==limits.max_branches');
  expect(ui).toContain('action:"apply_custom_provisioning_limits"');
  expect(ui).toContain('data.current_package?.code === "custom" && customTerms');
  expect(ui).toContain("โควตาปัจจุบันที่ POS ตรวจจริง");
  expect(ui).toContain("ไม่อนุมัติราคา");
 });
 it("DB trigger prefers settled invoice snapshot then explicit IT capacity then approved terms",()=>{
  expect(sql).toContain("v_explicit_limits :=coalesce(new.metadata,'{}'::jsonb)->'it_approved_custom_limits'");
  expect(sql.indexOf("v_explicit_limits :=")).toBeGreaterThan(sql.indexOf("if v_snapshot is not null"));
  expect(sql.indexOf("v_explicit_limits :=")).toBeLessThan(sql.indexOf("status in ('approved','active')"));
  expect(sql).toContain('it_custom_capacity_authorization_invalid');
  expect(sql.split("CREATE OR REPLACE FUNCTION").length).toBe(2);
  expect(sql.split("$function$").length).toBe(3);
  expect(sql.trimEnd().endsWith("$function$;")).toBe(true);
  expect(sql).not.toContain("$function$\\n\\n       or");
  expect(sql).toContain('new.max_branches := (v_explicit_limits');
  expect(sql).toContain('new.max_devices := (v_explicit_limits');
  expect(sql).toContain('new.max_users := (v_explicit_limits');
  expect(sql).toContain('new.branch_limit := new.max_branches');
 });
});