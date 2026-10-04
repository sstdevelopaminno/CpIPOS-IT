import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import type { ItAdminContext } from "@/lib/it-admin-guard";

const COMMUNICATIONS_FUNCTION_URL =
  "https://wznixoeezgyhtwurcswb.supabase.co/functions/v1/support-chat-api";

export type SupportChatHead = {
  conversation_id: string;
  tenant_id: string;
  store_code: string;
  store_name: string;
  store_logo_url: string | null;
  subject: string;
  contact_name: string;
  status: string;
  assigned_role: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_user_avatar_url: string | null;
  latest_message_at: string | null;
  latest_message_preview: string | null;
  latest_sender_type: string | null;
  unread_it_count: number;
  unread_store_count: number;
  created_at: string;
  updated_at: string;
};

type BridgeToken = {
  payload: Record<string, unknown>;
  signature: string;
};

export async function issueItSupportChatBridge(context: ItAdminContext): Promise<BridgeToken> {
  if (!["it_admin", "it_support"].includes(context.auth.platformRole)) {
    throw new Error("IT support role required.");
  }
  const db = getSupabaseServiceClient();
  const profile = context.profile;
  if (!profile.is_active || profile.archived_at) {
    throw new Error("IT support profile unavailable.");
  }

  const issued = await db.rpc("issue_support_chat_bridge_token", {
    p_user_id: context.auth.userId,
    p_actor_type: "it",
    p_tenant_id: null,
    p_branch_id: null,
    p_role: context.auth.platformRole,
    p_display_name: profile.full_name || (context.auth.platformRole === "it_admin" ? "IT Admin" : "IT Support"),
    p_avatar_url: profile.avatar_url
  });
  if (issued.error || !issued.data) throw new Error("Unable to authorize support chat.");
  return issued.data as BridgeToken;
}

export async function callSupportChat<T>(
  bridge: BridgeToken,
  action: string,
  data: Record<string, unknown> = {}
): Promise<T> {
  const response = await fetch(COMMUNICATIONS_FUNCTION_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bridge, action, data }),
    cache: "no-store"
  });
  const body = await response.json().catch(() => null) as { data?: T; error?: { message?: string; code?: string } } | null;
  if (!response.ok || !body?.data) {
    const error = new Error(body?.error?.message || "Support chat is temporarily unavailable.") as Error & { status?: number; code?: string };
    error.status = response.status;
    error.code = body?.error?.code;
    throw error;
  }
  return body.data;
}

export async function mirrorSupportChatHead(head: SupportChatHead | null | undefined) {
  if (!head?.conversation_id) return;
  const db = getSupabaseServiceClient();
  const result = await db.from("support_chat_heads").upsert(head, { onConflict: "conversation_id" });
  if (result.error) throw new Error("Unable to update support chat notification state.");
}

export type OptimisticSupportChatHeadToken = {
  previous: SupportChatHead;
  optimisticUpdatedAt: string;
};

export async function publishOptimisticSupportChatHead(
  conversationId: string,
  senderType: "store" | "it",
  preview: string
): Promise<OptimisticSupportChatHeadToken | null> {
  const db = getSupabaseServiceClient();
  const current = await db.from("support_chat_heads")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle<SupportChatHead>();
  if (current.error) throw new Error("Unable to read support chat realtime state.");
  if (!current.data || current.data.status === "closed") return null;

  const now = new Date().toISOString();
  const patch = {
    latest_message_at: now,
    latest_message_preview: preview.slice(0, 180),
    latest_sender_type: senderType,
    status: senderType === "it" ? "waiting_store" : "waiting_it",
    unread_it_count: senderType === "store" ? Number(current.data.unread_it_count || 0) + 1 : 0,
    unread_store_count: senderType === "it" ? Number(current.data.unread_store_count || 0) + 1 : 0,
    updated_at: now
  };

  const updated = await db.from("support_chat_heads")
    .update(patch)
    .eq("conversation_id", conversationId)
    .neq("status", "closed")
    .select("*")
    .maybeSingle<SupportChatHead>();
  if (updated.error || !updated.data) throw new Error("Unable to publish support chat realtime preview.");

  return { previous: current.data, optimisticUpdatedAt: now };
}

export async function rollbackOptimisticSupportChatHead(token: OptimisticSupportChatHeadToken | null) {
  if (!token) return;
  const db = getSupabaseServiceClient();
  const previous = token.previous;
  await db.from("support_chat_heads")
    .update({
      tenant_id: previous.tenant_id,
      store_code: previous.store_code,
      store_name: previous.store_name,
      store_logo_url: previous.store_logo_url,
      subject: previous.subject,
      contact_name: previous.contact_name,
      status: previous.status,
      assigned_role: previous.assigned_role,
      assigned_user_id: previous.assigned_user_id,
      assigned_user_name: previous.assigned_user_name,
      assigned_user_avatar_url: previous.assigned_user_avatar_url,
      latest_message_at: previous.latest_message_at,
      latest_message_preview: previous.latest_message_preview,
      latest_sender_type: previous.latest_sender_type,
      unread_it_count: previous.unread_it_count,
      unread_store_count: previous.unread_store_count,
      created_at: previous.created_at,
      updated_at: previous.updated_at
    })
    .eq("conversation_id", previous.conversation_id)
    .eq("updated_at", token.optimisticUpdatedAt);
}

export async function deleteSupportChatHead(conversationId: string) {
  const db = getSupabaseServiceClient();
  const result = await db.from("support_chat_heads").delete().eq("conversation_id", conversationId);
  if (result.error) throw new Error("Unable to remove support chat notification state.");
}

export async function listItSupportChatHeads() {
  const db = getSupabaseServiceClient();
  const result = await db.from("support_chat_heads")
    .select("*")
    .order("latest_message_at", { ascending: false, nullsFirst: false })
    .limit(250)
    .returns<SupportChatHead[]>();
  if (result.error) throw new Error("Unable to load support chat inbox.");
  return result.data ?? [];
}
