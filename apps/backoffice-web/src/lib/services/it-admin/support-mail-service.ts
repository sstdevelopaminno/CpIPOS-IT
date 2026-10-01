import "server-only";

const SUPPORT_MAILBOX =
  process.env.CPIPOS_SUPPORT_MAILBOX?.trim().toLowerCase() ||
  "cuttingpointtech.support@gmail.com";

const DEFAULT_SUPPORT_MAIL_BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycby_5bnLmvhTgBPr7zFGOJGIHtOew2Ot2Qj3EhRuu-sKhPrXJG9ZZWqDgYdrtiNsQeMh/exec";

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

function bridgeConfig() {
  const url =
    process.env.CPIPOS_SUPPORT_MAIL_BRIDGE_URL?.trim() ||
    DEFAULT_SUPPORT_MAIL_BRIDGE_URL;
  const secret =
    process.env.CPIPOS_SUPPORT_MAIL_BRIDGE_SECRET?.trim() ||
    process.env.CPIPOS_MAIL_BRIDGE_SECRET?.trim();
  if (!url || !secret) {
    throw new SupportMailBridgeError(
      "support_mail_not_configured",
      "ยังไม่ได้ตั้งค่า Secret สำหรับ Mail Bridge ของอีเมล Support",
      503
    );
  }
  return { url, secret };
}

function normalizeMailbox(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

async function callBridge<T extends BridgeBase>(payload: Record<string, unknown>): Promise<T> {
  const { url, secret } = bridgeConfig();
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
        ? "Mail Bridge ถูก Deploy ด้วยบัญชี Gmail ที่ไม่ใช่ cuttingpointtech.support@gmail.com"
        : code === "thread_not_found"
          ? "ไม่พบอีเมลหรือ Thread นี้แล้ว"
          : code === "unauthorized"
            ? "Mail Bridge secret ไม่ตรงกัน"
            : "Gmail Support ทำรายการนี้ไม่สำเร็จชั่วคราว กรุณาลองใหม่";
    throw new SupportMailBridgeError(code, message, code === "thread_not_found" ? 404 : 502);
  }

  const mailbox = normalizeMailbox(body.mailbox);
  if (mailbox && mailbox !== SUPPORT_MAILBOX) {
    throw new SupportMailBridgeError(
      "support_mailbox_mismatch",
      `Mail Bridge เชื่อมกับ ${mailbox} แต่ระบบอนุญาตเฉพาะ ${SUPPORT_MAILBOX}`,
      409
    );
  }

  return body;
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

export async function sendSupportMail(input: { to: string; subject: string; body: string }) {
  return callBridge<BridgeBase & { sent?: boolean }>({
    action: "send_new",
    to: input.to,
    subject: input.subject,
    body: input.body
  });
}

export async function replySupportMail(input: { threadId: string; body: string }) {
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
