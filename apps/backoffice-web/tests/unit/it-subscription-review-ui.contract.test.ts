import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ui = readFileSync(new URL("../../src/components/it-admin/subscription-payment-history.tsx", import.meta.url), "utf8");

describe("IT subscription review and mobile usability", () => {
  it("does not offer the settlement action on a renewal intent with no payment notice", () => {
    expect(ui).toContain('row.status === "under_review" && row.kind === "payment_notice"');
    expect(ui).toContain("{canApprove ? <button");
    expect(ui).toContain("!draft.confirmed_bank_receipt");
    expect(ui).toContain("รอสลิปจาก POS หรือฝ่าย IT ก่อนอนุมัติ");
  });

  it("guides staff to keep the existing open request and refresh the payment evidence", () => {
    expect(ui).toContain("แนบสลิปแทนลูกค้า (รับจากแชท)");
    expect(ui).toContain("อัปโหลดสลิปเข้าคำขอเดิม");
    expect(ui).toContain("รีเฟรชรายการหลังร้านส่งสลิป");
    expect(ui).toContain("void reload().catch");
  });

  it("remains scrollable and tappable on phone-sized displays", () => {
    expect(ui).toContain("max-h-[calc(100dvh-24px)]");
    expect(ui).toContain("overflow-y-auto overscroll-contain");
    expect(ui).toContain("min-h-12 rounded-lg bg-emerald-600");
  });
});
