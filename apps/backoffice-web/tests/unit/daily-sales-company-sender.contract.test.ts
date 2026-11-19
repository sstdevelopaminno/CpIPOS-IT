import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("company sender for tenant daily sales email", () => {
  const service = source("src/lib/services/it-admin/customer-email-service.ts");
  const route = source("src/app/api/it-admin/v1/maintenance/daily-sales-email/route.ts");
  const ui = source("src/components/it-admin/daily-sales-email-operations.tsx");
  const companyScript = source("../../tools/daily-sales-mail-bridge/Code.gs");
  const companyManifest = JSON.parse(source("../../tools/daily-sales-mail-bridge/appsscript.json"));
  const supportScript = source("../../tools/customer-mail-bridge/Code.gs");
  const supportManifest = JSON.parse(source("../../tools/customer-mail-bridge/appsscript.json"));

  it("never falls back to the Support Gmail bridge for daily sales or its test", () => {
    expect(service).toContain('input.eventType === "daily_sales_summary" || input.eventType === "daily_sales_summary_test"');
    expect(service).toContain("CPIPOS_DAILY_SALES_MAIL_BRIDGE_URL");
    expect(service).toContain("CPIPOS_DAILY_SALES_MAIL_BRIDGE_SECRET");
    expect(service).toContain("CPIPOS_MAIL_BRIDGE_URL");
    expect(service).toContain("expectedSenderEmail: expectedSenderEmail ?? undefined");
  });

  it("requires the corporate sender to equal configured IT billing email", () => {
    expect(service).toContain("settings.billing_email.trim().toLowerCase()");
    expect(service).toContain("daily_sales_sender_mismatch");
    expect(service).toContain('String(payload.mailbox ?? "").trim().toLowerCase()');
    expect(companyScript).toContain('body.expectedSenderEmail || ""');
    expect(companyScript).toContain("effective !== expected");
    expect(companyScript).toContain("requestedSender !== effective");
    expect(companyScript.indexOf("requestedSender !== effective")).toBeLessThan(companyScript.indexOf("MailApp.sendEmail({"));
  });

  it("keeps the company bridge send-only and mandates minimal OAuth scopes", () => {
    expect(companyScript).toContain('action !== "status" && action !== "send_transactional"');
    expect(companyScript).not.toContain("GmailApp.");
    expect(companyManifest.oauthScopes).toEqual([
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/script.send_mail"
    ]);
    expect(companyManifest.oauthScopes).not.toContain("https://mail.google.com/");
  });

  it("retains Support permissions and fail-closed identity verification", () => {
    expect(supportScript).toContain("authorizeSupportMailBridge");
    expect(supportScript).toContain('!effective || (mailbox && mailbox !== effective)');
    expect(supportManifest.oauthScopes).toContain("https://www.googleapis.com/auth/userinfo.email");
    expect(supportManifest.oauthScopes).toContain("https://mail.google.com/");
  });

  it("shows the exact configured From address and does not falsely claim OAuth is verified", () => {
    expect(route).toContain("bridge_configured: Boolean(");
    expect(route).toContain('.select("billing_email")');
    expect(ui).toContain("data.sender.bridge_configured");
    expect(ui).toContain("Google permissions and test still required");
  });

  it("keeps preview/test and automatic store isolation", () => {
    const worker = source("src/app/api/internal/daily-sales-summary/run/route.ts");
    expect(worker).toContain('eventType: "daily_sales_summary"');
    expect(worker).toContain("sourceId: row.tenant_id");
    expect(worker).toContain("to: String(row.owner_email ??");
    expect(route).toContain('eventType: "daily_sales_summary_test"');
    expect(route).toContain("const companyRecipient = preview.companyTestEmail");
    expect(route).toContain('"daily_sales_email_preview_no_sales"');
  });
});
