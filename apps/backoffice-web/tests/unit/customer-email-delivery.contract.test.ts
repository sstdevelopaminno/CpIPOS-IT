import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("transactional customer email delivery", () => {
  const service = src("src/lib/services/it-admin/customer-email-service.ts");
  const manual = src("src/app/api/it-admin/v1/customer-emails/send/route.ts");
  const activation = src("src/app/api/it-admin/v1/store-registrations/route.ts");
  const settlement = src("src/app/api/it-admin/v1/subscription-payments/settle/[requestId]/route.ts");
  const settings = src("src/app/api/it-admin/v1/subscription-payments/settings/route.ts");
  const migration = src("../../supabase/migrations/20260927090000_customer_email_delivery.sql");
  const registrationUi = src("src/components/it-admin/store-registrations-console.tsx");
  const paymentUi = src("src/components/it-admin/subscription-payment-history.tsx");

  it("deduplicates each business event and rate-limits retry attempts", () => {
    expect(migration).toContain("event_key text not null unique");
    expect(service).toContain("RETRY_COOLDOWN_MS");
    expect(service).toContain("already_sent");
    expect(service).toContain("eventType");
    expect(service).toContain("sourceId");
  });

  it("blocks common mistyped email domains instead of silently changing them", () => {
    expect(service).toContain('"amil.com", "gmail.com"');
    expect(service).toContain("กรุณาแก้ข้อมูลลูกค้าก่อนส่ง");
  });

  it("supports authorized automatic delivery after activation and verified settlement", () => {
    expect(activation).toContain("deliverCustomerEmail");
    expect(activation).toContain('eventType: "store_activation"');
    expect(settlement).toContain("deliverCustomerEmail");
    expect(settlement).toContain('eventType: "payment_confirmation"');
    expect(settings).toContain("auto_send_store_activation");
    expect(settings).toContain("auto_send_payment_confirmation");
  });

  it("keeps a manual IT send path with no PIN disclosure", () => {
    expect(manual).toContain("requireItAdmin()");
    expect(manual).toContain("enforceRateLimit");
    expect(registrationUi).toContain("ส่งอีเมลเปิดระบบ");
    expect(paymentUi).toContain("ส่งอีเมลยืนยันชำระ");
    expect(service).toContain("ระบบจะไม่ส่ง PIN หรือรหัสลับทางอีเมล");
  });

  it("appends the company signature used by real customer emails", () => {
    expect(service).toContain("บริษัท คัตติ้งพอยท์ เทค จำกัด");
    expect(service).toContain("Cutting Point Tech Co., Ltd.");
    expect(service).toContain("cuttingpointtech.vercel.app");
    expect(service).toContain("098-5460-355");
    expect(service).toContain("companySignatureHtml");
    expect(service).toContain("companySignatureText");
  });

  it("requires an authorized server-side bridge", () => {
    expect(service).toContain("CPIPOS_MAIL_BRIDGE_URL");
    expect(service).toContain("CPIPOS_MAIL_BRIDGE_SECRET");
    expect(service).not.toContain("NEXT_PUBLIC_CPIPOS_MAIL_BRIDGE");
  });
});
