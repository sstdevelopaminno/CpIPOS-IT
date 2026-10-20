import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const migration=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261020234500_subscription_it_manual_review_without_timeout.sql"),"utf8");
const src=(p:string)=>readFileSync(resolve(process.cwd(),"src",p),"utf8");
describe("POS + LINE verified subscription payment while IT review pending",()=>{
 it("validates transfer timestamp and exact bill before provisional activation",()=>{
  expect(migration).toContain("transfer_datetime_out_of_range");
  expect(migration).toContain("verified_amount_mismatch");
  expect(migration).toContain("slip_reference_already_used");
  expect(migration).toContain("payee_match");
  expect(migration).toContain("confidence_pass");
  expect(migration).toContain("provisional_access_expires_at=null");
  expect(migration).toContain("grace_until=null");
 });
 it("never locks a verified slip due solely to an IT review deadline",()=>{
  expect(migration).not.toContain("perform app.revoke_provisional_subscription_access(");
  expect(migration).not.toContain("provisional_access_expires_at>p_as_of");
  expect(migration).toContain("and r.auto_check_status='passed'");
  expect(migration).toContain("l.lock_reason");
  expect(migration).toContain("subscription_payment_rejected");
 });
 it("lets LINE reuse an IT-prepared unpaid invoice without duplicate billing",()=>{
  const service=src("lib/payments/line-payment-slip-service.ts");
  const snap=src("lib/payments/line-payment-service.ts");
  expect(service).toContain("requestId = prepared ?");
  expect(service).toContain("open.data.metadata?.source===\"it_tenant_control\"");
  expect(service).toContain('.eq("tenant_id",input.session.tenantId)');
  expect(service).toContain('.is("evidence_url",null).is("amount_reported",null)');
  expect(service).toContain('scan.model !== "mock"');
  expect(snap).toContain("can_attach_evidence:prepared");
 });
 it("keeps IT rejection flow and customer runtime lock",()=>{
  const review=src("app/api/it-admin/v1/subscription-payments/review/[requestId]/route.ts");
  expect(review).toContain('action!=="under_review" && action!=="reject"');
  expect(review).toContain('status,reviewed_by:auth.userId');
  expect(migration).toContain("subscription_payment_rejected");
 });
});
