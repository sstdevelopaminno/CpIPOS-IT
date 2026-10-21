import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {describe,expect,it} from "vitest";

const src=(path:string)=>readFileSync(resolve(process.cwd(),"src",path),"utf8");
const sql=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261021123000_subscription_due_state_manual_review_no_timeout.sql"),"utf8");

describe("CUSTOM quote vs POS/LINE verified payment",()=>{
 it("IT history preserves CUSTOM quote kind and shows dedicated terms-approval workflow",()=>{
  const route=src("app/api/it-admin/v1/subscription-payments/history/[tenantId]/route.ts");
  const ui=src("components/it-admin/subscription-payment-history.tsx");
  expect(route).toContain('info.kind === "custom_quote_request" ? "custom_quote_request"');
  expect(ui).toContain('row.kind==="custom_quote_request"');
  expect(ui).toContain('data-testid="it-custom-quote-awaiting-terms"');
  expect(ui).toContain('href="/it-admin/tenants"');
  expect(ui).toContain('อนุมัติและส่งยอดให้ POS');
  expect(ui).not.toContain('ล็อกอัตโนมัติหลัง 3 วัน');
 });
 it("IT must not reject a price request using payment rejection that locks POS",()=>{
  const review=src("app/api/it-admin/v1/subscription-payments/review/[requestId]/route.ts");
  expect(review).toContain('previous.metadata?.kind==="custom_quote_request"');
  expect(review).toContain('custom_quote_not_a_payment');
  expect(review).toContain('return fail("custom_quote_not_a_payment"');
 });
 it("LINE rejects a price request and permits only the exact priced IT-CUSTOM invoice",()=>{
  const service=src("lib/payments/line-payment-service.ts");
  const upload=src("lib/payments/line-payment-slip-service.ts");
  const ui=src("components/support/line-payment-client.tsx");
  expect(service).toContain('row.metadata?.kind==="custom_quote_request"');
  expect(service).toContain('openRow.metadata?.source==="it_custom_agreement"');
  expect(service).toContain('rawDue.open_request_id===openRow.id');
  expect(service).toContain('outstanding>0');
  expect(upload).toContain('open.data?.metadata?.kind==="custom_quote_request"');
  expect(upload).toContain('custom_quote_not_approved');
  expect(upload).toContain('snapshot.open_request?.can_attach_evidence===true');
  expect(ui).toContain('paymentRequest.kind === "custom_quote_request"');
  expect(ui).toContain('รอฝ่าย IT ยืนยันราคา CUSTOM');
  expect(ui).toContain('กรุณาอย่าโอนเงินก่อนเห็นยอดชำระ');
 });
 it("billing runtime does not confuse no-expiry OCR grant with overdue review deadline",()=>{
  expect(sql).toContain("v_request.auto_check_status='passed'");
  expect(sql).toContain("v_request.provisional_access_revoked_at is null");
  expect(sql).toContain("not coalesce(v_lifecycle.access_locked,false)");
  expect(sql).not.toContain('v_request.provisional_access_expires_at<=v_now');
  expect(sql).toContain("if v_support then");
 });
});
