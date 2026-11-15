/**
 * Explicit mailbox separation for transactional customer notifications.
 * Marketing campaigns must never enter this transactional delivery channel.
 */
export type CustomerEmailMailboxCategory = "billing" | "support";

export function customerEmailMailboxCategory(eventType: string): CustomerEmailMailboxCategory | null {
  switch (eventType) {
    case "payment_confirmation":
    case "subscription_due_reminder":
    case "trial_expiry_reminder":
    case "tenant_deletion_warning":
      return "billing";
    case "store_activation":
    case "sales_retention_export":
    case "daily_sales_summary":
    case "daily_sales_summary_test":
      return "support";
    default:
      return null;
  }
}

export type CustomerMailBridgeConfig = {
  strict: boolean;
  legacyUrl?: string;
  legacySecret?: string;
  billingUrl?: string;
  billingSecret?: string;
  supportUrl?: string;
  supportSecret?: string;
  billingMailbox: string;
  supportMailbox: string;
};

export type CustomerMailBridgeSelection =
  | { ok: true; url: string; secret: string; expectedMailbox: string; verifySender: boolean; category: CustomerEmailMailboxCategory }
  | { ok: false; error: string };

export function selectCustomerMailBridge(
  eventType: string,
  config: CustomerMailBridgeConfig
): CustomerMailBridgeSelection {
  const category = customerEmailMailboxCategory(eventType);
  if (!category) return { ok: false, error: "unsupported_customer_mail_event" };
  const legacyUrl = config.legacyUrl?.trim() || "";
  const legacySecret = config.legacySecret?.trim() || "";

  // Keep the existing production path unchanged until BOTH mailbox deployments
  // are authorized, verified and strict routing is deliberately enabled.
  if (!config.strict) {
    if (!legacyUrl || !legacySecret) {
      return { ok: false, error: "customer_mail_bridge_not_configured" };
    }
    return {
      ok: true, url: legacyUrl, secret: legacySecret,
      expectedMailbox: "", verifySender: false, category
    };
  }

  const billingMailbox = config.billingMailbox.trim().toLowerCase();
  const supportMailbox = config.supportMailbox.trim().toLowerCase();
  if (!billingMailbox || !supportMailbox || billingMailbox === supportMailbox) {
    return { ok: false, error: "customer_mailbox_configuration_invalid" };
  }
  const billingUrl = config.billingUrl?.trim() || "";
  const supportUrl = config.supportUrl?.trim() || "";
  if (billingUrl && supportUrl && billingUrl === supportUrl) {
    return { ok: false, error: "mail_bridge_routes_must_be_distinct" };
  }
  const url = category === "billing" ? billingUrl : supportUrl;
  const secret = category === "billing"
    ? config.billingSecret?.trim() || ""
    : config.supportSecret?.trim() || "";
  if (!url || !secret) {
    return { ok: false, error: category === "billing"
      ? "billing_mail_bridge_not_configured"
      : "support_mail_bridge_not_configured" };
  }

  return {
    ok: true, url, secret,
    expectedMailbox: category === "billing" ? billingMailbox : supportMailbox,
    verifySender: true, category
  };
}
