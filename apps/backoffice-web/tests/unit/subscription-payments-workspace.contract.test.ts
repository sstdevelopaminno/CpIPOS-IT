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
  it("keeps email informational while receipts come only from verified settlements", () => {
    expect(ui).toContain("ร่างอีเมลถึงร้าน");
    expect(ui).toContain("ไม่ใช่หลักฐานรับชำระเงินหรือใบเสร็จรับเงิน");
    expect(ui).toContain("ใบเสร็จจะออกอัตโนมัติเมื่อ IT ยืนยันเงินเข้าจากรายการธนาคาร");
    expect(ui).toContain("ใบเสร็จ {row.receipt.number}");
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

  it("shows historical requests, paid cycles and immutable receipts without leaking storage paths", () => {
    const historyApi = src("src/app/api/it-admin/v1/subscription-payments/history/[tenantId]/route.ts");
    const historyUi = src("src/components/it-admin/subscription-payment-history.tsx");
    expect(historyApi).toContain("requireItAdmin()");
    expect(historyApi).toContain('from("tenant_subscription_payment_requests")');
    expect(historyApi).toContain('from("tenant_billing_cycles")');
    expect(historyApi).toContain('from("tenant_subscription_approval_events")');
    expect(historyApi).toContain('from("tenant_subscription_receipts")');
    expect(historyApi).toContain("has_evidence: Boolean(evidence_url)");
    expect(historyUi).toContain("สลิปที่ร้านแนบมาไม่ถือว่าเงินเข้าจริง");
    expect(historyUi).toContain("ใบเสร็จแพ็กเกจ");
    expect(ui).toContain("ประวัติการชำระ");
  });

  it("settles only reviewed bank-confirmed payments and issues exactly one immutable receipt", () => {
    const evidenceMigration = src("../../supabase/migrations/20260925103100_subscription_evidence_bucket.sql");
    const indexMigration = src("../../supabase/migrations/20260925103000_subscription_open_request_index.sql");
    const settlementMigration = src("../../supabase/migrations/20260926170000_subscription_settlement_receipts.sql");
    const adminReview = src("src/app/api/it-admin/v1/subscription-payments/review/[requestId]/route.ts");
    const settleApi = src("src/app/api/it-admin/v1/subscription-payments/settle/[requestId]/route.ts");
    const historyApi = src("src/app/api/it-admin/v1/subscription-payments/history/[tenantId]/route.ts");
    const historyUi = src("src/components/it-admin/subscription-payment-history.tsx");
    const contractApi = src("src/app/api/it-admin/admin/tenants/[tenantId]/contract/route.ts");
    expect(evidenceMigration).toContain("'subscription-payment-evidence'");
    expect(evidenceMigration).toContain("false,5242880");
    expect(indexMigration).toContain("where status in ('pending','under_review')");
    expect(adminReview).toContain("requireItAdmin()");
    expect(adminReview).toContain("rejection_note_required");
    expect(adminReview).not.toContain('"approved"');
    expect(settleApi).toContain('confirmed_bank_receipt !== true');
    expect(settleApi).toContain('rpc("settle_subscription_payment"');
    expect(settleApi).toContain("receipt_number");
    expect(settlementMigration).toContain("tenant_subscription_settlements");
    expect(settlementMigration).toContain("tenant_subscription_receipts");
    expect(settlementMigration).toContain("payment_request_id uuid not null unique");
    expect(settlementMigration).toContain("billing_cycle_id uuid not null unique");
    expect(settlementMigration).toContain("bank_reference_already_used");
    expect(settlementMigration).toContain("interval '1 month'");
    expect(settlementMigration).toContain("interval '1 year'");
    expect(settlementMigration).toContain("trg_subscription_receipts_immutable");
    expect(settlementMigration).toContain("status = 'approved'");
    expect(settlementMigration).toContain("receipt_number");
    expect(historyApi).toContain("createSignedUrl(evidence_url, 300)");
    expect(historyApi).toContain('evidence_url?.startsWith(tenantId + "/")');
    expect(historyUi).toContain("รับเรื่องตรวจสอบ");
    expect(historyUi).toContain("ยืนยันเงินเข้า + เปิดแพ็กเกจ + ออกใบเสร็จ");
    expect(historyUi).toContain("ปฏิเสธพร้อมเหตุผล");
    expect(contractApi).toContain("paid_activation_requires_settlement");
  });
  it("retires legacy paid activation so no first activation can bypass receipt issuance", () => {
    const retirement = src("../../supabase/migrations/20260926173000_retire_legacy_paid_activation.sql");
    expect(retirement).toContain("legacy_paid_activation_disabled_use_settlement");
    expect(retirement).toContain("legacy_prepaid_migration");
    expect(retirement).toContain("awaiting_verified_settlement");
    expect(retirement).toContain("interval '7 days'");
    expect(retirement).toContain("subscription_payment_unverified");
    expect(retirement).toContain("must never activate a paid package");
    expect(retirement).not.toContain("PERFORM app.approve_paid_subscription");
  });

});
