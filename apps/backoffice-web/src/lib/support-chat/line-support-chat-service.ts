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

export type VoiceQueueSnapshot = {
  position: number;
  ahead_count: number;
  waiting_count: number;
  active_calls: number;
  queued_since: string | null;
  lease_seconds: number;
};

export type SupportVoiceCall = Record<string, unknown> & {
  id: string;
  conversation_id: string;
  direction: "store_to_it" | "it_to_store";
  status: "requested" | "accepted" | "connecting" | "connected" | "declined" | "cancelled" | "ended" | "failed";
  requested_by_name: string;
  assigned_it_name?: string | null;
  assigned_it_role?: string | null;
  signaling_key?: string | null;
  requested_at: string;
  accepted_at?: string | null;
  connected_at?: string | null;
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
    active_call: SupportVoiceCall | null;
    voice_queue?: VoiceQueueSnapshot | null;
    head: SupportChatHead;
    head_changed?: boolean;
  }>(bridge, "get_messages", {
    conversation_id: conversationId,
    mark_read: true
  });

  if (data.head_changed) {
    await mirrorSupportChatHead(data.head);
  }

  return {
    conversation: data.conversation,
    messages: data.messages,
    active_call: data.active_call ?? null,
    voice_queue: data.voice_queue ?? null
  };
}

type LineSupportImageAttachment = {
  name: string;
  mime_type: string;
  size_bytes: number;
  data_base64: string;
};

export async function sendLineSupportMessage(
  session: LineSupportSession,
  conversationId: string,
  rawMessage: string,
  attachment: LineSupportImageAttachment | null = null
) {
  const message = String(rawMessage ?? "").trim().slice(0, 4000);
  if (!message && !attachment) throw new Error("message_required");
  if (attachment) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(attachment.mime_type) ||
        !Number.isInteger(attachment.size_bytes) || attachment.size_bytes < 1 ||
        attachment.size_bytes > 2 * 1024 * 1024 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(attachment.data_base64) ||
        attachment.data_base64.length > Math.ceil(2 * 1024 * 1024 * 4 / 3) + 8) {
      throw new Error("attachment_invalid");
    }
  }

  const preview = attachment ? (message ? `[รูปภาพ] ${message}` : "[รูปภาพ]") : message;
  // The preview in the main database and the short-lived Communications
  // bridge do not depend on each other. Issuing them sequentially caused
  // an extra network round trip before every LINE message.
  const [previewResult, bridgeResult] = await Promise.allSettled([
    publishOptimisticSupportChatHead(conversationId, "store", preview),
    issueLineSupportBridge(session)
  ]);
  const optimistic = previewResult.status === "fulfilled" ? previewResult.value : null;
  try {
    if (previewResult.status === "rejected") throw previewResult.reason;
    if (bridgeResult.status === "rejected") throw bridgeResult.reason;
    const data = await callSupportChat<{
      message: Message;
      conversation: Conversation;
      head: SupportChatHead;
    }>(bridgeResult.value, "send_message", {
      conversation_id: conversationId,
      message,
      attachment
    });
    // The authoritative head is still mirrored before the sender receives
    // success; other IT and POS clients depend on this reliable update.
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


export async function performLineSupportVoiceAction(
  session: LineSupportSession,
  conversationId: string,
  action: "request_voice_call" | "accept_voice_call" | "cancel_voice_call" | "decline_voice_call" | "end_voice_call",
  callId?: string
) {
  const bridge = await issueLineSupportBridge(session);
  const data = await callSupportChat<{
    call: SupportVoiceCall;
    conversation: Conversation;
    head: SupportChatHead;
    already_active?: boolean;
    already_accepted?: boolean;
    queue?: VoiceQueueSnapshot | null;
  }>(bridge, action, {
    conversation_id: conversationId,
    call_id: callId ?? null,
    origin: "line_liff"
  });
  await mirrorSupportChatHead(data.head);
  return data;
}


export async function getLineSupportVoiceQueueStatus(
  session: LineSupportSession,
  conversationId: string,
  callId: string
) {
  const bridge = await issueLineSupportBridge(session);
  return callSupportChat<{
    call: SupportVoiceCall;
    queue: VoiceQueueSnapshot | null;
    conversation: Conversation;
    head: SupportChatHead;
  }>(bridge, "get_voice_queue_status", {
    conversation_id: conversationId,
    call_id: callId
  });
}

export async function getLineSupportVoiceIceConfig(
  session: LineSupportSession,
  conversationId: string,
  callId: string
) {
  const bridge = await issueLineSupportBridge(session);
  return callSupportChat<{
    ice_servers: RTCIceServer[];
    turn_enabled: boolean;
  }>(bridge, "get_voice_ice_config", {
    conversation_id: conversationId,
    call_id: callId
  });
}

export async function updateLineSupportVoiceState(
  session: LineSupportSession,
  conversationId: string,
  callId: string,
  state: "connecting" | "connected"
) {
  const bridge = await issueLineSupportBridge(session);
  const data = await callSupportChat<{
    call: SupportVoiceCall;
    conversation: Conversation;
    head: SupportChatHead;
  }>(bridge, "update_voice_call_state", {
    conversation_id: conversationId,
    call_id: callId,
    state
  });
  return data;
}
