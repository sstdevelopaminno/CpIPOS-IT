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
};

type ListThreadsResponse = BridgeBase & {
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
      signal: AbortSignal.timeout(12000),
      cache: "no-store"
    });
  } catch (error) {
    throw new SupportMailBridgeError(
      "support_mail_bridge_unavailable",
      error instanceof Error ? error.message : "ไม่สามารถเชื่อมต่อ Mail Bridge ได้",
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
            : "เชื่อมต่อ Gmail Support ไม่สำเร็จ";
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
  limit?: number;
}) {
  const body = await callBridge<ListThreadsResponse>({
    action: "list_threads",
    query: String(input?.query ?? "").trim().slice(0, 180),
    unread_only: input?.unreadOnly === true,
    limit: Math.max(1, Math.min(50, Math.trunc(input?.limit ?? 30)))
  });
  return {
    mailbox: normalizeMailbox(body.mailbox) || SUPPORT_MAILBOX,
    threads: Array.isArray(body.threads) ? body.threads : []
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

export function supportMailboxAddress() {
  return SUPPORT_MAILBOX;
}
