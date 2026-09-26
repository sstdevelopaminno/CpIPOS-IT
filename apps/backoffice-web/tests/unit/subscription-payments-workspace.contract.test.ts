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
    expect(api).toContain('from("tenant_data_lifecycle")');
    expect(api).toContain("metadata");
    expect(api).toContain('source: typeof payment.metadata?.source');
    expect(api).toContain('kind: payment.metadata?.kind === "payment_notice"');
    expect(ui).toContain("CpiPOS-001 · POS ↔ IT");
    expect(ui).toContain("POS → IT");
    expect(api).toContain("effectiveExpiry");
    expect(ui).toContain("ยกเว้นการเรียกเก็บ (บัญชีภายใน)");

    expect(api).toContain("has_paid_cycle");
    expect(api).toContain('Number(cycle.amount_paid) >= Number(cycle.amount_due)');
  });
  it("does not issue false receipts or claim a real email was sent", () => {
    expect(ui).toContain("ร่างอีเมลถึงร้าน");
    expect(ui).toContain("ยังไม่มีรอบบิลที่ชำระครบ");
    expect(ui).toContain("รอบบิลบันทึกว่าชำระครบ — ยังไม่ได้ออกใบเสร็จ");
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

  it("keeps issuer VAT state controlled and separates billing identity from POS receipts", () => {
    const profileApi = src("src/app/api/it-admin/v1/subscription-payments/business/route.ts");
    const profileUi = src("src/components/it-admin/subscription-business-profile.tsx");
    const identityMigration = src("../../supabase/migrations/20260925100000_it_billing_identity_settings.sql");
    expect(profileApi).toContain("requireItAdmin()");
    expect(profileApi).toContain("vat_status_not_editable");
    expect(profileApi).toContain("redactForAudit");
    expect(profileApi).toContain("company_billing_identity_updated");
    expect(profileUi).toContain("billing_registration_no");
    expect(profileUi).toContain("billing_bank_account_number");
    expect(identityMigration).toContain("billing_vat_registered boolean not null default false");
    expect(identityMigration).toContain("revoke all on public.it_communication_settings from anon, authenticated");
  });

  it("shows historical requests and cycles without leaking slip URLs or claiming receipts", () => {
    const historyApi = src("src/app/api/it-admin/v1/subscription-payments/history/[tenantId]/route.ts");
    const historyUi = src("src/components/it-admin/subscription-payment-history.tsx");
    expect(historyApi).toContain("requireItAdmin()");
    expect(historyApi).toContain('from("tenant_subscription_payment_requests")');
    expect(historyApi).toContain('from("tenant_billing_cycles")');
    expect(historyApi).toContain('from("tenant_subscription_approval_events")');
    expect(historyApi).toContain("has_evidence: Boolean(evidence_url)");
    expect(historyUi).toContain("การแจ้งชำระและไฟล์สลิปไม่ใช่หลักฐานว่าธนาคารรับเงินจริงแล้ว");
    expect(ui).toContain("ประวัติการชำระ");
  });

  it("keeps private bank-slip evidence and admin review separate from bank receipt", () => {
    const evidenceMigration = src("../../supabase/migrations/20260925103100_subscription_evidence_bucket.sql");
    const indexMigration = src("../../supabase/migrations/20260925103000_subscription_open_request_index.sql");
    const adminReview = src("src/app/api/it-admin/v1/subscription-payments/review/[requestId]/route.ts");
    const historyApi = src("src/app/api/it-admin/v1/subscription-payments/history/[tenantId]/route.ts");
    const historyUi = src("src/components/it-admin/subscription-payment-history.tsx");
    expect(evidenceMigration).toContain("'subscription-payment-evidence'");
    expect(evidenceMigration).toContain("false,5242880");
    expect(indexMigration).toContain("where status in ('pending','under_review')");
    expect(adminReview).toContain("requireItAdmin()");
    expect(adminReview).toContain("rejection_note_required");
    expect(adminReview).not.toContain('"approved"');
    expect(historyApi).toContain("createSignedUrl(evidence_url, 300)");
    expect(historyApi).toContain('evidence_url?.startsWith(tenantId + "/")');
    expect(historyUi).toContain("รับเรื่องตรวจสอบ");
    expect(historyUi).toContain("ปฏิเสธพร้อมเหตุผล");
  });
});
