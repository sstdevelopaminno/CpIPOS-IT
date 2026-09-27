/**
 * CpIPOS transactional email bridge.
 *
 * Deploy this Apps Script as a Web App owned by the Gmail account that must send
 * customer emails. In Project Settings > Script Properties add:
 * CPIPOS_MAIL_BRIDGE_SECRET = the same secret configured in Vercel.
 *
 * Execute as: Me
 * Who has access: Anyone (the shared secret below is still required)
 *
 * The application database provides the primary idempotency guarantee. This
 * bridge also caches each idempotency key for six hours to suppress fast retries.
 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var expected = PropertiesService.getScriptProperties().getProperty("CPIPOS_MAIL_BRIDGE_SECRET");
    if (!expected || !body.secret || body.secret !== expected) {
      return json_({ ok: false, error: "unauthorized" });
    }

    var to = String(body.to || "").trim().toLowerCase();
    var subject = String(body.subject || "").trim();
    var textBody = String(body.textBody || "");
    var htmlBody = String(body.htmlBody || "");
    var senderName = String(body.senderName || "CpIPOS").trim();
    var replyTo = String(body.replyTo || "").trim();
    var key = String(body.idempotencyKey || "").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || !textBody || !key) {
      return json_({ ok: false, error: "invalid_payload" });
    }

    var cache = CacheService.getScriptCache();
    var cacheKey = "cpipos-mail:" + Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key)
    );
    if (cache.get(cacheKey)) {
      return json_({ ok: true, deduplicated: true, messageId: "cached:" + key });
    }

    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody || undefined,
      name: senderName || "CpIPOS",
      replyTo: replyTo || undefined
    });

    cache.put(cacheKey, "sent", 21600);
    return json_({ ok: true, messageId: "mailapp:" + new Date().toISOString() });
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error || "mailapp_failed") });
  }
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
