import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  customerEmailMailboxCategory,
  selectCustomerMailBridge,
  type CustomerMailBridgeConfig
} from "../../src/lib/services/it-admin/customer-email-routing";

const strict: CustomerMailBridgeConfig = {
  strict: true,
  legacyUrl: "https://example.com/legacy",
  legacySecret: "legacy-secret",
  billingUrl: "https://example.com/billing",
  billingSecret: "billing-secret",
  supportUrl: "https://example.com/support",
  supportSecret: "support-secret",
  billingMailbox: "cuttingpointtech@gmail.com",
  supportMailbox: "cuttingpointtech.support@gmail.com"
};

describe("customer email account separation", () => {
  it("routes billing/renewal messages only to the organization mailbox", () => {
    for (const event of ["payment_confirmation", "subscription_due_reminder", "trial_expiry_reminder", "tenant_deletion_warning"]) {
      expect(customerEmailMailboxCategory(event)).toBe("billing");
      expect(selectCustomerMailBridge(event, strict)).toMatchObject({
        ok: true, category: "billing", url: strict.billingUrl,
        expectedMailbox: "cuttingpointtech@gmail.com", verifySender: true
      });
    }
  });

  it("routes activation, sales and support-related transactional mail only to Support", () => {
    for (const event of ["store_activation", "sales_retention_export", "daily_sales_summary", "daily_sales_summary_test"]) {
      expect(customerEmailMailboxCategory(event)).toBe("support");
      expect(selectCustomerMailBridge(event, strict)).toMatchObject({
        ok: true, category: "support", url: strict.supportUrl,
        expectedMailbox: "cuttingpointtech.support@gmail.com", verifySender: true
      });
    }
  });

  it("rejects marketing or unknown events instead of using transactional mail", () => {
    expect(selectCustomerMailBridge("marketing_campaign", strict))
      .toEqual({ ok: false, error: "unsupported_customer_mail_event" });
  });

  it("preserves existing production routing while strict flag is off", () => {
    const route = selectCustomerMailBridge("payment_confirmation", { ...strict, strict: false });
    expect(route).toMatchObject({ ok: true, url: strict.legacyUrl, verifySender: false });
  });

  it("fails closed when either dedicated bridge is missing or both resolve to the same URL", () => {
    expect(selectCustomerMailBridge("payment_confirmation", { ...strict, billingUrl: "" }))
      .toEqual({ ok: false, error: "billing_mail_bridge_not_configured" });
    expect(selectCustomerMailBridge("store_activation", { ...strict, supportSecret: "" }))
      .toEqual({ ok: false, error: "support_mail_bridge_not_configured" });
    expect(selectCustomerMailBridge("payment_confirmation", { ...strict, supportUrl: strict.billingUrl }))
      .toEqual({ ok: false, error: "mail_bridge_routes_must_be_distinct" });
    expect(selectCustomerMailBridge("store_activation", { ...strict, supportMailbox: strict.billingMailbox }))
      .toEqual({ ok: false, error: "customer_mailbox_configuration_invalid" });
  });

  it("checks the Google executor identity before sending and never grants Gmail read access to billing", () => {
    const service = readFileSync(resolve(process.cwd(), "src/lib/services/it-admin/customer-email-service.ts"), "utf8");
    const billing = readFileSync(resolve(process.cwd(), "../../tools/billing-mail-bridge/Code.gs"), "utf8");
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "../../tools/billing-mail-bridge/appsscript.json"), "utf8")) as { oauthScopes: string[] };
    expect(service).toContain("CPIPOS_STRICT_MAIL_ROUTING");
    expect(service).toContain('action: "status"');
    expect(service).toContain("bridge_sender_mismatch");
    expect(service.indexOf('action: "status"')).toBeLessThan(service.indexOf("const response = await fetch(bridge.url"));
    expect(service).toContain("eventType: input.eventType");
    expect(billing).toContain("function authorizeBillingMailBridge()");
    expect(billing).toContain('BILLING_MAILBOX = "cuttingpointtech@gmail.com"');
    expect(billing).toContain("billing_event_not_allowed");
    expect(billing).toContain("MailApp.sendEmail");
    expect(billing).toContain(String.raw`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`);
    expect(billing).not.toContain("GmailApp");
    expect(billing).not.toContain("list_threads");
    expect(manifest.oauthScopes).toContain("https://www.googleapis.com/auth/userinfo.email");
    expect(manifest.oauthScopes).toContain("https://www.googleapis.com/auth/script.send_mail");
    expect(manifest.oauthScopes).not.toContain("https://mail.google.com/");
  });
});
