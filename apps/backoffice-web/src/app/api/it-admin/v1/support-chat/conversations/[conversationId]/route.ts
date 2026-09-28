import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import {
  callSupportChat,
  issueItSupportChatBridge,
  mirrorSupportChatHead,
  publishOptimisticSupportChatHead,
  rollbackOptimisticSupportChatHead,
  deleteSupportChatHead,
  type SupportChatHead
} from "@/lib/support-chat/support-chat-service";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Conversation = Record<string, unknown> & {
  id?: string;
  tenant_id?: string;
  assigned_user_id?: string | null;
  status?: string;
  unread_it_count?: number;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const auth = await requireItAdmin();
    const { conversationId } = await context.params;
    const bridge = await issueItSupportChatBridge(auth);

    const data = await callSupportChat<{
      conversation: Conversation;
      messages: Array<Record<string, unknown>>;
      head: SupportChatHead;
      head_changed?: boolean;
      claimed?: boolean;
    }>(bridge, "get_messages", {
      conversation_id: conversationId,
      auto_claim: true,
      mark_read: true
    });

    if (data.head_changed) {
      await mirrorSupportChatHead(data.head);
    }

    if (data.claimed) {
      await appendAuditLog({
        tenantId: typeof data.conversation.tenant_id === "string" ? data.conversation.tenant_id : undefined,
        actorUserId: auth.auth.userId,
        actorRole: auth.auth.platformRole,
        action: "support_chat_claimed",
        targetTable: "support_chat_heads",
        targetId: conversationId,
        module: "support_chat",
        entityType: "support_conversation",
        entityId: conversationId,
        ipAddress: auth.requestMeta.ipAddress ?? undefined,
        userAgent: auth.requestMeta.userAgent ?? undefined
      });
    }

    return ok({ conversation: data.conversation, messages: data.messages });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const auth = await requireItAdmin();
    const { conversationId } = await context.params;
    const body = await request.json().catch(() => null) as {
      action?: string;
      message?: string;
      status?: string;
      internal_note?: string;
      attachment?: { name?: string; mime_type?: string; size_bytes?: number; data_base64?: string };
    } | null;
    const action = String(body?.action ?? "").trim();
    const bridgePromise = issueItSupportChatBridge(auth);

    if (action === "send") {
      const message = String(body?.message ?? "").trim().slice(0, 4000);
      if (!message && !body?.attachment) return fail("message_required", "กรุณาพิมพ์ข้อความหรือแนบรูปภาพ", 422);
      const rate = await enforceRateLimit({
        namespace: "it-support-chat-message",
        key: `${auth.auth.userId}:${conversationId}:${getClientIpAddress(request)}`,
        max: 40,
        windowMs: 5 * 60_000,
        failClosedOnBackendError: true
      });
      if (!rate.ok) return fail("support_chat_rate_limited", "ส่งข้อความถี่เกินไป กรุณารอสักครู่", 429);

      const preview = body?.attachment
        ? (message ? `[รูปภาพ] ${message}` : "[รูปภาพ]")
        : message;
      const optimistic = await publishOptimisticSupportChatHead(conversationId, "it", preview);

      try {
        const bridge = await bridgePromise;
        const data = await callSupportChat<{
          message: Record<string, unknown>;
          conversation: Conversation;
          head: SupportChatHead;
        }>(bridge, "send_message", {
          conversation_id: conversationId,
          message,
          attachment: body?.attachment ?? null
        });
        await mirrorSupportChatHead(data.head);
        await appendAuditLog({
          tenantId: typeof data.conversation.tenant_id === "string" ? data.conversation.tenant_id : undefined,
          actorUserId: auth.auth.userId,
          actorRole: auth.auth.platformRole,
          action: "support_chat_message_sent",
          targetTable: "support_chat_heads",
          targetId: conversationId,
          module: "support_chat",
          entityType: "support_conversation",
          entityId: conversationId,
          metadata: { message_length: message.length },
          ipAddress: auth.requestMeta.ipAddress ?? undefined,
          userAgent: auth.requestMeta.userAgent ?? undefined
        });
        return ok(data);
      } catch (error) {
        await rollbackOptimisticSupportChatHead(optimistic).catch(() => null);
        throw error;
      }
    }

    const bridge = await bridgePromise;

    if (action === "claim") {
      const data = await callSupportChat<{ conversation: Conversation; head: SupportChatHead }>(
        bridge, "claim_conversation", { conversation_id: conversationId }
      );
      await mirrorSupportChatHead(data.head);
      return ok(data);
    }

    if (action === "set_status") {
      const status = String(body?.status ?? "").trim();
      const data = await callSupportChat<{ conversation: Conversation; head: SupportChatHead }>(
        bridge, "set_status", { conversation_id: conversationId, status }
      );
      await mirrorSupportChatHead(data.head);
      await appendAuditLog({
        tenantId: typeof data.conversation.tenant_id === "string" ? data.conversation.tenant_id : undefined,
        actorUserId: auth.auth.userId,
        actorRole: auth.auth.platformRole,
        action: "support_chat_status_changed",
        targetTable: "support_chat_heads",
        targetId: conversationId,
        module: "support_chat",
        entityType: "support_conversation",
        entityId: conversationId,
        metadata: { status },
        ipAddress: auth.requestMeta.ipAddress ?? undefined,
        userAgent: auth.requestMeta.userAgent ?? undefined
      });
      return ok(data);
    }

    if (action === "update_note") {
      const internalNote = String(body?.internal_note ?? "").slice(0, 3000);
      const data = await callSupportChat<{ conversation: Conversation; head: SupportChatHead }>(
        bridge, "update_note", { conversation_id: conversationId, internal_note: internalNote }
      );
      await mirrorSupportChatHead(data.head);
      await appendAuditLog({
        tenantId: typeof data.conversation.tenant_id === "string" ? data.conversation.tenant_id : undefined,
        actorUserId: auth.auth.userId,
        actorRole: auth.auth.platformRole,
        action: "support_chat_note_updated",
        targetTable: "support_chat_heads",
        targetId: conversationId,
        module: "support_chat",
        entityType: "support_conversation",
        entityId: conversationId,
        metadata: { note_length: internalNote.trim().length },
        ipAddress: auth.requestMeta.ipAddress ?? undefined,
        userAgent: auth.requestMeta.userAgent ?? undefined
      });
      return ok(data);
    }

    if (action === "delete") {
      if (auth.auth.platformRole !== "it_support") {
        return fail("it_support_required", "เฉพาะ IT Support เท่านั้นที่ลบประวัติแชทได้", 403);
      }
      const data = await callSupportChat<{ deleted: true; conversation_id: string; tenant_id?: string }>(
        bridge, "delete_conversation", { conversation_id: conversationId }
      );
      await deleteSupportChatHead(conversationId);
      await appendAuditLog({
        tenantId: typeof data.tenant_id === "string" ? data.tenant_id : undefined,
        actorUserId: auth.auth.userId,
        actorRole: auth.auth.platformRole,
        action: "support_chat_deleted",
        targetTable: "support_chat_heads",
        targetId: conversationId,
        module: "support_chat",
        entityType: "support_conversation",
        entityId: conversationId,
        metadata: { permanent: true },
        ipAddress: auth.requestMeta.ipAddress ?? undefined,
        userAgent: auth.requestMeta.userAgent ?? undefined
      });
      return ok(data);
    }

    if (action === "close") {
      const data = await callSupportChat<{ conversation: Conversation; head: SupportChatHead }>(
        bridge, "close_conversation", { conversation_id: conversationId }
      );
      await mirrorSupportChatHead(data.head);
      await appendAuditLog({
        tenantId: typeof data.conversation.tenant_id === "string" ? data.conversation.tenant_id : undefined,
        actorUserId: auth.auth.userId,
        actorRole: auth.auth.platformRole,
        action: "support_chat_closed",
        targetTable: "support_chat_heads",
        targetId: conversationId,
        module: "support_chat",
        entityType: "support_conversation",
        entityId: conversationId,
        ipAddress: auth.requestMeta.ipAddress ?? undefined,
        userAgent: auth.requestMeta.userAgent ?? undefined
      });
      return ok(data);
    }

    return fail("unsupported_action", "คำสั่งแชทไม่ถูกต้อง", 422);
  } catch (error) {
    return guardItAdminError(error);
  }
}
