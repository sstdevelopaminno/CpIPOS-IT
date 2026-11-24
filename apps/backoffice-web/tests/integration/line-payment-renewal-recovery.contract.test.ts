import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), "src", path), "utf8");

describe("LINE package payments: recover exact pending standard renewal without bypassing CUSTOM", () => {
 const snapshot = source("lib/payments/line-payment-service.ts");
 const slip = source("lib/payments/line-payment-slip-service.ts");
 const auth = source("app/api/support/line/payment/auth/route.ts");
 const admin = source("lib/services/it-admin/tenant-control-service.ts");
 it("reuses only a pending standard POS renewal for the matching canonical billing cycle", () => {
   expect(snapshot).toContain('packageRow.code!=="custom"');
   expect(snapshot).toContain('rawDue.package_id===packageId');
   expect(snapshot).toContain('rawDue.open_request_id===openRow.id');
   expect(snapshot).toContain('rawDue.open_request_status==="pending"');
   expect(snapshot).toContain('openRow.metadata?.kind==="renewal_intent"');
   expect(snapshot).toContain('openRow.metadata?.source==="pos_subscription_center"');
   expect(snapshot).toContain('openRow.requested_package_id===packageId');
   expect(snapshot).toContain('Number(openRow.metadata?.expected_amount)===outstanding');
   expect(snapshot).toContain('!supportRequired');
   expect(snapshot).toContain('canAttachEvidence=prepared||payableRenewalIntent');
 });
 it("uploads to the same request once and never creates an arbitrary duplicate or pays an unapproved custom quote", () => {
   expect(slip).toContain('snapshot.package.code!=="custom"');
   expect(slip).toContain('snapshot.open_request?.id===open.data.id');
   expect(slip).toContain('snapshot.open_request?.can_attach_evidence===true');
   expect(slip).toContain('Number(open.data.metadata?.expected_amount)===snapshot.due.outstanding_amount');
   expect(slip).toContain('open.data.metadata?.kind==="renewal_intent"');
   expect(slip).toContain('if(open.data?.metadata?.kind==="custom_quote_request")');
   expect(slip).toContain('throw new LinePaymentSlipError("custom_quote_not_approved"');
   expect(slip).toContain('(prepared || renewalIntent) ? open.data!.id : crypto.randomUUID()');
   expect(slip).toContain('.contains("metadata",{kind:renewalIntent?"renewal_intent":"payment_notice"})');
   expect(slip).toContain('upgraded_from_renewal_intent:true');
   expect(slip).toContain('"it_custom_agreement":"it_tenant_control"');
   expect(slip).toContain('status:"pending"');
 });
 it("never hides a missing Support OTP sender behind a generic LINE credential error", () => {
   expect(auth).toContain('error instanceof SupportMailBridgeError');
   expect(auth).toContain('line_payment_otp_mail_unavailable');
   expect(auth).toContain('if (rate.source === "backend_unavailable")');
   expect(auth).toContain('payment_rate_limit_service_unavailable');
   expect(auth).toContain('requestLineSupportOtp(identity, store)');
   expect(auth).toContain('verifyLineSupportOtp');
 });
 it("keeps CUSTOM price changes under explicit IT review, not auto-approval", () => {
   expect(admin).toContain('if (action === "approve_custom_package_request")');
   expect(admin).toContain('kind: "payment_notice"');
   expect(admin).toContain('custom_terms_snapshot: snapshot');
   expect(snapshot).toContain('openRow.metadata?.source==="it_custom_agreement"');
 });
});
