import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { localizeCustomerSystemEmail } from "@/lib/services/it-admin/localized-customer-email";

const source=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const route=source("../../src/app/api/it-admin/v1/tenants/[tenantId]/notification-language/route.ts");
const modal=source("../../src/components/it-admin/tenant-notification-language-modal.tsx");
const center=source("../../src/components/it-admin/tenant-control-center.tsx");
const customerEmail=source("../../src/lib/services/it-admin/customer-email-service.ts");
const storePush=source("../../src/lib/support-chat/support-push.ts");
const msg={subject:"ทดสอบ",textBody:"เรียน Owner\nร้านค้า: ร้านตัวอย่าง\nStore Code: 900001\nยอดรับชำระ: ฿1,250.00\n",htmlBody:"<p>ร้านตัวอย่าง</p>"};

describe("IT per-tenant notification language",()=>{
 it("offers a settings card and popup for email plus push in store settings",()=>{
  expect(center).toContain("ตั้งค่าภาษาระบบแจ้งเตือน");
  expect(center).toContain("TenantNotificationLanguageModal");
  expect(modal).toContain('["th"');
  expect(modal).toContain('name="tenant-notification-language"');
 });
 it("guards edits by IT privileges with conflict detection and audit",()=>{
  expect(route).toContain('ctx.profile.platform_role');
  expect(route).toContain('notification_language');
  expect(route).toContain('expected_language');
  expect(route).toContain('eq("updated_at", tenant.updated_at)');
  expect(route).toContain('it_tenant_notification_language_updated');
 });
 it("generates English delivery with factual IDs and amounts unchanged",()=>{
  const r=localizeCustomerSystemEmail(msg,"payment_confirmation","en",
   {email:"help@example.com",website:"https://example.com",company:"CpIPOS"});
  expect(r.subject).toContain("payment confirmed");
  expect(r.textBody).toContain("Store Code: 900001");
  expect(r.textBody).toContain("Payment received: ฿1,250.00");
  expect(r.htmlBody).toContain('lang="en"');
 });
 it("generates Lao delivery with amounts and Thai store name preserved",()=>{
  const r=localizeCustomerSystemEmail(msg,"payment_confirmation","lo",
   {email:"help@example.com",website:"https://example.com",company:"CpIPOS"});
  expect(r.subject).toContain("ຢືນຢັນ");
  expect(r.textBody).toContain("900001");
  expect(r.textBody).toContain("฿1,250.00");
  expect(r.htmlBody).toContain('lang="lo"');
 });
 it("uses one tenant language for email and system-generated push titles",()=>{
  expect(customerEmail).toContain("getTenantNotificationLanguage(input.db, input.tenantId)");
  expect(customerEmail).toContain("localizeCustomerSystemEmail");
  expect(storePush).toContain("getTenantNotificationLanguage");
  expect(storePush).toContain('input.audience==="store"');
 });
});
