import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import {
  callSupportChat,
  issueItSupportChatBridge,
  mirrorSupportChatHead,
  type SupportChatHead
} from "@/lib/support-chat/support-chat-service";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Conversation = Record<string, unknown> & {
  id?: string;
  tenant_id?: string;
  assigned_user_id?: string | null;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const auth = await requireItAdmin();
    const { conversationId } = await context.params;
    const bridge = await issueItSupportChatBridge(auth);

    let data = await callSupportChat<{ conversation: Conversation; messages: Array<Record<string, unknown>> }>(
      bridge, "get_messages", { conversation_id: conversationId }
    );

    if (!data.conversation.assigned_user_id) {
      const claimed = await callSupportChat<{ conversation: Conversation; head: SupportChatHead }>(
        bridge, "claim_conversation", { conversation_id: conversationId }
      );
      await mirrorSupportChatHead(claimed.head);
      await appendAuditLog({
        tenantId: typeof claimed.conversation.tenant_id === "string" ? claimed.conversation.tenant_id : undefined,
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
      data = await callSupportChat<{ conversation: Conversation; messages: Array<Record<string, unknown>> }>(
        bridge, "get_messages", { conversation_id: conversationId }
      );
    }

    const read = await callSupportChat<{ conversation: Conversation; head: SupportChatHead }>(
      bridge, "mark_read", { conversation_id: conversationId }
    );
    await mirrorSupportChatHead(read.head);
    return ok({ ...data, conversation: read.conversation });
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
    const body = await request.json().catch(() => null) as { action?: string; message?: string } | null;
    const action = String(body?.action ?? "").trim();
    const bridge = await issueItSupportChatBridge(auth);

    if (action === "send") {
      const message = String(body?.message ?? "").trim().slice(0, 4000);
      if (!message) return fail("message_required", "กรุณาพิมพ์ข้อความ", 422);
      const rate = await enforceRateLimit({
        namespace: "it-support-chat-message",
        key: `${auth.auth.userId}:${conversationId}:${getClientIpAddress(request)}`,
        max: 40,
        windowMs: 5 * 60_000,
        failClosedOnBackendError: true
      });
      if (!rate.ok) return fail("support_chat_rate_limited", "ส่งข้อความถี่เกินไป กรุณารอสักครู่", 429);

      const data = await callSupportChat<{
        message: Record<string, unknown>;
        conversation: Conversation;
        head: SupportChatHead;
      }>(bridge, "send_message", { conversation_id: conversationId, message });
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
    }

    if (action === "claim") {
      const data = await callSupportChat<{ conversation: Conversation; head: SupportChatHead }>(
        bridge, "claim_conversation", { conversation_id: conversationId }
      );
      await mirrorSupportChatHead(data.head);
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
