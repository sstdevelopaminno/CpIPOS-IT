/**
 * CpiPOS Daily Sales Mail Bridge - company sender only.
 *
 * Apps Script properties (configured in the approved company account):
 *   CPIPOS_MAIL_BRIDGE_SECRET
 *   CPIPOS_COMPANY_SENDER_EMAIL
 *
 * Deploy Web App: Execute as Me; access Anyone (shared secret required).
 * This bridge intentionally contains NO Gmail inbox/thread APIs.
 */
var DAILY_SALES_MAIL_BRIDGE_VERSION = "2026-11-19.1";

function authorizeCompanyMailBridge() {
  // Run once in the editor under the approved company Google account.
  var effective = String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
  var expected = companySenderEmail_();
  if (!expected || !effective || expected !== effective) {
    throw new Error("company_sender_account_mismatch");
  }
  var quota = MailApp.getRemainingDailyQuota();
  return { account: effective, remainingDailyQuota: quota };
}

function companySenderEmail_() {
  return String(PropertiesService.getScriptProperties()
    .getProperty("CPIPOS_COMPANY_SENDER_EMAIL") || "").trim().toLowerCase();
}

function companyJson_(value) {
  value.bridge_version = DAILY_SALES_MAIL_BRIDGE_VERSION;
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var props = PropertiesService.getScriptProperties();
    var secret = String(props.getProperty("CPIPOS_MAIL_BRIDGE_SECRET") || "");
    if (!secret || !body.secret || String(body.secret) !== secret) {
      return companyJson_({ ok: false, error: "unauthorized" });
    }

    var action = String(body.action || "send_transactional").trim();
    if (action !== "status" && action !== "send_transactional") {
      return companyJson_({ ok: false, error: "unsupported_action" });
    }

    var expected = companySenderEmail_();
    var effective = String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
    // MailApp sends FROM the Google account which authorized this deployment.
    // Never trust an arbitrary sender name or Reply-To as proof of the sender.
    if (!expected || !effective || effective !== expected) {
      return companyJson_({ ok: false, error: "company_sender_account_mismatch", mailbox: effective || null });
    }
    if (action === "status") return companyJson_({ ok: true, mailbox: effective, mode: "company_transactional_only" });

    var requestedSender = String(body.expectedSenderEmail || "").trim().toLowerCase();
    if (!requestedSender || requestedSender !== effective) {
      return companyJson_({ ok: false, error: "daily_sales_sender_mismatch", mailbox: effective });
    }

    var to = String(body.to || "").trim().toLowerCase();
    var subject = String(body.subject || "").trim().slice(0, 250);
    var textBody = String(body.textBody || "").slice(0, 30000);
    var htmlBody = String(body.htmlBody || "").slice(0, 100000);
    var senderName = String(body.senderName || "CpiPOS").trim().slice(0, 120);
    var replyTo = String(body.replyTo || "").trim().slice(0, 254);
    var idempotencyKey = String(body.idempotencyKey || "").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) ||
        !subject || !textBody || !idempotencyKey || idempotencyKey.length > 220) {
      return companyJson_({ ok: false, error: "invalid_payload", mailbox: effective });
    }
    var cache = CacheService.getScriptCache();
    var key = "cpipos-daily:" + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idempotencyKey)
    );
    if (cache.get(key)) {
      return companyJson_({ ok: true, deduplicated: true, messageId: "cached", mailbox: effective });
    }
    var reserve = Math.max(10, Math.min(90, Number(props.getProperty("CPIPOS_MAIL_MIN_REMAINING_QUOTA") || 30)));
    var remaining = MailApp.getRemainingDailyQuota();
    if (remaining < reserve + 1) {
      return companyJson_({ ok: false, error: "mail_daily_quota_reserved", mailbox: effective, remaining: remaining });
    }
    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody || undefined,
      name: senderName,
      replyTo: replyTo || undefined
    });
    cache.put(key, "sent", 21600);
    return companyJson_({ ok: true, mailbox: effective, messageId: "mailapp:" + new Date().toISOString() });
  } catch (err) {
    var details = String((err && err.message) || err || "");
    var code = /Session\.getEffectiveUser|userinfo\.email|permission to call/i.test(details)
      ? "company_sender_oauth_scope_missing" : "company_mail_bridge_failed";
    return companyJson_({ ok: false, error: code });
  }
}
