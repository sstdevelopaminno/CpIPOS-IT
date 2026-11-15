/**
 * CpIPOS billing-only MailApp bridge (no Gmail inbox/read access).
 * Deploy under cuttingpointtech@gmail.com as "Execute as Me".
 *
 * Script Properties:
 *   CPIPOS_BILLING_MAIL_BRIDGE_SECRET = server-side Vercel secret
 *
 * Accepts only status and approved billing transactional events.
 * Does not send marketing campaigns or Support Mail messages.
 */
var BILLING_MAIL_BRIDGE_VERSION = "2026-11-15.1-billing";
var BILLING_MAILBOX = "cuttingpointtech@gmail.com";

function authorizeBillingMailBridge() {
  var mailbox = String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
  if (mailbox !== BILLING_MAILBOX) throw new Error("wrong_billing_mailbox");
  var quota = MailApp.getRemainingDailyQuota();
  Logger.log("CpIPOS billing bridge authorized; available recipients: " + quota);
  return { ok: true, mailbox: mailbox, remainingDailyQuota: quota, bridge_version: BILLING_MAIL_BRIDGE_VERSION };
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var secret = PropertiesService.getScriptProperties().getProperty("CPIPOS_BILLING_MAIL_BRIDGE_SECRET");
    if (!secret || !body.secret || body.secret !== secret) {
      return billingJson_({ ok: false, error: "unauthorized" });
    }
    var mailbox = String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
    if (mailbox !== BILLING_MAILBOX) {
      return billingJson_({ ok: false, error: "wrong_billing_mailbox", mailbox: mailbox });
    }
    var action = String(body.action || "send_transactional").trim();
    if (action === "status") return billingJson_({ ok: true, mailbox: mailbox });
    if (action !== "send_transactional") {
      return billingJson_({ ok: false, error: "unsupported_action", mailbox: mailbox });
    }
    return sendBillingTransactional_(body, mailbox);
  } catch (error) {
    return billingJson_({ ok: false, error: String(error && error.message || error || "billing_mail_bridge_failed") });
  }
}

function sendBillingTransactional_(body, mailbox) {
  var event = String(body.eventType || "").trim();
  var accepted = {
    payment_confirmation: true,
    subscription_due_reminder: true,
    trial_expiry_reminder: true,
    tenant_deletion_warning: true
  };
  if (!accepted[event]) return billingJson_({ ok: false, error: "billing_event_not_allowed", mailbox: mailbox });
  var to = String(body.to || "").trim().toLowerCase();
  var subject = String(body.subject || "").trim().slice(0, 500);
  var textBody = String(body.textBody || "").trim();
  var htmlBody = String(body.htmlBody || "");
  var key = String(body.idempotencyKey || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || !textBody || !key) {
    return billingJson_({ ok: false, error: "invalid_payload", mailbox: mailbox });
  }

  var cache = CacheService.getScriptCache();
  var hash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key));
  var cacheKey = "cpipos-billing:" + hash;
  if (cache.get(cacheKey)) {
    return billingJson_({ ok: true, deduplicated: true, messageId: "cached:" + key, mailbox: mailbox });
  }
  var quota = MailApp.getRemainingDailyQuota();
  var reserve = 40;
  if (quota < reserve + 1) {
    return billingJson_({ ok: false, error: "mail_daily_quota_reserved", mailbox: mailbox, remaining: quota });
  }
  MailApp.sendEmail({
    to: to,
    subject: subject,
    body: textBody,
    htmlBody: htmlBody || undefined,
    name: String(body.senderName || "CUTTING POINT INNOVATION").slice(0, 120),
    replyTo: BILLING_MAILBOX
  });
  cache.put(cacheKey, "sent", 21600);
  return billingJson_({ ok: true, mailbox: mailbox, messageId: "mailapp:" + new Date().toISOString() });
}

function billingJson_(value) {
  value.bridge_version = BILLING_MAIL_BRIDGE_VERSION;
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
