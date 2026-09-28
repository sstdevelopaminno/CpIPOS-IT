import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("sales retention archive email", () => {
  const service = src("src/lib/services/it-admin/customer-email-service.ts");
  const route = src("src/app/api/internal/sales-retention/email/route.ts");
  const migration = src("../../supabase/migrations/20260928190000_sales_retention_email_event.sql");

  it("adds a dedicated transactional retention email event", () => {
    expect(service).toContain('"sales_retention_export"');
    expect(service).toContain("buildSalesRetentionExportEmail");
    expect(migration).toContain("auto_send_sales_retention_export");
    expect(migration).toContain("sales_retention_export");
  });

  it("requires a one-time database token before the internal callback can send", () => {
    expect(route).toContain("consume_sales_retention_email_token");
    expect(route).toContain('return response(false, 401, { error: "unauthorized" })');
  });

  it("resolves the current primary Owner email instead of trusting caller input", () => {
    expect(route).toContain("primary_owner_user_id");
    expect(route).toContain('from("users_profiles")');
    expect(route).not.toContain("body?.recipient_email");
  });

  it("sends private signed links for all three CSV exports", () => {
    expect(route).toContain("createSignedUrl");
    expect(route).toContain("orders_object_path");
    expect(route).toContain("items_object_path");
    expect(route).toContain("payments_object_path");
    expect(service).toContain("orders.csv");
    expect(service).toContain("items.csv");
    expect(service).toContain("payments.csv");
  });

  it("only marks a batch purge-ready after email success", () => {
    expect(route).toContain('delivery.status === "sent" || delivery.status === "already_sent"');
    expect(route).toContain('status: "purge_ready"');
    expect(route).toContain("purge_after");
  });

  it("blocks purge when an Owner email is missing or invalid", () => {
    expect(route).toContain('status: "email_blocked"');
    expect(service).toContain("customerEmailProblem");
  });
});
