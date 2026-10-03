import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("daily sales email operations console", () => {
  const api = src("src/app/api/it-admin/v1/maintenance/daily-sales-email/route.ts");
  const ui = src("src/components/it-admin/daily-sales-email-operations.tsx");
  const maintenance = src("src/components/it-admin/it-maintenance-console.tsx");
  const mail = src("src/lib/services/it-admin/customer-email-service.ts");
  const migration = src("../../supabase/migrations/20261003160000_daily_sales_email_operations_index.sql");

  it("shows all stores with enablement, Owner readiness and latest delivery state", () => {
    expect(api).toContain('.from("tenant_daily_sales_email_settings")');
    expect(api).toContain('.from("users_profiles")');
    expect(api).toContain('.eq("event_type", "daily_sales_summary")');
    expect(ui).toContain("latest_delivery");
    expect(ui).toContain("Owner Email");
    expect(ui).toContain("เปิดส่ง");
    expect(ui).toContain("ปิดส่ง");
  });

  it("allows retry only for failed or blocked delivery rows", () => {
    expect(api).toContain('["failed", "blocked"].includes(delivery.status)');
    expect(api).toContain("daily_sales_email_not_retryable");
    expect(api).toContain("รายการนี้ส่งสำเร็จแล้ว ระบบป้องกันการส่งซ้ำ");
    expect(ui).toContain("delivery?.retryable");
  });

  it("keeps manual retry restricted to IT Support", () => {
    expect(api).toContain("assertItSupportAction");
    expect(api).toContain("การ Retry อีเมลสรุปยอดขายอนุญาตเฉพาะ IT Support");
    expect(ui).toContain('access.role === "it_support"');
  });

  it("recomputes the original business date and uses the current Owner email for retry", () => {
    expect(api).toContain("businessDateFromEventKey");
    expect(api).toContain('context.supabase.rpc("daily_sales_summary_candidates"');
    expect(api).toContain("current_owner_email_used: true");
    expect(api).toContain("to: recipient");
    expect(mail).toContain("customerEmailProblem");
  });

  it("reuses the original daily idempotency key so a successful mail cannot duplicate", () => {
    expect(api).toContain('eventKeySuffix: businessDate.replaceAll("-", "")');
    expect(api).toContain('eventType: "daily_sales_summary"');
    expect(mail).toContain('if (delivery.status === "sent")');
    expect(mail).toContain('"already_sent"');
  });

  it("mounts the operations console in the existing maintenance workspace", () => {
    expect(maintenance).toContain('import { DailySalesEmailOperations } from "./daily-sales-email-operations";');
    expect(maintenance).toContain("<DailySalesEmailOperations language={language} />");
  });

  it("adds a targeted index for latest per-store daily email operations", () => {
    expect(migration).toContain("customer_email_deliveries_daily_sales_tenant_created_idx");
    expect(migration).toContain("event_type, tenant_id, created_at desc");
    expect(migration).toContain("where event_type='daily_sales_summary'");
  });
});
