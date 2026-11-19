import "server-only";

const SUPPORT_MAILBOX = "cuttingpointtech.support@gmail.com";
const COMPANY_MAILBOX = "cuttingpointtech@gmail.com";
type BridgeRole = "support" | "company";

export type SupportMailThreadSummary = {
  id: string;
  subject: string;
  from: string;
  to: string;
  snippet: string;
  last_message_at: string;
  message_count: number;
  unread: boolean;
  starred?: boolean;
  in_inbox: boolean;
};

export type SupportMailMessage = {
  id: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  body: string;
};

type BridgeBase = {
  ok?: boolean;
  error?: string;
  mailbox?: string;
  bridge_version?: string;
  capabilities?: string[];
};

type ListThreadsResponse = BridgeBase & {
  folder?: string;
  threads?: SupportMailThreadSummary[];
};

type GetThreadResponse = BridgeBase & {
  thread?: SupportMailThreadSummary;
  messages?: SupportMailMessage[];
};

export class SupportMailBridgeError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "SupportMailBridgeError";
    this.code = code;
    this.status = status;
  }
}

function bridgeConfig(role: BridgeRole) {
  // Two separate Google Apps Script deployments, each executing as its own
  // Gmail account. Never fall back across identities.
  const isSupport = role === "support";
  const url = (isSupport
    ? process.env.CPIPOS_SUPPORT_MAIL_BRIDGE_URL
    : process.env.CPIPOS_MAIL_BRIDGE_URL)?.trim();
  const secret = (isSupport
    ? process.env.CPIPOS_SUPPORT_MAIL_BRIDGE_SECRET
    : process.env.CPIPOS_MAIL_BRIDGE_SECRET)?.trim();
  const expectedMailbox = isSupport ? SUPPORT_MAILBOX : COMPANY_MAILBOX;
  const configuredMailbox = isSupport
    ? process.env.CPIPOS_SUPPORT_MAILBOX?.trim().toLowerCase()
    : undefined;

  if (!url || !secret) {
    throw new SupportMailBridgeError(
      isSupport ? "support_mail_not_configured" : "company_mail_not_configured",
      isSupport
        ? "ยังไม่ได้ตั้งค่า CPIPOS_SUPPORT_MAIL_BRIDGE_URL และ CPIPOS_SUPPORT_MAIL_BRIDGE_SECRET ของบัญชี cuttingpointtech.support@gmail.com"
        : "ยังไม่ได้ตั้งค่า CPIPOS_MAIL_BRIDGE_URL และ CPIPOS_MAIL_BRIDGE_SECRET ของบัญชี cuttingpointtech@gmail.com",
      503
    );
  }
  if (configuredMailbox && configuredMailbox !== expectedMailbox) {
    throw new SupportMailBridgeError(
      "support_mailbox_config_mismatch",
      `CPIPOS_SUPPORT_MAILBOX ต้องเป็น ${SUPPORT_MAILBOX} ไม่ใช่ ${configuredMailbox}`,
      503
    );
  }
  const otherUrl = (isSupport
    ? process.env.CPIPOS_MAIL_BRIDGE_URL
    : process.env.CPIPOS_SUPPORT_MAIL_BRIDGE_URL)?.trim();
  // Do not interrupt customer transactional mail during Support's separate
  // cutover: only Support access fails if its URL still points to company.
  if (isSupport && otherUrl && otherUrl === url) {
    throw new SupportMailBridgeError(
      "mail_bridge_identity_overlap",
      "อีเมลบริษัทและ Support ใช้ Apps Script URL เดียวกันไม่ได้ กรุณาแยกเป็น Web App ของ Google คนละบัญชี",
      503
    );
  }
  return { url, secret, expectedMailbox };
}

function normalizeMailbox(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

async function callBridge<T extends BridgeBase>(payload: Record<string, unknown>, role: BridgeRole = "support"): Promise<T> {
  const { url, secret, expectedMailbox } = bridgeConfig(role);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, secret }),
      signal: AbortSignal.timeout(25000),
      cache: "no-store"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const timeout = error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError" || /timeout|aborted/i.test(message));
    throw new SupportMailBridgeError(
      timeout ? "support_mail_bridge_timeout" : "support_mail_bridge_unavailable",
      timeout
        ? "การโหลดอีเมลใช้เวลานานเกินกำหนด ระบบจะลองใหม่อัตโนมัติ"
        : (message || "ไม่สามารถเชื่อมต่อ Mail Bridge ได้"),
      503
    );
  }

  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body?.ok) {
    const code = String(body?.error || "support_mail_bridge_failed");
    const message = code === "unsupported_action"
      ? "Mail Bridge ยังเป็นเวอร์ชันเก่า กรุณาอัปเดต Apps Script เป็นเวอร์ชัน Support Mail"
      : code === "wrong_mailbox"
        ? `Mail Bridge ต้องรันด้วยบัญชี ${expectedMailbox} กรุณาตรวจสอบ Execute as Me และ Script Properties`
        : code === "thread_not_found"
          ? "ไม่พบอีเมลหรือ Thread นี้แล้ว"
          : code === "unauthorized"
            ? "Mail Bridge secret ไม่ตรงกัน"
            : code === "wrong_mailbox_configuration"
              ? `Apps Script ต้องตั้ง CPIPOS_SUPPORT_MAILBOX เป็น ${expectedMailbox} และอนุญาต OAuth ด้วยบัญชีนี้`
            : code === "support_mailbox_authorization_required" ||
              /userinfo\.email|Session\.getEffectiveUser|authorization is required/i.test(code)
              ? `Apps Script ยังไม่ผ่าน OAuth สำหรับ ${expectedMailbox} กรุณารัน authorizeSupportMailBridge ด้วยบัญชีดังกล่าว แล้ว Deploy Web App ใหม่`
              : "Gmail Support ทำรายการนี้ไม่สำเร็จชั่วคราว กรุณาลองใหม่";
    throw new SupportMailBridgeError(code, message, code === "thread_not_found" ? 404 : 502);
  }

  const mailbox = normalizeMailbox(body.mailbox);
  if (!mailbox || mailbox !== expectedMailbox) {
    throw new SupportMailBridgeError(
      "support_mailbox_mismatch",
      `Mail Bridge เชื่อมกับ ${mailbox || "บัญชีไม่ทราบชื่อ"} แต่ปลายทางนี้อนุญาตเฉพาะ ${expectedMailbox}`,
      409
    );
  }

  return body;
}

export async function getSupportMailHealth() {
  const body = await callBridge<BridgeBase>({ action: "status" });
  const mailbox = normalizeMailbox(body.mailbox);
  if (mailbox !== SUPPORT_MAILBOX || !body.bridge_version ||
      !Array.isArray(body.capabilities) || !body.capabilities.includes("sent")) {
    throw new SupportMailBridgeError(
      "support_mail_bridge_upgrade_required",
      "Mail Bridge ฝ่าย Support ยังไม่พร้อมตรวจ Gmail Sent กรุณา Deploy Code.gs ล่าสุดภายใต้ cuttingpointtech.support@gmail.com",
      409
    );
  }
  return { ready: true, mailbox, bridge_version: body.bridge_version };
}

/** Read-only corporate sender status, independent of Support Mail. */
export async function getCompanyMailHealth() {
  const body = await callBridge<BridgeBase>({ action: "status" }, "company");
  const mailbox = normalizeMailbox(body.mailbox);
  if (mailbox !== COMPANY_MAILBOX || !body.bridge_version ||
      !Array.isArray(body.capabilities) || !body.capabilities.includes("sent")) {
    throw new SupportMailBridgeError(
      "company_mail_bridge_upgrade_required",
      "Mail Bridge บริษัทต้องเป็น Code.gs เวอร์ชันล่าสุดและรันภายใต้ cuttingpointtech@gmail.com",
      409
    );
  }
  return { ready: true, mailbox, bridge_version: body.bridge_version };
}

/** Read only company Gmail Sent evidence for transactional customer email. */
export async function listCompanyMailSentThreads(input: { query: string; limit?: number }) {
  const body = await callBridge<ListThreadsResponse>({
    action: "list_threads",
    folder: "sent",
    query: input.query.trim().slice(0, 180),
    limit: Math.max(1, Math.min(30, Math.trunc(input.limit ?? 24)))
  }, "company");
  if (!Array.isArray(body.capabilities) || !body.capabilities.includes("sent")) {
    throw new SupportMailBridgeError(
      "company_mail_sent_unsupported",
      "Apps Script ของอีเมลบริษัทไม่รองรับ Gmail Sent กรุณาอัปเดต Code.gs",
      409
    );
  }
  return { mailbox: COMPANY_MAILBOX, threads: Array.isArray(body.threads) ? body.threads : [] };
}

export async function listSupportMailThreads(input?: {
  query?: string;
  unreadOnly?: boolean;
  folder?: "all" | "inbox" | "starred" | "sent" | "archive";
  limit?: number;
}) {
  const folder = input?.folder ?? "inbox";
  const body = await callBridge<ListThreadsResponse>({
    action: "list_threads",
    query: String(input?.query ?? "").trim().slice(0, 180),
    unread_only: input?.unreadOnly === true,
    folder,
    limit: Math.max(1, Math.min(30, Math.trunc(input?.limit ?? 24)))
  });
  const versioned = Boolean(body.bridge_version) && Array.isArray(body.capabilities);
  if (!versioned && folder !== "inbox") {
    throw new SupportMailBridgeError(
      "support_mail_bridge_upgrade_required",
      "Support Mail Bridge รุ่นปัจจุบันรองรับเฉพาะ Inbox จนกว่าจะ Deploy Code.gs เวอร์ชันล่าสุด",
      409
    );
  }
  if (versioned && !body.capabilities!.includes(folder)) {
    throw new SupportMailBridgeError(
      "support_mail_folder_unsupported",
      "Mail Bridge เวอร์ชันนี้ยังไม่รองรับกล่องอีเมลที่เลือก",
      409
    );
  }
  return {
    mailbox: normalizeMailbox(body.mailbox) || SUPPORT_MAILBOX,
    folder: String(body.folder || folder),
    threads: Array.isArray(body.threads) ? body.threads : [],
    bridge_version: body.bridge_version || "legacy",
    capabilities: Array.isArray(body.capabilities) ? body.capabilities : ["inbox"]
  };
}

export async function getSupportMailThread(threadId: string) {
  const body = await callBridge<GetThreadResponse>({
    action: "get_thread",
    thread_id: threadId,
    max_messages: 30
  });
  if (!body.thread) {
    throw new SupportMailBridgeError("support_mail_thread_missing", "ไม่พบ Thread อีเมล", 404);
  }
  return {
    mailbox: normalizeMailbox(body.mailbox) || SUPPORT_MAILBOX,
    thread: body.thread,
    messages: Array.isArray(body.messages) ? body.messages : []
  };
}

/**
 * Reuse the blue CpIPOS email identity for operational Support messages.
 * Source content is always escaped; the same plain-text message remains
 * available for accessibility and clients that do not render HTML.
 */
export function renderSupportMailHtml(subject: string, body: string) {
  const escape = (value: string) => value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
  const lines = body.split(/\\r?\\n/).slice(0, 200);
  const details = lines.map((line) => {
    const value = line.trim();
    if (!value) return '<div style="height:12px;line-height:12px">&nbsp;</div>';
    const otp = /^รหัส OTP:\\s*(\\d{6})$/.exec(value);
    if (otp) {
      return '<div style="margin:16px 0;padding:18px 12px;border:1px solid #bcd8fc;border-radius:12px;background:#ecf5ff;text-align:center">' +
        '<div style="font-size:12px;color:#52657f">รหัสยืนยัน OTP</div>' +
        '<div style="margin-top:6px;font-size:30px;font-weight:900;letter-spacing:7px;color:#123f86">' +
        escape(otp[1] || "") + '</div></div>';
    }
    const idx = value.indexOf(":");
    if (idx > 0 && idx < 44 && !value.startsWith("http")) {
      return '<div style="margin:4px 0;font-size:14px;line-height:1.8;color:#263d5a"><strong style="color:#102a50">' +
        escape(value.slice(0, idx + 1)) + '</strong> ' + escape(value.slice(idx + 1).trim()) + '</div>';
    }
    return '<div style="margin:4px 0;font-size:14px;line-height:1.8;color:#263d5a">' + escape(value) + '</div>';
  }).join("");
  return [
    '<!doctype html><html lang="th"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    '<body style="margin:0;padding:0;background:#f3f6fb">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;border-collapse:collapse"><tr><td align="center" style="padding:26px 12px">',
    '<table role="presentation" width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #dbe5f3;border-radius:16px;overflow:hidden">',
    '<tr><td style="padding:22px 26px;background:#165bc4;color:#ffffff;font-family:Arial,sans-serif">',
    '<div style="font-size:25px;font-weight:900">CpIPOS</div><div style="font-size:12px;color:#e5efff;margin-top:5px">IT SUPPORT CONTROL PLANE</div>',
    '</td></tr><tr><td style="padding:30px 26px;font-family:Arial,\'Noto Sans Thai\',sans-serif;color:#142946">',
    '<div style="font-size:21px;font-weight:900;line-height:1.5;color:#102a50">' + escape(subject.slice(0, 300)) + '</div>',
    '<div style="margin-top:20px;padding:16px;border-radius:12px;background:#f8fbff;border:1px solid #e2eaf5">',
    details,
    '</div>',
    '<div style="margin-top:23px;border-top:1px solid #e2eaf5;padding-top:18px;font-size:12px;line-height:1.8;color:#66758b">',
    'CpIPOS IT Support<br><a href="mailto:cuttingpointtech.support@gmail.com" style="color:#176fe8;text-decoration:none">cuttingpointtech.support@gmail.com</a>',
    '</div></td></tr></table>',
    '<div style="padding:12px;font-family:Arial,sans-serif;font-size:11px;color:#94a3b8">อีเมลแจ้งเตือนจากระบบ IT Support ของ CpIPOS</div>',
    '</td></tr></table></body></html>'
  ].join("");
}

export async function sendSupportMail(input: { to: string; subject: string; body: string }) {
  // A Support/IT OTP and registration alert must originate only from the
  // dedicated Support Google account, never the customer notification mailbox.
  await getSupportMailHealth();
  const receipt = await callBridge<BridgeBase & { sent?: boolean }>({
    action: "send_new",
    to: input.to,
    subject: input.subject,
    body: input.body,
    htmlBody: renderSupportMailHtml(input.subject, input.body)
  });
  // The OTP caller must never issue a challenge as "emailed" on a generic
  // HTTP-200/ok receipt. Require the exact sender and positive send ACK.
  if (receipt.sent !== true || normalizeMailbox(receipt.mailbox) !== SUPPORT_MAILBOX) {
    throw new SupportMailBridgeError(
      "support_mail_send_unconfirmed",
      "Mail Bridge ยังไม่ยืนยันการส่งอีเมลจากบัญชี Support",
      502
    );
  }
  return receipt;
}

export async function replySupportMail(input: { threadId: string; body: string }) {
  await getSupportMailHealth();
  return callBridge<BridgeBase & { sent?: boolean; thread_id?: string }>({
    action: "reply",
    thread_id: input.threadId,
    body: input.body
  });
}

export async function markSupportMailRead(threadId: string) {
  return callBridge<BridgeBase>({ action: "mark_read", thread_id: threadId });
}

export async function archiveSupportMail(threadId: string) {
  return callBridge<BridgeBase>({ action: "archive", thread_id: threadId });
}

export async function trashSupportMail(threadId: string) {
  return callBridge<BridgeBase & { trashed?: boolean }>({
    action: "trash",
    thread_id: threadId
  });
}

export async function trashManySupportMail(threadIds: string[]) {
  return callBridge<BridgeBase & { trashed_count?: number }>({
    action: "trash_many",
    thread_ids: threadIds.slice(0, 50)
  });
}

export function supportMailboxAddress() {
  return SUPPORT_MAILBOX;
}
