import "server-only";

import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { dispatchSupportPush } from "@/lib/support-chat/support-push";
import { sendSupportMail, supportMailboxAddress } from "@/lib/services/it-admin/support-mail-service";

const PRIMARY_MAILBOX = "cuttingpointtech@gmail.com";
const RETRY_COOLDOWN_MS = 2 * 60_000;
const STALE_CLAIM_MS = 10 * 60_000;

type Delivery = {
  registration_id: string;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  attempt_count: number;
  last_attempt_at: string | null;
};

type Registration = {
  id: string;
  store_name: string;
  business_type: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  custom_requirements: string | null;
  source: string;
  status: string;
  created_at: string;
};

function text(value: unknown, max = 180) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function recipientList() {
  // The first address is the requested management mailbox. The second copy
  // arrives in the same Support mailbox displayed inside CpIPOS IT.
  return Array.from(new Set([PRIMARY_MAILBOX, supportMailboxAddress()])).join(",");
}

function message(row: Registration) {
  const subject = "[IT Support] คำขอเปิดร้านใหม่ · " + text(row.store_name, 110);
  const body = [
    "คำขอเปิดร้านค้าใหม่จากเว็บไซต์ CpiPOS",
    "ส่งถึง: " + PRIMARY_MAILBOX,
    "สำเนาสำหรับกล่องอีเมล Support: " + supportMailboxAddress(),
    "",
    "เลขที่คำขอ: " + row.id,
    "ชื่อร้าน: " + text(row.store_name),
    "ประเภทร้าน: " + text(row.business_type),
    "เจ้าของร้าน: " + text(row.owner_name),
    "เบอร์โทร: " + text(row.owner_phone, 40),
    "อีเมล: " + text(row.owner_email, 254),
    "รายละเอียด CUSTOM: " + text(row.custom_requirements, 1200),
    "สถานะปัจจุบัน: " + text(row.status, 32),
    "ต้นทาง: " + text(row.source, 100),
    "วันที่รับคำขอ (UTC): " + text(row.created_at, 60),
    "",
    "เปิดรายการใน IT: https://cp-ipos-it-web.vercel.app/it-admin/store-registrations",
    "โปรดตรวจสอบและอนุมัติตามขั้นตอน IT เท่านั้น ไม่เปิดร้านอัตโนมัติ",
    "ข้อความนี้เป็นการแจ้งเตือนภายใน ไม่ใช่อีเมลยืนยันเปิดใช้งานสำหรับลูกค้า"
  ].join("\n");
  return { subject, body };
}

/**
 * Safe, claim-based at-least-once delivery. A retry cannot override another
 * worker's claim. The mail gateway is external, so a failure after a send but
 * before its receipt is recorded may cause a rare duplicate on retry.
 */
export async function deliverStoreRegistrationSupportEmail(registrationId: string):
  Promise<"sent" | "already_sent" | "deferred" | "skipped" | "failed"> {
  const db = getPrimarySupabaseServiceClient();
  const nowMs = Date.now();
  const current = await db.from("store_registration_alert_deliveries")
    .select("registration_id,status,attempt_count,last_attempt_at")
    .eq("registration_id", registrationId).maybeSingle<Delivery>();
  if (current.error) throw current.error;
  const row = current.data;
  if (!row) return "deferred"; // Migration/trigger not yet installed; do not invent a receipt.
  if (row.status === "sent") return "already_sent";
  if (row.status === "skipped") return "skipped";

  const elapsed = row.last_attempt_at ? nowMs - Date.parse(row.last_attempt_at) : Infinity;
  if (row.status === "sending" && elapsed < STALE_CLAIM_MS) return "deferred";
  if (row.status === "failed" && elapsed < RETRY_COOLDOWN_MS) return "deferred";
  const nextAttempt = row.attempt_count + 1;
  const now = new Date(nowMs).toISOString();
  const claim = await db.from("store_registration_alert_deliveries")
    .update({ status: "sending", attempt_count: nextAttempt,
      last_attempt_at: now, last_error: null, updated_at: now })
    .eq("registration_id", registrationId)
    .eq("status", row.status)
    .eq("attempt_count", row.attempt_count)
    .select("registration_id").maybeSingle();
  if (claim.error) throw claim.error;
  if (!claim.data) return "deferred";

  const finalize = async (status: "sent" | "skipped" | "failed", errorMessage?: string) => {
    const result = await db.from("store_registration_alert_deliveries")
      .update({ status, sent_at: status === "sent" ? new Date().toISOString() : null,
        last_error: status === "failed" ? text(errorMessage, 500) : null,
        updated_at: new Date().toISOString() })
      .eq("registration_id", registrationId)
      .eq("status", "sending")
      .eq("attempt_count", nextAttempt);
    if (result.error) throw result.error;
  };

  try {
    const registration = await db.from("store_registration_requests")
      .select("id,store_name,business_type,owner_name,owner_email,owner_phone,custom_requirements,source,status,created_at")
      .eq("id", registrationId).maybeSingle<Registration>();
    if (registration.error) throw registration.error;
    if (!registration.data || registration.data.status === "deleted") {
      await finalize("skipped");
      return "skipped";
    }
    const mail = message(registration.data);
    const result = await sendSupportMail({ to: recipientList(), subject: mail.subject, body: mail.body });
    if (result.sent !== true) throw new Error("support_mail_send_not_confirmed");
    await finalize("sent");
    return "sent";
  } catch (error) {
    try { await finalize("failed", error instanceof Error ? error.message : "mail_gateway_failed"); }
    catch (stateError) {
      console.error("[store-registration-alert] delivery-state update failed",
        stateError instanceof Error ? stateError.message : "unknown");
    }
    console.error("[store-registration-alert] email delivery failed",
      error instanceof Error ? error.message : "unknown");
    return "failed";
  }
}

export async function pushStoreRegistrationAlert(registrationId: string, storeName: string) {
  await dispatchSupportPush({
    audience: "it",
    kind: "request",
    title: "มีคำขอเปิดร้านใหม่",
    body: "ร้าน " + text(storeName, 110) + " ส่งคำขอจากเว็บไซต์ กรุณาตรวจสอบใน IT",
    url: "/it-admin/store-registrations",
    tag: "store-registration:" + registrationId
  });
}

/** Called only from authenticated IT endpoints, never from the public form. */
export async function retryStoreRegistrationSupportEmails(limit = 4) {
  const db = getPrimarySupabaseServiceClient();
  const scan = await db.from("store_registration_alert_deliveries")
    .select("registration_id").in("status", ["pending", "failed", "sending"])
    .order("created_at", { ascending: true }).limit(Math.min(12, Math.max(1, limit * 3)));
  if (scan.error) throw scan.error;
  let sent = 0;
  for (const item of (scan.data ?? []).slice(0, Math.max(1, Math.min(6, limit)))) {
    const result = await deliverStoreRegistrationSupportEmail(item.registration_id);
    if (result === "sent") sent += 1;
  }
  return { checked: Math.min(scan.data?.length ?? 0, limit), sent };
}
