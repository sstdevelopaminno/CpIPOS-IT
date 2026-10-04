import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("LINE Payment Center", () => {
  const service = src("src/lib/payments/line-payment-service.ts");
  const paymentClient = src("src/components/support/line-payment-client.tsx");
  const paymentAuth = src("src/app/api/support/line/payment/auth/route.ts");
  const generalRoute = src("src/app/api/support/line/payment/general/route.ts");
  const packageRoute = src("src/app/api/support/line/payment/package/route.ts");
  const paymentSettings = src("src/app/api/it-admin/v1/payment-settings/route.ts");
  const itLayout = src("src/app/(it-admin)/layout.tsx");
  const nextConfig = src("next.config.ts");

  it("builds PromptPay QR from IT settings and the outstanding billing amount", () => {
    expect(service).toContain("billing_promptpay_id");
    expect(service).toContain("amount_due");
    expect(service).toContain("amount_paid");
    expect(service).toContain("Math.max(0, amountDue - amountPaid)");
    expect(service).toContain("https://promptpay.io/");
    expect(service).toContain('base + ".png"');
  });

  it("never creates a package QR from contract price alone", () => {
    expect(service).toContain("const dueCycle = cycles.find");
    expect(service).toContain('cycle.status !== "paid"');
    expect(service).toContain("cycle.period_start <= today");
    expect(service).toContain("if (dueCycle)");
    expect(service).not.toContain("buildPromptPayUrls(account.promptpay_id, Number(contract");
  });

  it("returns no QR when there is no due billing cycle or PromptPay is not configured", () => {
    expect(service).toContain("due: LinePackagePaymentSnapshot");
    expect(service).toContain("let qrUrl: string | null = null");
    expect(service).toContain("if (account.promptpay_ready)");
    expect(paymentClient).toContain("ยังไม่มียอดชำระ");
    expect(paymentClient).toContain("ยังไม่ได้ตั้งค่าหมายเลขพร้อมเพย์");
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

  it("provides the two requested mobile payment choices", () => {
    expect(paymentClient).toContain("ชำระแพ็กเกจ CpIPOS");
    expect(paymentClient).toContain("ชำระเงินทั่วไป");
    expect(paymentClient).toContain("ตรวจสอบยอดชำระ");
    expect(paymentClient).toContain("บัญชีรับชำระ");
    expect(paymentClient).toContain("QR นี้ล็อกจำนวนเงินตามยอดค้างของร้าน");
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
