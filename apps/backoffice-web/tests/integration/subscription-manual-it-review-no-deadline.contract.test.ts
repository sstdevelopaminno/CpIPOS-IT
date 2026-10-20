import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const read=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");
describe("POS and LINE verified payment lifecycle",()=>{
 const sql=read("../../supabase/migrations/20261020234500_subscription_it_manual_review_without_timeout.sql");
 const line=read("src/lib/payments/line-payment-slip-service.ts");
 const review=read("src/app/api/it-admin/v1/subscription-payments/review/[requestId]/route.ts");
 it("does not revoke reviewed payments after three days but keeps IT rejection",()=>{
  expect(sql).toContain("CREATE OR REPLACE FUNCTION app.refresh_subscription_billing_lifecycle");
  expect(sql).not.toContain("perform app.revoke_provisional_subscription_access");
  expect(sql).toContain("r.auto_check_status='passed'");
  expect(sql).toContain("provisional_access_expires_at=null");
  expect(sql).toContain("transfer_datetime_out_of_range");
  expect(sql).toContain("transfer_datetime_invalid");
  expect(sql).toContain("'subscription_payment_provisional_review'");
  expect(sql).toContain("subscription_payment_rejected");
 });
 it("does not accept mock slips and treats IT bank review as permanent decision",()=>{
  expect(line).toContain('scan.model !== "mock"');
  expect(line).toContain('rpc("grant_provisional_subscription_access"');
  expect(line).toContain('request.data.auto_check_status==="passed"');
  expect(line).not.toContain('Date.parse(request.data.provisional_access_expires_at)>Date.now()');
  expect(review).toContain('action==="reject"');
  expect(review).toContain("reopening");
  expect(review).toContain("Another open payment request exists.");
  expect(review).toContain("POS remains locked until a bank settlement is confirmed.");
 });
});
