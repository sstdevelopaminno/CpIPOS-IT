import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), "src", path), "utf8");
const endpoint = src("app/api/it-admin/v1/subscription-payments/evidence/[requestId]/route.ts");
const ui = src("components/it-admin/subscription-payment-history.tsx");
const history = src("app/api/it-admin/v1/subscription-payments/history/[tenantId]/route.ts");
const settle = src("app/api/it-admin/v1/subscription-payments/settle/[requestId]/route.ts");

describe("IT staff uploads forwarded customer chat payment evidence", () => {
  it("enforces live IT privileges, same-origin form upload and small validated image files", () => {
    expect(endpoint).toContain("requireItAdmin()");
    expect(endpoint).toContain('namespace: "it-forwarded-subscription-slip"');
    expect(endpoint).toContain("cross_origin_forbidden");
    expect(endpoint).toContain("MAX_SLIP_BYTES = 4 * 1024 * 1024");
    expect(endpoint).toContain('form.get("slip")');
    expect(endpoint).toContain('form.get("source_note")');
    expect(endpoint).toContain("slip instanceof File");
    expect(endpoint).toContain("detectMime(fileBytes)");
    expect(endpoint).toContain('detectedMime !== slip.type');
  });

  it("attaches only to the open request, never overwrites or creates a new request", () => {
    expect(endpoint).toContain('["pending", "under_review"].includes(current.status)');
    expect(endpoint).toContain("current.evidence_url");
    expect(endpoint).toContain('["renewal_intent", "payment_notice"]');
    expect(endpoint).toContain('const BUCKET = "subscription-payment-evidence"');
    expect(endpoint).toContain('upsert: false');
    expect(endpoint).toContain('.eq("tenant_id", current.tenant_id)');
    expect(endpoint).toContain('.eq("status", current.status)');
    expect(endpoint).toContain('.is("evidence_url", null)');
    expect(endpoint).toContain("if (!linked)");
    expect(endpoint).not.toContain('from("tenant_subscription_payment_requests").insert');
  });

  it("changes the request kind, records provenance and requires real bank verification", () => {
    expect(endpoint).toContain('kind: "payment_notice"');
    expect(endpoint).toContain('evidence_source: "it_forwarded_customer_chat"');
    expect(endpoint).toContain('evidence_received_via: "customer_chat"');
    expect(endpoint).toContain("evidence_submitted_by: auth.userId");
    expect(endpoint).toContain("evidence_attached_at: at");
    expect(endpoint).toContain('auto_check_status: "needs_review"');
    expect(endpoint).toContain("scanSubscriptionSlipFromPrimary");
    expect(endpoint).toContain("requires_manual_bank_verification: true");
    expect(endpoint).toContain("subscription_customer_chat_slip_attached_by_it");
    expect(endpoint).not.toContain('rpc("grant_provisional_subscription_access"');
    expect(endpoint).not.toContain('rpc("settle_subscription_payment"');
    expect(settle).toContain("confirmed_bank_receipt !== true");
  });

  it("provides accessible mobile/desktop upload and shows the source in the review history", () => {
    expect(ui).toContain("แนบสลิปแทนลูกค้า (รับจากแชท)");
    expect(ui).toContain('type="file" accept="image/jpeg,image/png,image/webp"');
    expect(ui).toContain("min-h-12 rounded-lg bg-blue-700");
    expect(ui).toContain('uploadChatSlip(row)');
    expect(ui).toContain("chatSlipFeedback?.id === row.id");
    expect(ui).toContain("ไม่ต้องส่งไฟล์ซ้ำ");
    expect(ui).toContain("ต้องตรวจยอดเข้าบัญชีธนาคารของบริษัทจริงก่อนกดอนุมัติ");
    expect(history).toContain("evidence_source: typeof info.evidence_source");
    expect(history).toContain("evidence_source_note: typeof info.evidence_source_note");
    expect(history).toContain("evidence_attached_at: typeof info.evidence_attached_at");
    expect(ui).toContain('row.evidence_source === "it_forwarded_customer_chat"');
  });
});
