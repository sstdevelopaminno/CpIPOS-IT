import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type Bridge = { payload?: Record<string, unknown>; signature?: string };
type RequestBody = { bridge?: Bridge; action?: string; data?: Record<string, unknown> };
type Actor = {
  v: number;
  uid: string;
  actor: "store" | "it";
  tenant_id: string | null;
  branch_id: string | null;
  role: string | null;
  name: string;
  avatar_url: string | null;
};

const IMAGE_BUCKET = "support-chat-images";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const CONVERSATION_STATUSES = new Set(["in_progress", "waiting_store", "waiting_it", "closed"]);
const ACTIVE_CALL_STATUSES = ["requested", "accepted", "connecting", "connected"];
const CALL_ORIGINS = new Set(["line_liff", "it_web", "support_mobile", "cpipos_app", "web"]);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
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
  if (actor.actor === "it") return actor.role === "it_admin" || actor.role === "it_support";
  return actor.actor === "store" && actor.tenant_id && actor.tenant_id === conversation.tenant_id;
}

function conversationForActor(row: Record<string, unknown>, actor: Actor) {
  if (actor.actor === "it") return row;
  const safe = { ...row };
  delete safe.internal_note;
  return safe;
}

function extensionForMime(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function decodeBase64(value: unknown) {
  const source = text(value, Math.ceil(MAX_IMAGE_BYTES * 1.5) + 512);
  if (!source) return null;
  const clean = source.includes(",") ? source.slice(source.indexOf(",") + 1) : source;
  let binary = "";
  try {
    binary = atob(clean);
  } catch {
    return null;
  }
  if (!binary.length || binary.length > MAX_IMAGE_BYTES) return null;
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function cleanupAttachments(db: ReturnType<typeof createClient>, conversationId: string) {
  const active = await db.from("support_attachments")
    .select("id,storage_bucket,storage_path")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null);
  if (active.error) throw active.error;
  const rows = active.data ?? [];
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = String(row.storage_bucket || IMAGE_BUCKET);
    groups.set(bucket, [...(groups.get(bucket) ?? []), String(row.storage_path)]);
  }
  for (const [bucket, paths] of groups) {
    if (!paths.length) continue;
    const removed = await db.storage.from(bucket).remove(paths);
    if (removed.error) throw removed.error;
  }
  if (rows.length) {
    const marked = await db.from("support_attachments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .is("deleted_at", null);
    if (marked.error) throw marked.error;
  }
}

async function messagesWithAttachments(
  db: ReturnType<typeof createClient>,
  conversationId: string
) {
  const messages = await db.from("support_messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (messages.error) throw messages.error;

  const attachments = await db.from("support_attachments")
    .select("id,message_id,storage_bucket,storage_path,original_name,mime_type,size_bytes,created_at")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (attachments.error) throw attachments.error;

  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const attachment of attachments.data ?? []) {
    const signed = await db.storage
      .from(String(attachment.storage_bucket || IMAGE_BUCKET))
      .createSignedUrl(String(attachment.storage_path), 15 * 60);
    if (signed.error || !signed.data?.signedUrl) continue;
    const entry = {
      id: attachment.id,
      original_name: attachment.original_name,
      mime_type: attachment.mime_type,
      size_bytes: attachment.size_bytes,
      url: signed.data.signedUrl
    };
    const key = String(attachment.message_id);
    grouped.set(key, [...(grouped.get(key) ?? []), entry]);
  }

  return (messages.data ?? []).map((message) => ({
    ...message,
    attachments: grouped.get(String(message.id)) ?? []
  }));
}


async function activeCallForConversation(
  db: ReturnType<typeof createClient>,
  conversationId: string
) {
  const result = await db.from("support_call_sessions")
    .select("*")
    .eq("conversation_id", conversationId)
    .in("status", ACTIVE_CALL_STATUSES)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

function callForActor(row: Record<string, unknown> | null, actor: Actor) {
  if (!row) return null;
  if (actor.actor === "it") return row;
  const safe = { ...row };
  delete safe.requested_by_user_id;
  delete safe.assigned_it_user_id;
  return safe;
}

async function appendCallSystemEvent(
  db: ReturnType<typeof createClient>,
  conversation: Record<string, unknown>,
  message: string,
  audience: "it" | "store",
  extraPatch: Record<string, unknown> = {}
) {
  const conversationId = String(conversation.id);
  const now = new Date().toISOString();

  const inserted = await db.from("support_messages").insert({
    conversation_id: conversationId,
    sender_type: "system",
    sender_name: "CpIPOS Support",
    sender_role: "system",
    message_body: message
  });
  if (inserted.error) throw inserted.error;

  const patch: Record<string, unknown> = {
    last_message_at: now,
    last_message_preview: message.slice(0, 180),
    last_sender_type: "system",
    updated_at: now,
    status: audience === "it" ? "waiting_it" : "waiting_store",
    unread_it_count: audience === "it" ? Number(conversation.unread_it_count ?? 0) + 1 : 0,
    unread_store_count: audience === "store" ? Number(conversation.unread_store_count ?? 0) + 1 : 0,
    ...extraPatch
  };

  const updated = await db.from("support_conversations")
    .update(patch)
    .eq("id", conversationId)
    .select("*")
    .single();
  if (updated.error) throw updated.error;
  return updated.data as Record<string, unknown>;
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

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
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
      if (actor.actor !== "store" || !actor.tenant_id) return json(403, { error: { code: "store_required" } });

      const subject = text(input.subject, 180);
      const contactName = text(input.contact_name, 120);
      const storeCode = text(input.store_code, 80);
      const storeName = text(input.store_name, 180);
      const storeLogoUrl = text(input.store_logo_url, 1000) || null;
      if (subject.length < 2 || contactName.length < 2 || !storeCode || !storeName) {
        return json(422, { error: { code: "conversation_fields_required", message: "Subject, contact name and store identity are required." } });
      }

      const open = await db.from("support_conversations").select("*")
        .eq("tenant_id", actor.tenant_id).neq("status", "closed")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (open.error) throw open.error;
      if (open.data) {
        return json(200, { data: { conversation: conversationForActor(open.data, actor), head: headFromConversation(open.data), already_open: true } });
      }

      const now = new Date().toISOString();
      const inserted = await db.from("support_conversations").insert({
        tenant_id: actor.tenant_id,
        store_code: storeCode,
        store_name: storeName,
        store_logo_url: storeLogoUrl,
        subject,
        contact_name: contactName,
        status: "new",
        last_message_at: now,
        last_message_preview: `เริ่มแชท: ${subject}`,
        last_sender_type: "store",
        unread_it_count: 1,
        unread_store_count: 0,
        updated_at: now
      }).select("*").single();
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
        message_body: "CpIPOS Support ให้บริการแล้วครับ รบกวนคุณลูกค้าแจ้งปัญหาของท่านลงได้เลย ฝ่าย Support จะตอบกลับท่านโดยเร็วที่สุด"
      });

      return json(201, {
        data: { conversation: conversationForActor(inserted.data, actor), head: headFromConversation(inserted.data), already_open: false }
      });
    }

    if (action === "list_conversations") {
      let query = db.from("support_conversations").select("*").order("last_message_at", { ascending: false }).limit(250);
      if (actor.actor === "store") {
        if (!actor.tenant_id) return json(403, { error: { code: "tenant_required" } });
        query = query.eq("tenant_id", actor.tenant_id);
      } else if (!["it_admin", "it_support"].includes(actor.role ?? "")) {
        return json(403, { error: { code: "it_role_required" } });
      }
      const result = await query;
      if (result.error) throw result.error;
      return json(200, { data: { conversations: (result.data ?? []).map((row) => conversationForActor(row, actor)) } });
    }

    const conversationId = uuid(input.conversation_id);
    if (!conversationId) return json(422, { error: { code: "conversation_id_invalid" } });

    const current = await db.from("support_conversations").select("*").eq("id", conversationId).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return json(404, { error: { code: "conversation_not_found" } });
    if (!canAccessConversation(actor, current.data)) return json(403, { error: { code: "conversation_forbidden" } });

    if (action === "get_messages") {
      let conversation = current.data;
      let headChanged = false;
      let claimed = false;

      // Collapse auto-claim + mark-read into this request. The previous web
      // routes made up to three additional Edge Function round trips before
      // showing a newly received message.
      if (
        actor.actor === "it" &&
        (actor.role === "it_admin" || actor.role === "it_support") &&
        !conversation.assigned_user_id &&
        conversation.status !== "closed" &&
        input.auto_claim === true
      ) {
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
        conversation = updated.data;
        headChanged = true;
        claimed = true;

        const existingParticipant = await db.from("support_participants").select("id")
          .eq("conversation_id", conversationId).eq("participant_type", "it")
          .eq("user_id", actor.uid).is("left_at", null).limit(1).maybeSingle();
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
      } else if (input.mark_read === true) {
        const field = actor.actor === "it" ? "unread_it_count" : "unread_store_count";
        if (Number(conversation[field] ?? 0) > 0) {
          const updated = await db.from("support_conversations")
            .update({ [field]: 0, updated_at: new Date().toISOString() })
            .eq("id", conversationId).select("*").single();
          if (updated.error) throw updated.error;
          conversation = updated.data;
          headChanged = true;
        }
      }

      const messages = await messagesWithAttachments(db, conversationId);
      const activeCall = await activeCallForConversation(db, conversationId);
      return json(200, {
        data: {
          conversation: conversationForActor(conversation, actor),
          messages,
          active_call: callForActor(activeCall, actor),
          head: headFromConversation(conversation),
          head_changed: headChanged,
          claimed
        }
      });
    }

    if (action === "send_message") {
      const message = text(input.message, 4000);
      const attachment = input.attachment && typeof input.attachment === "object"
        ? input.attachment as Record<string, unknown>
        : null;
      if (!message && !attachment) return json(422, { error: { code: "message_required" } });
      if (current.data.status === "closed") return json(409, { error: { code: "conversation_closed" } });

      const senderType = actor.actor === "it" ? "it" : "store";
      const senderName = text(actor.name, 120) || (senderType === "it" ? "IT Support" : String(current.data.contact_name));
      const now = new Date().toISOString();
      const messageId = crypto.randomUUID();
      let attachmentRow: Record<string, unknown> | null = null;
      let uploadedPath: string | null = null;

      if (attachment) {
        const mimeType = text(attachment.mime_type, 80);
        const originalName = text(attachment.name, 180) || "image";
        const declaredSize = Number(attachment.size_bytes ?? 0);
        const bytes = decodeBase64(attachment.data_base64);
        if (!IMAGE_MIME.has(mimeType) || !bytes || declaredSize !== bytes.length || bytes.length > MAX_IMAGE_BYTES) {
          return json(422, { error: { code: "attachment_invalid", message: "รองรับเฉพาะ JPG/PNG/WEBP ขนาดไม่เกิน 2 MB" } });
        }
        const attachmentId = crypto.randomUUID();
        uploadedPath = `${conversationId}/${attachmentId}.${extensionForMime(mimeType)}`;
        const uploaded = await db.storage.from(IMAGE_BUCKET).upload(uploadedPath, bytes, {
          contentType: mimeType,
          cacheControl: "3600",
          upsert: false
        });
        if (uploaded.error) throw uploaded.error;
        attachmentRow = {
          id: attachmentId,
          conversation_id: conversationId,
          message_id: messageId,
          storage_bucket: IMAGE_BUCKET,
          storage_path: uploadedPath,
          original_name: originalName,
          mime_type: mimeType,
          size_bytes: bytes.length
        };
      }

      try {
        const inserted = await db.from("support_messages").insert({
          id: messageId,
          conversation_id: conversationId,
          sender_type: senderType,
          sender_user_id: actor.uid,
          sender_name: senderName,
          sender_role: actor.role,
          sender_avatar_url: actor.avatar_url,
          message_body: message || "ส่งรูปภาพ"
        }).select("*").single();
        if (inserted.error) throw inserted.error;

        let sentAttachments: Array<Record<string, unknown>> = [];
        if (attachmentRow) {
          const attachmentInserted = await db.from("support_attachments").insert(attachmentRow).select("*").single();
          if (attachmentInserted.error) throw attachmentInserted.error;
          const signed = await db.storage
            .from(String(attachmentInserted.data.storage_bucket || IMAGE_BUCKET))
            .createSignedUrl(String(attachmentInserted.data.storage_path), 15 * 60);
          if (!signed.error && signed.data?.signedUrl) {
            sentAttachments = [{
              id: attachmentInserted.data.id,
              original_name: attachmentInserted.data.original_name,
              mime_type: attachmentInserted.data.mime_type,
              size_bytes: attachmentInserted.data.size_bytes,
              url: signed.data.signedUrl
            }];
          }
        }

        const preview = attachmentRow
          ? message ? `[รูปภาพ] ${message}`.slice(0, 180) : "[รูปภาพ]"
          : message.slice(0, 180);
        const update: Record<string, unknown> = {
          last_message_at: now,
          last_message_preview: preview,
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

        const updated = await db.from("support_conversations").update(update)
          .eq("id", conversationId).select("*").single();
        if (updated.error) throw updated.error;

        // Return the row we just inserted. Reloading up to 500 historical
        // messages and signing every attachment here made each send slower as
        // the conversation grew.
        const sent = { ...inserted.data, attachments: sentAttachments };
        return json(201, {
          data: { message: sent, conversation: conversationForActor(updated.data, actor), head: headFromConversation(updated.data) }
        });
      } catch (error) {
        if (uploadedPath) await db.storage.from(IMAGE_BUCKET).remove([uploadedPath]).catch(() => null);
        throw error;
      }
    }


    if (action === "request_voice_call") {
      if (actor.actor !== "store" || !actor.tenant_id) {
        return json(403, { error: { code: "store_required" } });
      }
      if (current.data.status === "closed") {
        return json(409, { error: { code: "conversation_closed", message: "การสนทนานี้จบแล้ว กรุณาเริ่มแชทใหม่" } });
      }

      const existing = await activeCallForConversation(db, conversationId);
      if (existing) {
        return json(200, {
          data: {
            call: callForActor(existing, actor),
            conversation: conversationForActor(current.data, actor),
            head: headFromConversation(current.data),
            already_active: true
          }
        });
      }

      const originInput = text(input.origin, 40);
      const origin = CALL_ORIGINS.has(originInput) ? originInput : "web";
      const inserted = await db.from("support_call_sessions").insert({
        conversation_id: conversationId,
        tenant_id: current.data.tenant_id,
        direction: "store_to_it",
        requested_by_type: "store",
        requested_by_user_id: actor.uid,
        requested_by_name: text(actor.name, 120) || String(current.data.contact_name),
        request_origin: origin,
        status: "requested"
      }).select("*").single();
      if (inserted.error) {
        if (inserted.error.code === "23505") {
          const active = await activeCallForConversation(db, conversationId);
          if (active) {
            return json(200, {
              data: {
                call: callForActor(active, actor),
                conversation: conversationForActor(current.data, actor),
                head: headFromConversation(current.data),
                already_active: true
              }
            });
          }
        }
        throw inserted.error;
      }

      const updated = await appendCallSystemEvent(
        db,
        current.data,
        "📞 ลูกค้าขอคุยด้วยเสียง",
        "it"
      );
      return json(201, {
        data: {
          call: callForActor(inserted.data, actor),
          conversation: conversationForActor(updated, actor),
          head: headFromConversation(updated),
          already_active: false
        }
      });
    }

    if (action === "invite_voice_call") {
      if (actor.actor !== "it" || !["it_admin", "it_support"].includes(actor.role ?? "")) {
        return json(403, { error: { code: "it_role_required" } });
      }
      if (current.data.status === "closed") {
        return json(409, { error: { code: "conversation_closed", message: "การสนทนานี้จบแล้ว" } });
      }

      const existing = await activeCallForConversation(db, conversationId);
      if (existing) {
        return json(200, {
          data: {
            call: callForActor(existing, actor),
            conversation: current.data,
            head: headFromConversation(current.data),
            already_active: true
          }
        });
      }

      const inserted = await db.from("support_call_sessions").insert({
        conversation_id: conversationId,
        tenant_id: current.data.tenant_id,
        direction: "it_to_store",
        requested_by_type: "it",
        requested_by_user_id: actor.uid,
        requested_by_name: text(actor.name, 120) || "IT Support",
        request_origin: "it_web",
        status: "requested",
        assigned_it_user_id: actor.uid,
        assigned_it_name: text(actor.name, 120) || "IT Support",
        assigned_it_role: actor.role
      }).select("*").single();
      if (inserted.error) {
        if (inserted.error.code === "23505") {
          const active = await activeCallForConversation(db, conversationId);
          if (active) {
            return json(200, {
              data: {
                call: callForActor(active, actor),
                conversation: current.data,
                head: headFromConversation(current.data),
                already_active: true
              }
            });
          }
        }
        throw inserted.error;
      }

      const updated = await appendCallSystemEvent(
        db,
        current.data,
        "📞 ฝ่าย Support ขอคุยกับคุณด้วยเสียง",
        "store"
      );
      return json(201, {
        data: {
          call: callForActor(inserted.data, actor),
          conversation: updated,
          head: headFromConversation(updated),
          already_active: false
        }
      });
    }

    if (action === "accept_voice_call") {
      const callId = uuid(input.call_id);
      if (!callId) return json(422, { error: { code: "call_id_invalid" } });

      const selected = await db.from("support_call_sessions").select("*")
        .eq("id", callId).eq("conversation_id", conversationId).maybeSingle();
      if (selected.error) throw selected.error;
      if (!selected.data) return json(404, { error: { code: "call_not_found" } });

      if (selected.data.status === "accepted") {
        const sameIt = selected.data.direction === "store_to_it" &&
          actor.actor === "it" && selected.data.assigned_it_user_id === actor.uid;
        const storeAccepted = selected.data.direction === "it_to_store" && actor.actor === "store";
        if (sameIt || storeAccepted) {
          return json(200, {
            data: {
              call: callForActor(selected.data, actor),
              conversation: conversationForActor(current.data, actor),
              head: headFromConversation(current.data),
              already_accepted: true
            }
          });
        }
      }
      if (selected.data.status !== "requested") {
        return json(409, { error: { code: "call_not_requesting", message: "คำขอคุยด้วยเสียงนี้ไม่อยู่ในสถานะรอรับแล้ว" } });
      }

      const now = new Date().toISOString();

      if (selected.data.direction === "store_to_it") {
        if (actor.actor !== "it" || !["it_admin", "it_support"].includes(actor.role ?? "")) {
          return json(403, { error: { code: "it_role_required" } });
        }

        const accepted = await db.from("support_call_sessions").update({
          status: "accepted",
          assigned_it_user_id: actor.uid,
          assigned_it_name: text(actor.name, 120) || "IT Support",
          assigned_it_role: actor.role,
          accepted_at: now,
          updated_at: now
        }).eq("id", callId).eq("status", "requested").is("assigned_it_user_id", null)
          .select("*").maybeSingle();
        if (accepted.error) {
          if (accepted.error.code === "23505") {
            return json(409, { error: { code: "it_already_in_call", message: "บัญชี Support นี้มีคำขอเสียงที่รับอยู่แล้ว" } });
          }
          throw accepted.error;
        }
        if (!accepted.data) {
          const latest = await db.from("support_call_sessions").select("*").eq("id", callId).single();
          if (latest.error) throw latest.error;
          return json(409, {
            error: {
              code: "call_already_claimed",
              message: latest.data.assigned_it_name
                ? "คำขอนี้มีผู้รับแล้วโดย " + latest.data.assigned_it_name
                : "คำขอนี้มีผู้รับแล้ว"
            }
          });
        }

        const updated = await appendCallSystemEvent(
          db,
          current.data,
          "📞 " + (text(actor.name, 120) || "IT Support") + " รับคำขอคุยด้วยเสียงแล้ว",
          "store",
          {
            status: "in_progress",
            assigned_role: actor.role,
            assigned_user_id: actor.uid,
            assigned_user_name: text(actor.name, 120) || "IT Support",
            assigned_user_avatar_url: actor.avatar_url
          }
        );
        return json(200, {
          data: { call: accepted.data, conversation: updated, head: headFromConversation(updated) }
        });
      }

      if (actor.actor !== "store" || actor.tenant_id !== current.data.tenant_id) {
        return json(403, { error: { code: "store_required" } });
      }

      const accepted = await db.from("support_call_sessions").update({
        status: "accepted",
        accepted_at: now,
        updated_at: now
      }).eq("id", callId).eq("status", "requested").select("*").maybeSingle();
      if (accepted.error) throw accepted.error;
      if (!accepted.data) return json(409, { error: { code: "call_already_answered" } });

      const updated = await appendCallSystemEvent(
        db,
        current.data,
        "📞 ลูกค้ารับคำเชิญคุยด้วยเสียงแล้ว",
        "it",
        { status: "in_progress" }
      );
      return json(200, {
        data: {
          call: callForActor(accepted.data, actor),
          conversation: conversationForActor(updated, actor),
          head: headFromConversation(updated)
        }
      });
    }

    if (action === "cancel_voice_call") {
      const callId = uuid(input.call_id);
      if (!callId) return json(422, { error: { code: "call_id_invalid" } });
      const selected = await db.from("support_call_sessions").select("*")
        .eq("id", callId).eq("conversation_id", conversationId).maybeSingle();
      if (selected.error) throw selected.error;
      if (!selected.data) return json(404, { error: { code: "call_not_found" } });
      if (selected.data.status !== "requested") {
        return json(409, { error: { code: "call_not_cancellable", message: "คำขอนี้ไม่ได้อยู่ในสถานะรอรับแล้ว" } });
      }

      const requesterIsStore = selected.data.direction === "store_to_it" && actor.actor === "store";
      const requesterIsIt = selected.data.direction === "it_to_store" && actor.actor === "it" &&
        selected.data.requested_by_user_id === actor.uid;
      if (!requesterIsStore && !requesterIsIt) {
        return json(403, { error: { code: "call_cancel_forbidden" } });
      }

      const now = new Date().toISOString();
      const cancelled = await db.from("support_call_sessions").update({
        status: "cancelled",
        ended_at: now,
        end_reason: "requester_cancelled",
        updated_at: now
      }).eq("id", callId).eq("status", "requested").select("*").maybeSingle();
      if (cancelled.error) throw cancelled.error;
      if (!cancelled.data) return json(409, { error: { code: "call_already_answered" } });

      const audience = actor.actor === "store" ? "it" : "store";
      const message = actor.actor === "store"
        ? "📞 ลูกค้ายกเลิกคำขอคุยด้วยเสียง"
        : "📞 ฝ่าย Support ยกเลิกคำเชิญคุยด้วยเสียง";
      const updated = await appendCallSystemEvent(db, current.data, message, audience);
      return json(200, {
        data: {
          call: callForActor(cancelled.data, actor),
          conversation: conversationForActor(updated, actor),
          head: headFromConversation(updated)
        }
      });
    }

    if (action === "decline_voice_call") {
      const callId = uuid(input.call_id);
      if (!callId) return json(422, { error: { code: "call_id_invalid" } });
      const selected = await db.from("support_call_sessions").select("*")
        .eq("id", callId).eq("conversation_id", conversationId).maybeSingle();
      if (selected.error) throw selected.error;
      if (!selected.data) return json(404, { error: { code: "call_not_found" } });
      if (
        selected.data.direction !== "it_to_store" ||
        actor.actor !== "store" ||
        actor.tenant_id !== current.data.tenant_id
      ) {
        return json(403, { error: { code: "call_decline_forbidden" } });
      }
      if (selected.data.status !== "requested") {
        return json(409, { error: { code: "call_not_requesting" } });
      }

      const now = new Date().toISOString();
      const declined = await db.from("support_call_sessions").update({
        status: "declined",
        ended_at: now,
        end_reason: "store_declined",
        updated_at: now
      }).eq("id", callId).eq("status", "requested").select("*").maybeSingle();
      if (declined.error) throw declined.error;
      if (!declined.data) return json(409, { error: { code: "call_already_answered" } });

      const updated = await appendCallSystemEvent(
        db,
        current.data,
        "📞 ลูกค้าปฏิเสธคำเชิญคุยด้วยเสียง",
        "it"
      );
      return json(200, {
        data: {
          call: callForActor(declined.data, actor),
          conversation: conversationForActor(updated, actor),
          head: headFromConversation(updated)
        }
      });
    }

    if (action === "end_voice_call") {
      const callId = uuid(input.call_id);
      if (!callId) return json(422, { error: { code: "call_id_invalid" } });
      const selected = await db.from("support_call_sessions").select("*")
        .eq("id", callId).eq("conversation_id", conversationId).maybeSingle();
      if (selected.error) throw selected.error;
      if (!selected.data) return json(404, { error: { code: "call_not_found" } });
      if (!["accepted", "connecting", "connected"].includes(String(selected.data.status))) {
        return json(409, { error: { code: "call_not_active", message: "คำขอเสียงนี้ไม่ได้อยู่ในสถานะใช้งาน" } });
      }

      const storeAllowed = actor.actor === "store" && actor.tenant_id === current.data.tenant_id;
      const itAllowed = actor.actor === "it" && selected.data.assigned_it_user_id === actor.uid;
      if (!storeAllowed && !itAllowed) {
        return json(403, { error: { code: "call_end_forbidden" } });
      }

      const now = new Date().toISOString();
      const ended = await db.from("support_call_sessions").update({
        status: "ended",
        ended_at: now,
        end_reason: actor.actor === "store" ? "store_ended" : "it_ended",
        updated_at: now
      }).eq("id", callId)
        .in("status", ["accepted", "connecting", "connected"])
        .select("*").maybeSingle();
      if (ended.error) throw ended.error;
      if (!ended.data) return json(409, { error: { code: "call_already_ended" } });

      const updated = await appendCallSystemEvent(
        db,
        current.data,
        "📞 สิ้นสุดคำขอคุยด้วยเสียง",
        actor.actor === "store" ? "it" : "store",
        { status: "in_progress" }
      );
      return json(200, {
        data: {
          call: callForActor(ended.data, actor),
          conversation: conversationForActor(updated, actor),
          head: headFromConversation(updated)
        }
      });
    }

    if (action === "claim_conversation") {
      if (actor.actor !== "it" || !["it_admin", "it_support"].includes(actor.role ?? "")) {
        return json(403, { error: { code: "it_role_required" } });
      }
      if (current.data.status === "closed") return json(409, { error: { code: "conversation_closed" } });
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

      const existingParticipant = await db.from("support_participants").select("id")
        .eq("conversation_id", conversationId).eq("participant_type", "it")
        .eq("user_id", actor.uid).is("left_at", null).limit(1).maybeSingle();
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
      if (Number(current.data[field] ?? 0) === 0) {
        return json(200, { data: { conversation: conversationForActor(current.data, actor), head: headFromConversation(current.data) } });
      }
      const updated = await db.from("support_conversations")
        .update({ [field]: 0, updated_at: new Date().toISOString() })
        .eq("id", conversationId).select("*").single();
      if (updated.error) throw updated.error;
      return json(200, { data: { conversation: conversationForActor(updated.data, actor), head: headFromConversation(updated.data) } });
    }

    if (action === "set_status") {
      if (actor.actor !== "it" || !["it_admin", "it_support"].includes(actor.role ?? "")) {
        return json(403, { error: { code: "it_role_required" } });
      }
      const nextStatus = text(input.status, 30);
      if (!CONVERSATION_STATUSES.has(nextStatus)) return json(422, { error: { code: "status_invalid" } });
      // Closing is idempotent. A retry can arrive after the first close already
      // committed (for example when the UI retries after a slow network response).
      if (current.data.status === "closed") {
        if (nextStatus === "closed") {
          return json(200, { data: { conversation: current.data, head: headFromConversation(current.data), already_closed: true } });
        }
        return json(409, { error: { code: "conversation_closed" } });
      }
      if (nextStatus === "closed") {
        const now = new Date().toISOString();
        await db.from("support_call_sessions").update({
          status: "ended",
          ended_at: now,
          end_reason: "conversation_closed",
          updated_at: now
        }).eq("conversation_id", conversationId).in("status", ACTIVE_CALL_STATUSES);
        await cleanupAttachments(db, conversationId);
      }
      const now = new Date().toISOString();
      const updated = await db.from("support_conversations").update({
        status: nextStatus,
        closed_at: nextStatus === "closed" ? now : null,
        unread_it_count: nextStatus === "closed" ? 0 : current.data.unread_it_count,
        updated_at: now
      }).eq("id", conversationId).select("*").single();
      if (updated.error) throw updated.error;
      if (nextStatus === "closed") {
        await db.from("support_messages").insert({
          conversation_id: conversationId,
          sender_type: "system",
          sender_name: "CpIPOS Support",
          sender_role: "system",
          message_body: "ปิดการสนทนาแล้ว · รูปภาพถูกลบออกจากระบบ"
        });
      }
      return json(200, { data: { conversation: updated.data, head: headFromConversation(updated.data) } });
    }

    if (action === "update_note") {
      if (actor.actor !== "it" || !["it_admin", "it_support"].includes(actor.role ?? "")) {
        return json(403, { error: { code: "it_role_required" } });
      }
      const note = text(input.internal_note, 3000);
      const updated = await db.from("support_conversations")
        .update({ internal_note: note || null, updated_at: new Date().toISOString() })
        .eq("id", conversationId).select("*").single();
      if (updated.error) throw updated.error;
      return json(200, { data: { conversation: updated.data, head: headFromConversation(updated.data) } });
    }

    if (action === "close_conversation") {
      if (current.data.status === "closed") {
        return json(200, {
          data: {
            conversation: conversationForActor(current.data, actor),
            head: headFromConversation(current.data),
            already_closed: true
          }
        });
      }
      const now = new Date().toISOString();
      await db.from("support_call_sessions").update({
        status: "ended",
        ended_at: now,
        end_reason: "conversation_closed",
        updated_at: now
      }).eq("conversation_id", conversationId).in("status", ACTIVE_CALL_STATUSES);
      await cleanupAttachments(db, conversationId);
      const updated = await db.from("support_conversations").update({
        status: "closed",
        closed_at: now,
        unread_it_count: 0,
        unread_store_count: 0,
        updated_at: now
      }).eq("id", conversationId).select("*").single();
      if (updated.error) throw updated.error;
      await db.from("support_messages").insert({
        conversation_id: conversationId,
        sender_type: "system",
        sender_name: "CpIPOS Support",
        sender_role: "system",
        message_body: "ปิดการสนทนาแล้ว · รูปภาพถูกลบออกจากระบบ"
      });
      return json(200, { data: { conversation: conversationForActor(updated.data, actor), head: headFromConversation(updated.data) } });
    }

    if (action === "delete_conversation") {
      if (actor.actor !== "it" || actor.role !== "it_support") {
        return json(403, { error: { code: "it_support_required" } });
      }
      if (current.data.status !== "closed") {
        return json(409, { error: { code: "close_before_delete", message: "กรุณาปิดการสนทนาก่อนลบถาวร" } });
      }
      await cleanupAttachments(db, conversationId);
      const tenantId = current.data.tenant_id;
      const deleted = await db.from("support_conversations").delete().eq("id", conversationId);
      if (deleted.error) throw deleted.error;
      return json(200, { data: { deleted: true, conversation_id: conversationId, tenant_id: tenantId } });
    }

    return json(422, { error: { code: "unsupported_action" } });
  } catch (error) {
    console.error("[support-chat-api]", error);
    return json(500, { error: { code: "support_chat_internal_error", message: "Support chat is temporarily unavailable." } });
  }
});
