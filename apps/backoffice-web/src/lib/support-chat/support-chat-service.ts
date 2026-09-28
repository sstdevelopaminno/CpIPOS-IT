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
  const profile = await db.from("users_profiles")
    .select("full_name,avatar_url,is_active,archived_at")
    .eq("id", context.auth.userId)
    .maybeSingle<{ full_name: string | null; avatar_url: string | null; is_active: boolean | null; archived_at: string | null }>();
  if (profile.error || !profile.data?.is_active || profile.data.archived_at) {
    throw new Error("IT support profile unavailable.");
  }

  const issued = await db.rpc("issue_support_chat_bridge_token", {
    p_user_id: context.auth.userId,
    p_actor_type: "it",
    p_tenant_id: null,
    p_branch_id: null,
    p_role: context.auth.platformRole,
    p_display_name: profile.data.full_name || (context.auth.platformRole === "it_admin" ? "IT Admin" : "IT Support"),
    p_avatar_url: profile.data.avatar_url
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
