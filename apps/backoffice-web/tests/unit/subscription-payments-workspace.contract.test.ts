import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const api = src("src/app/api/it-admin/v1/subscription-payments/route.ts");
const settings = src("src/app/api/it-admin/v1/subscription-payments/settings/route.ts");
const ui = src("src/components/it-admin/subscription-payments-console.tsx");
const navigation = src("src/app/(it-admin)/layout.tsx");
const migration = src("../../supabase/migrations/20260925080000_it_communication_settings.sql");

describe("subscription payments IT workspace", () => {
  it("enforces IT server guard and shows live contract, billing and payment data", () => {
    expect(api).toContain("requireItAdmin()");
    expect(api).toContain('from("tenant_subscription_contracts")');
    expect(api).toContain('from("tenant_billing_cycles")');
    expect(api).toContain('from("tenant_subscription_payment_requests")');
    expect(api).toContain("primary_owner_user_id");
    expect(api).toContain("has_verified_receipt");
    expect(api).toContain('Number(cycle.amount_paid) >= Number(cycle.amount_due)');
  });
  it("does not issue false receipts or claim a real email was sent", () => {
    expect(ui).toContain("ร่างอีเมลถึงร้าน");
    expect(ui).toContain("ใบเสร็จ: ยังไม่มีหลักฐานชำระครบ");
    expect(ui).toContain("ไม่ใช่หลักฐานรับชำระเงินหรือใบเสร็จรับเงิน");
    expect(ui).toContain("ส่งอีเมลอัตโนมัติจะเปิดใช้หลังเชื่อมระบบรับเงิน");
  });
  it("supports changing both addresses but keeps credentials out of the settings table", () => {
    expect(navigation).toContain("/it-admin/subscription-payments");
    expect(settings).toContain("requireItAdmin()");
    expect(settings).toContain("company_contact_email_settings_updated");
    expect(settings).toContain("billing_email");
    expect(settings).toContain("support_email");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.it_communication_settings from public, anon, authenticated");
    expect(migration).not.toContain("smtp_password");
    expect(migration).not.toContain("api_secret");
  });
});
