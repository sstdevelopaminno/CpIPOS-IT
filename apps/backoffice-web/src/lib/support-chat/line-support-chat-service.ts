import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import {
  callSupportChat,
  mirrorSupportChatHead,
  publishOptimisticSupportChatHead,
  rollbackOptimisticSupportChatHead,
  type SupportChatHead
} from "@/lib/support-chat/support-chat-service";
import type { LineSupportSession } from "@/lib/support-chat/line-support-auth";

type BridgeToken = {
  payload: Record<string, unknown>;
  signature: string;
};

type Conversation = Record<string, unknown> & {
  id: string;
  tenant_id: string;
  status: string;
};

type Message = Record<string, unknown> & {
  id: string;
  sender_type: "store" | "it" | "system";
  message_body: string;
  created_at: string;
};

async function issueLineSupportBridge(session: LineSupportSession): Promise<BridgeToken> {
  const db = getPrimarySupabaseServiceClient();
  const issued = await db.rpc("issue_support_chat_bridge_token", {
    p_user_id: session.bindingId,
    p_actor_type: "store",
    p_tenant_id: session.tenantId,
    p_branch_id: null,
    p_role: "line_support",
    p_display_name: session.displayName,
    p_avatar_url: session.avatarUrl
  });

  if (issued.error || !issued.data) {
    throw new Error("Unable to authorize LINE support chat.");
  }
  return issued.data as BridgeToken;
}

async function listOpenConversation(bridge: BridgeToken) {
  const data = await callSupportChat<{ conversations: Conversation[] }>(
    bridge,
    "list_conversations"
  );
  return data.conversations.find((row) => row.status !== "closed") ?? null;
}

export async function openLineSupportConversation(session: LineSupportSession) {
  const bridge = await issueLineSupportBridge(session);
  let conversation = await listOpenConversation(bridge);

  if (!conversation) {
    const created = await callSupportChat<{
      conversation: Conversation;
      head: SupportChatHead;
      already_open: boolean;
    }>(bridge, "create_conversation", {
      subject: "LINE OA Support",
      contact_name: session.displayName,
      store_code: session.storeCode,
      store_name: session.storeName,
      store_logo_url: session.storeLogoUrl
    });
    conversation = created.conversation;
    await mirrorSupportChatHead(created.head);
  }

  return loadLineSupportConversation(session, conversation.id, bridge);
}

export async function loadLineSupportConversation(
  session: LineSupportSession,
  conversationId: string,
  existingBridge?: BridgeToken
) {
  const bridge = existingBridge ?? await issueLineSupportBridge(session);
  const data = await callSupportChat<{
    conversation: Conversation;
    messages: Message[];
    head: SupportChatHead;
    head_changed?: boolean;
  }>(bridge, "get_messages", {
    conversation_id: conversationId,
    mark_read: true
  });

  if (data.head_changed) {
    await mirrorSupportChatHead(data.head);
  }

  return { conversation: data.conversation, messages: data.messages };
}

export async function sendLineSupportMessage(
  session: LineSupportSession,
  conversationId: string,
  rawMessage: string
) {
  const message = String(rawMessage ?? "").trim().slice(0, 4000);
  if (!message) throw new Error("message_required");

  const optimistic = await publishOptimisticSupportChatHead(conversationId, "store", message);
  try {
    const bridge = await issueLineSupportBridge(session);
    const data = await callSupportChat<{
      message: Message;
      conversation: Conversation;
      head: SupportChatHead;
    }>(bridge, "send_message", {
      conversation_id: conversationId,
      message
    });
    await mirrorSupportChatHead(data.head);
    return data;
  } catch (error) {
    await rollbackOptimisticSupportChatHead(optimistic).catch(() => null);
    throw error;
  }
}

export async function closeLineSupportConversation(
  session: LineSupportSession,
  conversationId: string
) {
  const bridge = await issueLineSupportBridge(session);
  const data = await callSupportChat<{
    conversation: Conversation;
    head: SupportChatHead;
  }>(bridge, "close_conversation", {
    conversation_id: conversationId
  });
  await mirrorSupportChatHead(data.head);
  return data;
}
