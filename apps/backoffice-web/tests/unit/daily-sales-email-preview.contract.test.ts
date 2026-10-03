import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("daily sales email preview and company test send", () => {
  const route = src("src/app/api/it-admin/v1/maintenance/daily-sales-email/route.ts");
  const modal = src("src/components/it-admin/daily-sales-email-preview-modal.tsx");
  const operations = src("src/components/it-admin/daily-sales-email-operations.tsx");
  const mail = src("src/lib/services/it-admin/customer-email-service.ts");
  const migration = src("../../supabase/migrations/20261003161500_daily_sales_email_preview_and_test.sql");

  it("previews a store even when automatic daily email is disabled", () => {
    expect(migration).toContain("create or replace function public.daily_sales_summary_preview");
    expect(migration).toContain("where t.id=p_tenant_id");
    expect(migration).not.toContain("s.enabled=true");
    expect(route).toContain('action === "preview_daily_sales_email"');
    expect(route).toContain('context.supabase.rpc("daily_sales_summary_preview"');
  });

  it("uses only a completed Bangkok business day for preview", () => {
    expect(route).toContain("value <= previousBangkokDate()");
    expect(route).toContain("วันที่ Preview ต้องเป็นวันที่สิ้นสุดแล้วก่อนวันนี้");
    expect(migration).toContain("o.created_at >= b.from_at");
    expect(migration).toContain("o.created_at < b.until_at");
    expect(migration).toContain("where s.completed_count > 0");
  });

  it("keeps Preview read-only and sends tests only to the configured company support email", () => {
    expect(route).toContain("prepareCustomerEmailPreview");
    expect(route).toContain("preview.companyTestEmail");
    expect(route).toContain('eventType: "daily_sales_summary_test"');
    expect(route).toContain("customer_email_used: false");
    expect(route).toContain("SEND_DAILY_SALES_TEST");
    expect(mail).toContain("companyTestEmail: settings.support_email.trim().toLowerCase()");
  });

  it("separates test delivery events from real customer daily summary events", () => {
    expect(migration).toContain("'daily_sales_summary_test'::text");
    expect(mail).toContain('"daily_sales_summary_test"');
    expect(route).toContain('[TEST]');
    expect(route).toContain("daily_sales_summary_test_email");
  });

  it("requires IT Support for test send but not for Preview", () => {
    const previewIndex = route.indexOf('action === "preview_daily_sales_email"');
    const supportIndex = route.indexOf('assertItSupportAction(context, "การส่ง Test Daily Sales Email');
    expect(previewIndex).toBeGreaterThan(-1);
    expect(supportIndex).toBeGreaterThan(previewIndex);
    expect(modal).toContain("canSendTest");
    expect(modal).toContain("ส่งทดสอบได้เฉพาะ IT Support");
  });

  it("renders Desktop, Tablet and Mobile sandboxed previews", () => {
    expect(modal).toContain('"desktop"');
    expect(modal).toContain('"tablet"');
    expect(modal).toContain('"mobile"');
    expect(modal).toContain('sandbox=""');
    expect(modal).toContain("DEVICE_WIDTH");
    expect(modal).toContain("srcDoc={preview.html_body}");
  });

  it("adds Preview next to store-level operations", () => {
    expect(operations).toContain("DailySalesEmailPreviewModal");
    expect(operations).toContain("setPreviewStore(row)");
    expect(operations).toContain('preview: "Preview"');
  });
});
