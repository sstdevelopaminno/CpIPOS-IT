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

  it("keeps a manual IT send path with no PIN disclosure and canonical six-digit Store Code", () => {
    expect(manual).toContain("requireItAdmin()");
    expect(manual).toContain("enforceRateLimit");
    expect(manual).toContain("provision_request_key");
    expect(manual).toContain("it_store_provisioning_requests");
    expect(manual).toContain("publicStoreCode");
    expect(manual).not.toContain('storeCode: store.code');
    expect(service).toContain('/^\\d{6}$/');
    expect(registrationUi).toContain("ส่งอีเมลเปิดระบบ");
    expect(paymentUi).toContain("ส่งอีเมลยืนยันชำระ");
    expect(service).toContain("ระบบจะไม่ส่ง PIN หรือรหัสลับทางอีเมล");
  });

  it("renders style-B HTML with an IT-configurable company footer", () => {
    expect(service).toContain("brandMessage");
    expect(service).toContain("companySignatureHtml");
    expect(service).toContain("companySignatureText");
    expect(service).toContain("company_thai_name");
    expect(service).toContain("company_english_name");
    expect(service).toContain("contact_phone");
    expect(service).toContain("website_url");
    expect(service).toContain("email_footer_note");
    expect(service).toContain("ยืนยันการรับชำระเงินเรียบร้อย");
    expect(service).toContain("เปิดใช้งานระบบสำเร็จแล้ว");
    expect(settings).toContain("company_thai_name");
    expect(settings).toContain("email_footer_note");
  });

  it("requires an authorized server-side bridge", () => {
    expect(service).toContain("CPIPOS_MAIL_BRIDGE_URL");
    expect(service).toContain("CPIPOS_MAIL_BRIDGE_SECRET");
    expect(service).not.toContain("NEXT_PUBLIC_CPIPOS_MAIL_BRIDGE");
  });
});
