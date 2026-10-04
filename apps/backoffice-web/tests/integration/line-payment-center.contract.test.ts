import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("LINE Payment Center", () => {
  const service = src("src/lib/payments/line-payment-service.ts");
  const slipService = src("src/lib/payments/line-payment-slip-service.ts");
  const slipScanner = src("src/lib/payments/subscription-slip-ai.ts");
  const paymentClient = src("src/components/support/line-payment-client.tsx");
  const paymentAuth = src("src/app/api/support/line/payment/auth/route.ts");
  const generalRoute = src("src/app/api/support/line/payment/general/route.ts");
  const packageRoute = src("src/app/api/support/line/payment/package/route.ts");
  const slipRoute = src("src/app/api/support/line/payment/slip/route.ts");
  const statusRoute = src("src/app/api/support/line/payment/status/route.ts");
  const paymentSettings = src("src/app/api/it-admin/v1/payment-settings/route.ts");
  const itLayout = src("src/app/(it-admin)/layout.tsx");
  const nextConfig = src("next.config.ts");

  it("builds PromptPay QR from IT settings and a server-derived due amount", () => {
    expect(service).toContain("billing_promptpay_id");
    expect(service).toContain("amount_per_cycle");
    expect(service).toContain("contract.ended_at");
    expect(service).toContain("serviceEnd <= today");
    expect(service).toContain("https://promptpay.io/");
    expect(service).toContain('base + ".png"');
    expect(service).toContain('replace(/[^\\d]/g, "")');
  });

  it("does not expose a QR before the current contract reaches its due date", () => {
    expect(service).toContain('["active", "trial"].includes(contract.status)');
    expect(service).toContain("serviceEnd <= today");
    expect(service).toContain("let qrUrl: string | null = null");
    expect(service).toContain("if (account.promptpay_ready && !openRow)");
    expect(paymentClient).toContain("ยังไม่มียอดชำระ");
    expect(paymentClient).toContain("ร้านยังไม่ถึงวันครบกำหนดชำระ");
  });

  it("suppresses a new QR while a payment request is pending review", () => {
    expect(service).toContain('row.status === "pending" || row.status === "under_review"');
    expect(service).toContain("open_request: paymentSummary(openRow)");
    expect(service).toContain("!openRow");
    expect(paymentClient).toContain("ชำระเงินแล้ว · รออนุมัติจากฝ่ายตรวจสอบ");
  });

  it("requires LINE identity for general payment information", () => {
    expect(generalRoute).toContain("verifyLineIdToken");
    expect(generalRoute).toContain("line-payment-general");
    expect(generalRoute).toContain("getPublicPaymentAccount");
  });

  it("reuses the verified LINE/store binding for package payment without opening Support Chat", () => {
    expect(paymentAuth).toContain("findActiveLineSupportBinding");
    expect(paymentAuth).toContain("requestLineSupportOtp");
    expect(paymentAuth).toContain("verifyLineSupportOtp");
    expect(paymentAuth).toContain("establishLineSupportSession");
    expect(paymentAuth).not.toContain("openLineSupportConversation");
    expect(packageRoute).toContain("requireLineSupportSession");
  });

  it("accepts a camera/gallery slip and stores it in the existing payment-review workflow", () => {
    expect(paymentClient).toContain('capture="environment"');
    expect(paymentClient).toContain("ส่งสลิปการชำระเงิน");
    expect(slipRoute).toContain("request.formData()");
    expect(slipRoute).toContain("requireLineSupportSession");
    expect(slipService).toContain('SUBSCRIPTION_SLIP_BUCKET = "subscription-payment-evidence"');
    expect(slipService).toContain("scanSubscriptionSlipFromPrimary");
    expect(slipService).toContain('kind: "payment_notice"');
    expect(slipService).toContain('source: "line_payment_center"');
    expect(slipService).toContain('status: "pending"');
    expect(slipService).toContain("tenant_subscription_payment_requests");
  });

  it("reuses the subscription slip AI checks but keeps IT as the final approver", () => {
    expect(slipScanner).toContain("scanSubscriptionSlipFromPrimary");
    expect(slipScanner).toContain("/api/internal/subscription-slip-scan");
    expect(slipScanner).toContain("CPIPOS_PRODUCTION_URL");
    expect(slipScanner).toContain('update("cpipos:internal-subscription-slip-scan:v1|")');
    expect(paymentClient).toContain("AI ช่วยอ่านสลิปเพื่อคัดกรองเท่านั้น");
    expect(paymentClient).toContain("การอนุมัติสุดท้ายต้องยืนยันเงินเข้าจริงโดยฝ่าย IT");
  });

  it("polls the IT review state and shows approval or rejection in LIFF without LINE push messages", () => {
    expect(statusRoute).toContain("getLinePaymentRequestStatus");
    expect(statusRoute).toContain("requireLineSupportSession");
    expect(paymentClient).toContain('window.setInterval(refresh, 3_000)');
    expect(paymentClient).toContain("อนุมัติการชำระแล้ว");
    expect(paymentClient).toContain("รายการยังไม่ผ่านการตรวจสอบ");
    expect(paymentClient).toContain("หน้านี้จะตรวจสถานะให้อัตโนมัติโดยไม่ใช้โควตาข้อความ LINE");
  });

  it("provides the two requested mobile payment choices", () => {
    expect(paymentClient).toContain("ชำระแพ็กเกจ CpIPOS");
    expect(paymentClient).toContain("ชำระเงินทั่วไป");
    expect(paymentClient).toContain("ตรวจสอบยอดชำระ");
    expect(paymentClient).toContain("บัญชีรับชำระ");
    expect(paymentClient).toContain("QR นี้ล็อกยอดจากระบบ Billing");
  });

  it("adds an IT payment-account settings menu and audited update API", () => {
    expect(itLayout).toContain('paymentSettings: "ตั้งค่าบัญชีชำระเงิน"');
    expect(itLayout).toContain('href: "/it-admin/payment-settings"');
    expect(paymentSettings).toContain("payment_account_settings_updated");
    expect(paymentSettings).toContain("normalizePromptPayId");
    expect(paymentSettings).toContain("billing_bank_account_number");
  });

  it("allows PromptPay QR images from the requested provider", () => {
    expect(nextConfig).toContain('hostname: "promptpay.io"');
  });
});
