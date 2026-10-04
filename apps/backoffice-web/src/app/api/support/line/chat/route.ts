import { fail, ok } from "@/lib/http";
import {
  LineSupportError,
  clearLineSupportSession,
  requireLineSupportSession
} from "@/lib/support-chat/line-support-auth";
import {
  closeLineSupportConversation,
  loadLineSupportConversation,
  openLineSupportConversation,
  sendLineSupportMessage
} from "@/lib/support-chat/line-support-chat-service";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof LineSupportError) {
    return fail(error.code, error.message, error.status);
  }
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message === "message_required") {
    return fail("message_required", "กรุณาพิมพ์ข้อความ", 422);
  }
  console.error("[line-support-chat]", message);
  return fail("line_support_chat_unavailable", "แชท Support ไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่", 503);
}

export async function GET(request: Request) {
  try {
    const session = await requireLineSupportSession();
    const url = new URL(request.url);
    const conversationId = String(url.searchParams.get("conversation_id") ?? "").trim();
    if (!conversationId) {
      return fail("conversation_id_required", "ไม่พบห้องสนทนา", 422);
    }

    const data = await loadLineSupportConversation(session, conversationId);
    return ok(data);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireLineSupportSession();
    const body = await request.json().catch(() => null) as {
      action?: string;
      conversation_id?: string;
      message?: string;
    } | null;
    const action = String(body?.action ?? "").trim();
    const ip = getClientIpAddress(request);

    if (action === "open") {
      const rate = await enforceRateLimit({
        namespace: "line-support-chat-open",
        key: [session.bindingId, session.tenantId, ip].join(":"),
        max: 5,
        windowMs: 10 * 60_000,
        failClosedOnBackendError: true
      });
      if (!rate.ok) return fail("chat_open_rate_limited", "เปิดแชทถี่เกินไป กรุณารอสักครู่", 429);
      return ok(await openLineSupportConversation(session));
    }

    const conversationId = String(body?.conversation_id ?? "").trim();
    if (!conversationId) return fail("conversation_id_required", "ไม่พบห้องสนทนา", 422);

    if (action === "send") {
      const message = String(body?.message ?? "").trim().slice(0, 4000);
      if (!message) return fail("message_required", "กรุณาพิมพ์ข้อความ", 422);

      const rate = await enforceRateLimit({
        namespace: "line-support-chat-message",
        key: [session.bindingId, conversationId, ip].join(":"),
        max: 30,
        windowMs: 5 * 60_000,
        failClosedOnBackendError: true
      });
      if (!rate.ok) return fail("support_chat_rate_limited", "ส่งข้อความถี่เกินไป กรุณารอสักครู่", 429);
      return ok(await sendLineSupportMessage(session, conversationId, message));
    }

    if (action === "close") {
      const rate = await enforceRateLimit({
        namespace: "line-support-chat-close",
        key: [session.bindingId, conversationId, ip].join(":"),
        max: 10,
        windowMs: 10 * 60_000,
        failClosedOnBackendError: true
      });
      if (!rate.ok) return fail("support_chat_close_rate_limited", "ทำรายการถี่เกินไป กรุณารอสักครู่", 429);
      const data = await closeLineSupportConversation(session, conversationId);
      await clearLineSupportSession();
      return ok(data);
    }

    return fail("unsupported_action", "คำสั่งแชทไม่ถูกต้อง", 422);
  } catch (error) {
    return errorResponse(error);
  }
}
