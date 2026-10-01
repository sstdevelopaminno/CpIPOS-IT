import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readBoundedJson } from "@/lib/server/limited-json";
import {
  SupportMailBridgeError,
  archiveSupportMail,
  getSupportMailThread,
  listSupportMailThreads,
  markSupportMailRead,
  replySupportMail,
  sendSupportMail,
  trashManySupportMail,
  trashSupportMail
} from "@/lib/services/it-admin/support-mail-service";

export const dynamic = "force-dynamic";

type SupportMailAction = "send_new" | "reply" | "mark_read" | "archive" | "trash" | "trash_many";

type Body = {
  action?: SupportMailAction;
  thread_id?: string;
  thread_ids?: string[];
  to?: string;
  subject?: string;
  body?: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validRecipientList(value: string) {
  const recipients = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return recipients.length > 0 && recipients.length <= 5 && recipients.every((email) => EMAIL.test(email));
}

function bridgeError(error: unknown) {
  if (error instanceof SupportMailBridgeError) {
    return fail(error.code, error.message, error.status);
  }
  return guardItAdminError(error);
}

export async function GET(request: Request) {
  try {
    const ctx = await requireItAdmin();
    const rate = await enforceRateLimit({
      namespace: "it_support_mail_read",
      key: ctx.auth.userId,
      max: 90,
      windowMs: 60_000
    });
    if (!rate.ok) return fail("rate_limited", "เรียกดูอีเมลถี่เกินไป กรุณารอสักครู่", 429);

    const url = new URL(request.url);
    const threadId = clean(url.searchParams.get("thread_id"), 220);
    if (threadId) {
      const result = await getSupportMailThread(threadId);
      return ok(result);
    }

    const query = clean(url.searchParams.get("q"), 180);
    const unreadOnly = url.searchParams.get("unread") === "1";
    const folderRaw = clean(url.searchParams.get("folder"), 20);
    const folder = (["all", "inbox", "starred", "sent", "archive"] as const).includes(
      folderRaw as "all" | "inbox" | "starred" | "sent" | "archive"
    ) ? folderRaw as "all" | "inbox" | "starred" | "sent" | "archive" : "inbox";
    const result = await listSupportMailThreads({ query, unreadOnly, folder, limit: 24 });
    return ok({
      ...result,
      actor: { user_id: ctx.auth.userId, role: ctx.auth.platformRole }
    });
  } catch (error) {
    return bridgeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireItAdmin();
    const rate = await enforceRateLimit({
      namespace: "it_support_mail_write",
      key: ctx.auth.userId,
      max: 20,
      windowMs: 60_000
    });
    if (!rate.ok) return fail("rate_limited", "ทำรายการอีเมลถี่เกินไป กรุณารอสักครู่", 429);

    const input = await readBoundedJson<Body>(request, 48_000);
    const action = input?.action;

    if (action === "send_new") {
      const to = clean(input.to, 1000).toLowerCase();
      const subject = clean(input.subject, 300);
      const body = clean(input.body, 30_000);
      if (!validRecipientList(to)) return fail("invalid_recipient", "กรุณาระบุอีเมลผู้รับที่ถูกต้อง สูงสุด 5 รายการ", 422);
      if (!subject) return fail("subject_required", "กรุณาระบุหัวข้ออีเมล", 422);
      if (!body) return fail("mail_body_required", "กรุณาระบุข้อความอีเมล", 422);

      await sendSupportMail({ to, subject, body });
      await appendAuditLog({
        actorUserId: ctx.auth.userId,
        actorRole: ctx.auth.platformRole,
        action: "support_mail_sent",
        targetTable: "gmail_support_mailbox",
        module: "it_support",
        metadata: { to, subject },
        ipAddress: ctx.requestMeta.ipAddress ?? undefined,
        userAgent: ctx.requestMeta.userAgent ?? undefined
      });
      return ok({ sent: true });
    }

    if (action === "trash_many") {
      const threadIds = Array.isArray(input.thread_ids)
        ? Array.from(new Set(input.thread_ids.map((value) => clean(value, 220)).filter(Boolean))).slice(0, 50)
        : [];
      if (!threadIds.length) return fail("thread_ids_required", "กรุณาเลือกรายการอีเมลที่ต้องการลบ", 422);

      const result = await trashManySupportMail(threadIds);
      await appendAuditLog({
        actorUserId: ctx.auth.userId,
        actorRole: ctx.auth.platformRole,
        action: "support_mail_bulk_trashed",
        targetTable: "gmail_support_mailbox",
        module: "it_support",
        metadata: { thread_ids: threadIds, requested_count: threadIds.length, trashed_count: result.trashed_count ?? null },
        ipAddress: ctx.requestMeta.ipAddress ?? undefined,
        userAgent: ctx.requestMeta.userAgent ?? undefined
      });
      return ok({ trashed: true, count: result.trashed_count ?? threadIds.length });
    }

    const threadId = clean(input.thread_id, 220);
    if (!threadId) return fail("thread_id_required", "กรุณาเลือก Thread อีเมล", 422);

    if (action === "reply") {
      const body = clean(input.body, 30_000);
      if (!body) return fail("reply_body_required", "กรุณาระบุข้อความตอบกลับ", 422);
      await replySupportMail({ threadId, body });
      await appendAuditLog({
        actorUserId: ctx.auth.userId,
        actorRole: ctx.auth.platformRole,
        action: "support_mail_replied",
        targetTable: "gmail_support_mailbox",
        targetId: threadId,
        module: "it_support",
        metadata: { thread_id: threadId },
        ipAddress: ctx.requestMeta.ipAddress ?? undefined,
        userAgent: ctx.requestMeta.userAgent ?? undefined
      });
      return ok({ sent: true, thread_id: threadId });
    }

    if (action === "mark_read") {
      await markSupportMailRead(threadId);
      return ok({ marked_read: true, thread_id: threadId });
    }

    if (action === "archive") {
      await archiveSupportMail(threadId);
      await appendAuditLog({
        actorUserId: ctx.auth.userId,
        actorRole: ctx.auth.platformRole,
        action: "support_mail_archived",
        targetTable: "gmail_support_mailbox",
        targetId: threadId,
        module: "it_support",
        metadata: { thread_id: threadId },
        ipAddress: ctx.requestMeta.ipAddress ?? undefined,
        userAgent: ctx.requestMeta.userAgent ?? undefined
      });
      return ok({ archived: true, thread_id: threadId });
    }

    if (action === "trash") {
      await trashSupportMail(threadId);
      await appendAuditLog({
        actorUserId: ctx.auth.userId,
        actorRole: ctx.auth.platformRole,
        action: "support_mail_trashed",
        targetTable: "gmail_support_mailbox",
        targetId: threadId,
        module: "it_support",
        metadata: { thread_id: threadId },
        ipAddress: ctx.requestMeta.ipAddress ?? undefined,
        userAgent: ctx.requestMeta.userAgent ?? undefined
      });
      return ok({ trashed: true, thread_id: threadId });
    }

    return fail("invalid_support_mail_action", "คำสั่งอีเมลไม่ถูกต้อง", 422);
  } catch (error) {
    return bridgeError(error);
  }
}
