import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import {
  listSupportMailThreads,
  SupportMailBridgeError
} from "@/lib/services/it-admin/support-mail-service";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Read-only sent-mail evidence for an activated store's notification.
 * A mail bridge ACK is not recipient delivery; a matching Gmail Sent message
 * is independent evidence that the Support mailbox accepted a message.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireItAdmin();
    const rate = await enforceRateLimit({
      namespace: "it_customer_email_verify_sent",
      key: ctx.auth.userId,
      max: 12,
      windowMs: 60_000
    });
    if (!rate.ok) return fail("rate_limited", "ตรวจสอบกล่อง Sent ถี่เกินไป กรุณาลองใหม่", 429);
    const sourceId = new URL(request.url).searchParams.get("source_id")?.trim() ?? "";
    if (!UUID.test(sourceId)) return fail("invalid_registration_id", "รหัสคำขอเปิดร้านไม่ถูกต้อง", 422);

    const registration = await ctx.supabase.from("store_registration_requests")
      .select("id,status")
      .eq("id", sourceId).maybeSingle();
    if (registration.error) throw registration.error;
    if (!registration.data || registration.data.status !== "activated") {
      return fail("registration_not_activated", "ตรวจสอบได้เฉพาะร้านที่เปิดใช้งานแล้ว", 409);
    }

    const deliveries = await ctx.supabase.from("customer_email_deliveries")
      .select("id,status,recipient_email,subject,sent_at,last_attempt_at,created_at")
      .eq("source_id", sourceId)
      .eq("event_type", "store_activation")
      .order("created_at", { ascending: false })
      .limit(20);
    if (deliveries.error) throw deliveries.error;
    const row = deliveries.data?.find((item) => item.status === "sent")
      ?? deliveries.data?.[0];
    if (!row) return ok({ found: false, reason: "no_attempt", message: "ยังไม่พบประวัติการส่งอีเมลเปิดร้าน" });

    const recipient = String(row.recipient_email ?? "").trim().toLowerCase();
    const subject = String(row.subject ?? "").trim();
    if (!EMAIL.test(recipient) || !subject) {
      return ok({ found: false, reason: "incomplete_delivery", message: "ประวัติอีเมลไม่มีผู้รับหรือหัวข้อที่ตรวจสอบได้" });
    }

    // Query the actual Support Gmail Sent folder. Never infer proof from
    // database status or a provider timestamp-style "messageId" alone.
    const sent = await listSupportMailThreads({
      folder: "sent", query: `to:${recipient}`, limit: 30
    });
    const attemptAt = Date.parse(String(row.sent_at || row.last_attempt_at || ""));
    const match = sent.threads.find((thread) => {
      const sentAt = Date.parse(String(thread.last_message_at || ""));
      return thread.subject.trim().toLowerCase() === subject.toLowerCase()
        && thread.to.toLowerCase().includes(recipient)
        && Number.isFinite(attemptAt) && Number.isFinite(sentAt)
        && Math.abs(sentAt - attemptAt) <= 10 * 60 * 1000;
    });
    return ok({
      found: Boolean(match),
      reason: match ? "gmail_sent_match" : "not_found_in_sent",
      message: match
        ? "พบอีเมลในกล่องส่งแล้วของบัญชี Support"
        : "ยังไม่พบอีเมลที่ตรงกันใน Gmail Sent (อาจกำลังซิงก์หรือส่งไม่สำเร็จ)",
      delivery_status: row.status,
      recipient,
      subject,
      sent_at: match?.last_message_at ?? null,
      thread_id: match?.id ?? null
    });
  } catch (error) {
    if (error instanceof SupportMailBridgeError) {
      return fail(error.code, error.message, error.status);
    }
    return guardItAdminError(error);
  }
}
