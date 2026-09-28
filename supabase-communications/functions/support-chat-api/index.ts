import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Bridge = {
  payload?: Record<string, unknown>;
  signature?: string;
};

type RequestBody = {
  bridge?: Bridge;
  action?: string;
  data?: Record<string, unknown>;
};

type Actor = {
  v: number;
  uid: string;
  actor: "store" | "it";
  tenant_id: string | null;
  branch_id: string | null;
  role: string | null;
  name: string;
  avatar_url: string | null;
  exp: number;
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const uuid = (value: unknown) => {
  const v = text(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v) ? v : null;
};

function headFromConversation(row: Record<string, unknown>) {
  return {
    conversation_id: row.id,
    tenant_id: row.tenant_id,
    store_code: row.store_code,
    store_name: row.store_name,
    store_logo_url: row.store_logo_url ?? null,
    subject: row.subject,
    contact_name: row.contact_name,
    status: row.status,
    assigned_role: row.assigned_role ?? null,
    assigned_user_id: row.assigned_user_id ?? null,
    assigned_user_name: row.assigned_user_name ?? null,
    assigned_user_avatar_url: row.assigned_user_avatar_url ?? null,
    latest_message_at: row.last_message_at ?? row.created_at ?? null,
    latest_message_preview: row.last_message_preview ?? null,
    latest_sender_type: row.last_sender_type ?? null,
    unread_it_count: row.unread_it_count ?? 0,
    unread_store_count: row.unread_store_count ?? 0,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function canAccessConversation(actor: Actor, conversation: Record<string, unknown>) {
  if (actor.actor === "it") {
    return actor.role === "it_admin" || actor.role === "it_support";
  }
  return actor.actor === "store" && actor.tenant_id && actor.tenant_id === conversation.tenant_id;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: { code: "method_not_allowed" } });

  const body = await request.json().catch(() => null) as RequestBody | null;
  if (!body?.bridge?.payload || !body.bridge.signature || !body.action) {
    return json(400, { error: { code: "invalid_request", message: "Missing support-chat bridge authorization." } });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(503, { error: { code: "service_unavailable" } });

  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const verified = await db.rpc("verify_support_chat_bridge_token", {
    p_payload: body.bridge.payload,
    p_signature: body.bridge.signature
  });
  if (verified.error || !verified.data) {
    return json(401, { error: { code: "invalid_bridge_token", message: "Support chat authorization expired or invalid." } });
  }

  const actor = verified.data as Actor;
  const action = body.action;
  const input = body.data ?? {};

  try {
    if (action === "create_conversation") {
      if (actor.actor !== "store" || !actor.tenant_id) {
        return json(403, { error: { code: "store_required" } });
      }

      const subject = text(input.subject, 180);
      const contactName = text(input.contact_name, 120);
      const storeCode = text(input.store_code, 80);
      const storeName = text(input.store_name, 180);
      const storeLogoUrl = text(input.store_logo_url, 1000) || null;
      if (subject.length < 2 || contactName.length < 2 || !storeCode || !storeName) {
        return json(422, { error: { code: "conversation_fields_required", message: "Subject, contact name and store identity are required." } });
      }

      const open = await db
        .from("support_conversations")
        .select("*")
        .eq("tenant_id", actor.tenant_id)
        .neq("status", "closed")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (open.error) throw open.error;
      if (open.data) {
        return json(200, { data: { conversation: open.data, head: headFromConversation(open.data), already_open: true } });
      }

      const now = new Date().toISOString();
      const inserted = await db
        .from("support_conversations")
        .insert({
          tenant_id: actor.tenant_id,
          store_code: storeCode,
          store_name: storeName,
          store_logo_url: storeLogoUrl,
          subject,
          contact_name: contactName,
          status: "new",
          last_message_at: now,
          last_message_preview: "เริ่มการสนทนา",
          last_sender_type: "system",
          unread_it_count: 1,
          unread_store_count: 0,
          updated_at: now
        })
        .select("*")
        .single();

      if (inserted.error) throw inserted.error;

      await db.from("support_participants").insert({
        conversation_id: inserted.data.id,
        participant_type: "store",
        user_id: actor.uid,
        display_name: contactName,
        role: actor.role,
        avatar_url: storeLogoUrl
      });

      await db.from("support_messages").insert({
        conversation_id: inserted.data.id,
        sender_type: "system",
        sender_name: "CpIPOS Support",
        sender_role: "system",
        message_body: "เปิดคำขอสนทนา: " + subject
      });

      return json(201, { data: { conversation: inserted.data, head: headFromConversation(inserted.data), already_open: false } });
    }

    if (action === "list_conversations") {
      let query = db.from("support_conversations").select("*").order("last_message_at", { ascending: false }).limit(100);
      if (actor.actor === "store") {
        if (!actor.tenant_id) return json(403, { error: { code: "tenant_required" } });
        query = query.eq("tenant_id", actor.tenant_id);
      } else if (!["it_admin", "it_support"].includes(actor.role ?? "")) {
        return json(403, { error: { code: "it_role_required" } });
      }
      const result = await query;
      if (result.error) throw result.error;
      return json(200, { data: { conversations: result.data ?? [] } });
    }

    const conversationId = uuid(input.conversation_id);
    if (!conversationId) {
      return json(422, { error: { code: "conversation_id_invalid" } });
    }

    const current = await db.from("support_conversations").select("*").eq("id", conversationId).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return json(404, { error: { code: "conversation_not_found" } });
    if (!canAccessConversation(actor, current.data)) {
      return json(403, { error: { code: "conversation_forbidden" } });
    }

    if (action === "get_messages") {
      const messages = await db
        .from("support_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (messages.error) throw messages.error;
      return json(200, { data: { conversation: current.data, messages: messages.data ?? [] } });
    }

    if (action === "send_message") {
      const message = text(input.message, 4000);
      if (!message) return json(422, { error: { code: "message_required" } });
      if (current.data.status === "closed") return json(409, { error: { code: "conversation_closed" } });

      const senderType = actor.actor === "it" ? "it" : "store";
      const senderName = text(actor.name, 120) || (senderType === "it" ? "IT Support" : current.data.contact_name);
      const now = new Date().toISOString();

      const inserted = await db.from("support_messages").insert({
        conversation_id: conversationId,
        sender_type: senderType,
        sender_user_id: actor.uid,
        sender_name: senderName,
        sender_role: actor.role,
        sender_avatar_url: actor.avatar_url,
        message_body: message
      }).select("*").single();
      if (inserted.error) throw inserted.error;

      const update: Record<string, unknown> = {
        last_message_at: now,
        last_message_preview: message.slice(0, 180),
        last_sender_type: senderType,
        updated_at: now,
        status: senderType === "it" ? "waiting_store" : "waiting_it"
      };
      if (senderType === "it") {
        update.unread_store_count = Number(current.data.unread_store_count ?? 0) + 1;
        update.unread_it_count = 0;
      } else {
        update.unread_it_count = Number(current.data.unread_it_count ?? 0) + 1;
        update.unread_store_count = 0;
      }

      const updated = await db.from("support_conversations").update(update).eq("id", conversationId).select("*").single();
      if (updated.error) throw updated.error;
      return json(201, { data: { message: inserted.data, conversation: updated.data, head: headFromConversation(updated.data) } });
    }

    if (action === "claim_conversation") {
      if (actor.actor !== "it" || !["it_admin", "it_support"].includes(actor.role ?? "")) {
        return json(403, { error: { code: "it_role_required" } });
      }
      const now = new Date().toISOString();
      const updated = await db.from("support_conversations").update({
        assigned_role: actor.role,
        assigned_user_id: actor.uid,
        assigned_user_name: text(actor.name, 120) || "IT Support",
        assigned_user_avatar_url: actor.avatar_url,
        status: "in_progress",
        unread_it_count: 0,
        updated_at: now
      }).eq("id", conversationId).select("*").single();
      if (updated.error) throw updated.error;

      const existingParticipant = await db.from("support_participants")
        .select("id").eq("conversation_id", conversationId)
        .eq("participant_type", "it").eq("user_id", actor.uid).is("left_at", null)
        .limit(1).maybeSingle();
      if (!existingParticipant.data) {
        await db.from("support_participants").insert({
          conversation_id: conversationId,
          participant_type: "it",
          user_id: actor.uid,
          display_name: text(actor.name, 120) || "IT Support",
          role: actor.role,
          avatar_url: actor.avatar_url
        });
      }

      await db.from("support_messages").insert({
        conversation_id: conversationId,
        sender_type: "system",
        sender_name: "CpIPOS Support",
        sender_role: "system",
        message_body: (text(actor.name, 120) || "IT Support") + " รับเรื่องแล้ว"
      });

      return json(200, { data: { conversation: updated.data, head: headFromConversation(updated.data) } });
    }

    if (action === "mark_read") {
      const field = actor.actor === "it" ? "unread_it_count" : "unread_store_count";
      const updated = await db.from("support_conversations")
        .update({ [field]: 0, updated_at: new Date().toISOString() })
        .eq("id", conversationId).select("*").single();
      if (updated.error) throw updated.error;
      return json(200, { data: { conversation: updated.data, head: headFromConversation(updated.data) } });
    }

    if (action === "close_conversation") {
      if (actor.actor !== "it" || !["it_admin", "it_support"].includes(actor.role ?? "")) {
        return json(403, { error: { code: "it_role_required" } });
      }
      const now = new Date().toISOString();
      const updated = await db.from("support_conversations").update({
        status: "closed",
        closed_at: now,
        unread_it_count: 0,
        updated_at: now
      }).eq("id", conversationId).select("*").single();
      if (updated.error) throw updated.error;
      await db.from("support_messages").insert({
        conversation_id: conversationId,
        sender_type: "system",
        sender_name: "CpIPOS Support",
        sender_role: "system",
        message_body: "ปิดการสนทนาแล้ว"
      });
      return json(200, { data: { conversation: updated.data, head: headFromConversation(updated.data) } });
    }

    return json(422, { error: { code: "unsupported_action" } });
  } catch (error) {
    console.error("[support-chat-api]", error);
    return json(500, { error: { code: "support_chat_internal_error", message: "Support chat is temporarily unavailable." } });
  }
});
