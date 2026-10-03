import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("daily sales summary email", () => {
  const migration = src("../../supabase/migrations/20261003153719_daily_sales_summary_email_system.sql");
  const mail = src("src/lib/services/it-admin/customer-email-service.ts");
  const worker = src("src/app/api/internal/daily-sales-summary/run/route.ts");
  const settingsApi = src("src/app/api/it-admin/v1/tenants/[tenantId]/daily-sales-email/route.ts");
  const controlCenter = src("src/components/it-admin/tenant-control-center.tsx");
  const settingsUi = src("src/components/it-admin/tenant-daily-sales-email-settings.tsx");

  it("uses a Bangkok calendar-day half-open window and sends after midnight", () => {
    expect(migration).toContain("at time zone 'Asia/Bangkok'");
    expect(migration).toContain("o.created_at >= b.from_at");
    expect(migration).toContain("o.created_at < b.until_at");
    expect(migration).toContain("'15 17 * * *'");
    expect(settingsUi).toContain("ตัดวัน 00:00 · ส่ง 00:15 น.");
  });

  it("skips days without completed sales", () => {
    expect(migration).toContain("where s.completed_count > 0");
    expect(worker).toContain("candidate_count");
    expect(settingsUi).toContain("ไม่มีขาย = ไม่ส่งอีเมล");
  });

  it("summarizes the required daily sales metrics and top three products", () => {
    for (const marker of [
      "ยอดก่อนส่วนลด",
      "จำนวนบิลขายสำเร็จ",
      "ยอดขายสุทธิ",
      "บิลยกเลิก",
      "ชำระเงินสด",
      "ชำระเงินโอน",
      "สินค้าขายดี 3 อันดับ"
    ]) {
      expect(mail).toContain(marker);
    }
    expect(migration).toContain("where product_rank <= 3");
    expect(migration).toContain("p.method::text='cash'");
    expect(migration).toContain("p.method::text='bank_transfer'");
  });

  it("resolves the current owner email at send time instead of copying it into settings", () => {
    expect(migration).toContain("t.primary_owner_user_id as owner_user_id");
    expect(migration).toContain("up.id=t.primary_owner_user_id");
    expect(settingsApi).toContain('.from("users_profiles")');
    expect(settingsApi).toContain("primary_owner_user_id");
    expect(migration).not.toContain("recipient_email text");
  });

  it("keeps per-store delivery off by default and exposes an IT toggle", () => {
    expect(migration).toContain("enabled boolean not null default false");
    expect(settingsApi).toContain("body.enabled");
    expect(settingsUi).toContain("เปิดการแจ้งส่ง");
    expect(settingsUi).toContain("ปิดการแจ้งส่ง");
  });

  it("adds the email control immediately after the sales report card", () => {
    const salesIndex = controlCenter.indexOf('setTab("salesSummary")');
    const emailIndex = controlCenter.indexOf('setTab("dailySalesEmail")');
    expect(salesIndex).toBeGreaterThan(-1);
    expect(emailIndex).toBeGreaterThan(salesIndex);
    expect(controlCenter).toContain("แจ้งสรุปยอดขายไปอีเมล์");
  });

  it("uses the existing company mail bridge and responsive email shell", () => {
    expect(worker).toContain('eventType: "daily_sales_summary"');
    expect(mail).toContain("CPIPOS_MAIL_BRIDGE_URL");
    expect(mail).toContain("max-width:600px");
    expect(mail).toContain("cp-summary-cell");
    expect(mail).toContain("width:100%;max-width:640px");
  });
});
