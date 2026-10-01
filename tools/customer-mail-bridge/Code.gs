/**
 * CpIPOS Gmail / Apps Script bridge.
 *
 * Deploy this Apps Script as a Web App owned by:
 *   cuttingpointtech.support@gmail.com
 *
 * Script Properties:
 *   CPIPOS_MAIL_BRIDGE_SECRET = same secret as Vercel
 *   CPIPOS_SUPPORT_MAILBOX = cuttingpointtech.support@gmail.com
 *
 * Execute as: Me
 * Who has access: Anyone (the shared secret is still required)
 *
 * Backward compatible with the original transactional send payload.
 */
function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    var expected = PropertiesService.getScriptProperties().getProperty("CPIPOS_MAIL_BRIDGE_SECRET");
    if (!expected || !body.secret || body.secret !== expected) {
      return json_({ ok: false, error: "unauthorized" });
    }

    var action = String(body.action || "send_transactional").trim();
    var mailbox = supportMailbox_();
    var effective = String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
    if (mailbox && effective && mailbox !== effective) {
      return json_({ ok: false, error: "wrong_mailbox", mailbox: effective });
    }

    if (action === "list_threads") return listThreads_(body, mailbox || effective);
    if (action === "get_thread") return getThread_(body, mailbox || effective);
    if (action === "send_new") return sendNew_(body, mailbox || effective);
    if (action === "reply") return reply_(body, mailbox || effective);
    if (action === "mark_read") return markRead_(body, mailbox || effective);
    if (action === "archive") return archive_(body, mailbox || effective);
    if (action !== "send_transactional") {
      return json_({ ok: false, error: "unsupported_action", mailbox: mailbox || effective });
    }

    return sendTransactional_(body, mailbox || effective);
  } catch (error) {
    return json_({ ok: false, error: String(error && error.message || error || "mail_bridge_failed") });
  }
}

function supportMailbox_() {
  return String(
    PropertiesService.getScriptProperties().getProperty("CPIPOS_SUPPORT_MAILBOX") ||
    "cuttingpointtech.support@gmail.com"
  ).trim().toLowerCase();
}

function boundedInt_(value, fallback, min, max) {
  var parsed = Number(value);
  if (!isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function safeText_(value, max) {
  return String(value || "").trim().slice(0, max || 500);
}

function cleanQuery_(value) {
  return safeText_(value, 180).replace(/[\r\n\u0000-\u001f]+/g, " ");
}

function snippet_(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max || 220);
}

function threadById_(id) {
  var threadId = safeText_(id, 200);
  if (!threadId) throw new Error("thread_id_required");
  var thread = GmailApp.getThreadById(threadId);
  if (!thread) throw new Error("thread_not_found");
  return thread;
}

function messageSummary_(message) {
  return {
    id: message.getId(),
    from: safeText_(message.getFrom(), 500),
    to: safeText_(message.getTo(), 1000),
    cc: safeText_(message.getCc(), 1000),
    subject: safeText_(message.getSubject(), 500),
    date: message.getDate().toISOString(),
    body: String(message.getPlainBody() || "").slice(0, 24000)
  };
}

function threadSummary_(thread, messages) {
  var list = messages || [];
  var last = list.length ? list[list.length - 1] : null;
  return {
    id: thread.getId(),
    subject: safeText_(thread.getFirstMessageSubject(), 500),
    from: last ? safeText_(last.getFrom(), 500) : "",
    to: last ? safeText_(last.getTo(), 1000) : "",
    snippet: last ? snippet_(last.getPlainBody(), 180) : "",
    last_message_at: thread.getLastMessageDate().toISOString(),
    message_count: thread.getMessageCount(),
    unread: thread.isUnread(),
    starred: thread.hasStarredMessages(),
    in_inbox: thread.isInInbox()
  };
}

function folderQuery_(folder) {
  var value = String(folder || "inbox").trim().toLowerCase();
  if (value === "starred") return "is:starred -in:spam -in:trash";
  if (value === "sent") return "in:sent -in:spam -in:trash";
  if (value === "archive") return "-in:inbox -in:sent -in:drafts -in:spam -in:trash";
  return "in:inbox -in:spam -in:trash";
}

function listThreads_(body, mailbox) {
  var query = cleanQuery_(body.query);
  var unreadOnly = body.unread_only === true;
  var limit = boundedInt_(body.limit, 24, 1, 30);
  var folder = String(body.folder || "inbox").trim().toLowerCase();
  var gmailQuery = folderQuery_(folder);
  if (unreadOnly) gmailQuery += " is:unread";
  if (query) gmailQuery += " " + query;

  var threads = GmailApp.search(gmailQuery, 0, limit);
  var messageGroups = threads.length ? GmailApp.getMessagesForThreads(threads) : [];
  var summaries = [];
  for (var i = 0; i < threads.length; i += 1) {
    summaries.push(threadSummary_(threads[i], messageGroups[i] || []));
  }

  return json_({
    ok: true,
    mailbox: mailbox,
    folder: folder,
    threads: summaries
  });
}

function getThread_(body, mailbox) {
  var thread = threadById_(body.thread_id);
  var messages = thread.getMessages();
  var maxMessages = boundedInt_(body.max_messages, 20, 1, 50);
  if (messages.length > maxMessages) messages = messages.slice(messages.length - maxMessages);

  return json_({
    ok: true,
    mailbox: mailbox,
    thread: threadSummary_(thread, thread.getMessages()),
    messages: messages.map(messageSummary_)
  });
}

function sendNew_(body, mailbox) {
  var to = safeText_(body.to, 1000).toLowerCase();
  var subject = safeText_(body.subject, 500);
  var textBody = String(body.body || "").trim().slice(0, 30000);
  if (!to || !subject || !textBody) throw new Error("invalid_send_payload");

  GmailApp.sendEmail(to, subject, textBody, {
    name: "CpIPOS Support",
    replyTo: mailbox || undefined
  });

  return json_({ ok: true, mailbox: mailbox, sent: true });
}

function reply_(body, mailbox) {
  var thread = threadById_(body.thread_id);
  var textBody = String(body.body || "").trim().slice(0, 30000);
  if (!textBody) throw new Error("reply_body_required");

  thread.reply(textBody);
  thread.markRead();
  return json_({ ok: true, mailbox: mailbox, sent: true, thread_id: thread.getId() });
}

function markRead_(body, mailbox) {
  var thread = threadById_(body.thread_id);
  thread.markRead();
  return json_({ ok: true, mailbox: mailbox, thread_id: thread.getId(), unread: false });
}

function archive_(body, mailbox) {
  var thread = threadById_(body.thread_id);
  thread.moveToArchive();
  return json_({ ok: true, mailbox: mailbox, thread_id: thread.getId(), archived: true });
}

function sendTransactional_(body, mailbox) {
  var to = String(body.to || "").trim().toLowerCase();
  var subject = String(body.subject || "").trim();
  var textBody = String(body.textBody || "");
  var htmlBody = String(body.htmlBody || "");
  var senderName = String(body.senderName || "CpIPOS").trim();
  var replyTo = String(body.replyTo || "").trim();
  var key = String(body.idempotencyKey || "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !subject || !textBody || !key) {
    return json_({ ok: false, error: "invalid_payload", mailbox: mailbox });
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = "cpipos-mail:" + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, key)
  );
  if (cache.get(cacheKey)) {
    return json_({ ok: true, deduplicated: true, messageId: "cached:" + key, mailbox: mailbox });
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
  return json_({ ok: true, messageId: "mailapp:" + new Date().toISOString(), mailbox: mailbox });
}

function json_(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
