import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type CustomerEmailEventType = "store_activation" | "payment_confirmation";
export type CustomerEmailTriggerMode = "automatic" | "manual";
export type CustomerEmailDeliveryStatus =
  | "sent"
  | "already_sent"
  | "automatic_disabled"
  | "suppressed"
  | "blocked"
  | "failed";

type CommunicationSettings = {
  billing_email: string;
  support_email: string;
  billing_sender_name: string;
  support_sender_name: string;
  auto_send_store_activation: boolean;
  auto_send_payment_confirmation: boolean;
};

type DeliveryRow = {
  id: string;
  event_key: string;
  status: "pending" | "sending" | "sent" | "blocked" | "failed";
  attempt_count: number;
  last_attempt_at: string | null;
  sent_at: string | null;
};

export type CustomerEmailDeliveryResult = {
  status: CustomerEmailDeliveryStatus;
  delivery_id?: string;
  message?: string;
};

export type CustomerEmailMessage = {
  subject: string;
  textBody: string;
  htmlBody: string;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;
const STALE_SENDING_MS = 10 * 60 * 1000;
const TYPO_DOMAINS = new Map([
  ["amil.com", "gmail.com"],
  ["gmai.com", "gmail.com"],
  ["gmial.com", "gmail.com"],
  ["gmal.com", "gmail.com"],
  ["gmail.co", "gmail.com"],
  ["hotmai.com", "hotmail.com"],
  ["outlok.com", "outlook.com"]
]);

const DEFAULT_SETTINGS: CommunicationSettings = {
  billing_email: "cuttingpointtech@gmail.com",
  support_email: "cuttingpointtech.support@gmail.com",
  billing_sender_name: "CUTTING POINTTECH",
  support_sender_name: "Cutting Point Tech Support",
  auto_send_store_activation: true,
  auto_send_payment_confirmation: true
};

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function thaiDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok"
  }).format(parsed);
}

function money(amount: number, currency = "THB") {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: currency || "THB"
  }).format(amount);
}

const COMPANY_SIGNATURE = {
  thaiName: "บริษัท คัตติ้งพอยท์ เทค จำกัด",
  englishName: "Cutting Point Tech Co., Ltd.",
  phone: "098-5460-355",
  website: "https://cuttingpointtech.vercel.app/"
};

function companySignatureText(supportEmail: string) {
  return [
    "",
    "",
    COMPANY_SIGNATURE.thaiName,
    COMPANY_SIGNATURE.englishName,
    "",
    `อีเมล: ${text(supportEmail, 254)}`,
    `โทรศัพท์: ${COMPANY_SIGNATURE.phone}`,
    `เว็บไซต์: ${COMPANY_SIGNATURE.website}`
  ].join("\n");
}

function companySignatureHtml(supportEmail: string) {
  const email = escapeHtml(supportEmail);
  return [
    '<div style="margin-top:28px;padding-top:18px;border-top:1px solid #e5e7eb;font-family:Arial,\'Noto Sans Thai\',sans-serif;font-size:13px;line-height:1.65;color:#374151">',
    `<div style="font-weight:700;color:#111827">${escapeHtml(COMPANY_SIGNATURE.thaiName)}</div>`,
    `<div>${escapeHtml(COMPANY_SIGNATURE.englishName)}</div>`,
    '<div style="height:10px"></div>',
    `<div>อีเมล: <a href="mailto:${email}" style="color:#2563eb;text-decoration:underline">${email}</a></div>`,
    `<div>โทรศัพท์: <a href="tel:0985460355" style="color:#2563eb;text-decoration:underline">${escapeHtml(COMPANY_SIGNATURE.phone)}</a></div>`,
    `<div>เว็บไซต์: <a href="${COMPANY_SIGNATURE.website}" style="color:#2563eb;text-decoration:underline">${escapeHtml(COMPANY_SIGNATURE.website)}</a></div>`,
    "</div>"
  ].join("");
}

export function customerEmailProblem(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!EMAIL.test(normalized)) return "รูปแบบอีเมลผู้รับไม่ถูกต้อง";
  const domain = normalized.split("@")[1] ?? "";
  const suggestion = TYPO_DOMAINS.get(domain);
  return suggestion ? `โดเมนอีเมล ${domain} อาจพิมพ์ผิด (อาจหมายถึง ${suggestion}) กรุณาแก้ข้อมูลลูกค้าก่อนส่ง` : "";
}

async function loadSettings(db: SupabaseClient): Promise<CommunicationSettings> {
  const result = await db.from("it_communication_settings")
    .select("billing_email,support_email,billing_sender_name,support_sender_name,auto_send_store_activation,auto_send_payment_confirmation")
    .eq("id", "default").maybeSingle<CommunicationSettings>();
  if (result.error) throw new Error("communication_settings_read_failed");
  return result.data ?? DEFAULT_SETTINGS;
}

async function updateDelivery(db: SupabaseClient, id: string, patch: Record<string, unknown>) {
  const result = await db.from("customer_email_deliveries")
    .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (result.error) throw new Error("customer_email_delivery_update_failed");
}

async function getOrCreateDelivery(input: {
  db: SupabaseClient;
  eventType: CustomerEmailEventType;
  sourceId: string;
  tenantId: string | null;
  to: string;
  subject: string;
  triggerMode: CustomerEmailTriggerMode;
  actorUserId?: string | null;
}) {
  const eventKey = `${input.eventType}:${input.sourceId}`;
  const existing = await input.db.from("customer_email_deliveries")
    .select("id,event_key,status,attempt_count,last_attempt_at,sent_at")
    .eq("event_key", eventKey).maybeSingle<DeliveryRow>();
  if (existing.error) throw new Error("customer_email_delivery_read_failed");
  if (existing.data) return existing.data;

  const inserted = await input.db.from("customer_email_deliveries").insert({
    event_type: input.eventType,
    event_key: eventKey,
    tenant_id: input.tenantId,
    source_id: input.sourceId,
    recipient_email: input.to,
    subject: input.subject,
    trigger_mode: input.triggerMode,
    created_by: input.actorUserId ?? null
  }).select("id,event_key,status,attempt_count,last_attempt_at,sent_at").maybeSingle<DeliveryRow>();

  if (!inserted.error && inserted.data) return inserted.data;
  if (inserted.error?.code !== "23505") throw new Error("customer_email_delivery_create_failed");

  const raced = await input.db.from("customer_email_deliveries")
    .select("id,event_key,status,attempt_count,last_attempt_at,sent_at")
    .eq("event_key", eventKey).maybeSingle<DeliveryRow>();
  if (raced.error || !raced.data) throw new Error("customer_email_delivery_race_read_failed");
  return raced.data;
}

export function buildStoreActivationEmail(input: {
  storeName: string;
  storeCode: string;
  ownerName: string;
  ownerCode?: string | null;
  trialExpiresAt?: string | null;
  supportEmail: string;
}): CustomerEmailMessage {
  const subject = `เปิดระบบ POS | ${text(input.storeName, 120)} | CpIPOS`;
  const lines = [
    `เรียน ${text(input.ownerName, 120) || text(input.storeName, 120)}`,
    "",
    "ระบบ CpIPOS ของร้านได้รับการเปิดใช้งานแล้ว",
    `ร้านค้า: ${text(input.storeName, 180)}`,
    `Store Code: ${text(input.storeCode, 80)}`,
    input.ownerCode ? `รหัสผู้ใช้งาน Owner: ${text(input.ownerCode, 20)}` : "",
    `สิ้นสุดช่วงทดลองใช้: ${thaiDate(input.trialExpiresAt)}`,
    "",
    "เพื่อความปลอดภัย ระบบจะไม่ส่ง PIN หรือรหัสลับทางอีเมล",
    `หากต้องการความช่วยเหลือ ติดต่อ Support: ${text(input.supportEmail, 254)}`
  ].filter(Boolean);
  lines.push(companySignatureText(input.supportEmail));
  const html = [
    `<p>เรียน <strong>${escapeHtml(input.ownerName || input.storeName)}</strong></p>`,
    "<p>ระบบ <strong>CpIPOS</strong> ของร้านได้รับการเปิดใช้งานแล้ว</p>",
    "<ul>",
    `<li>ร้านค้า: ${escapeHtml(input.storeName)}</li>`,
    `<li>Store Code: <strong>${escapeHtml(input.storeCode)}</strong></li>`,
    input.ownerCode ? `<li>รหัสผู้ใช้งาน Owner: <strong>${escapeHtml(input.ownerCode)}</strong></li>` : "",
    `<li>สิ้นสุดช่วงทดลองใช้: ${escapeHtml(thaiDate(input.trialExpiresAt))}</li>`,
    "</ul>",
    "<p><strong>เพื่อความปลอดภัย ระบบจะไม่ส่ง PIN หรือรหัสลับทางอีเมล</strong></p>",
    `<p>ติดต่อ Support: ${escapeHtml(input.supportEmail)}</p>`,
    companySignatureHtml(input.supportEmail)
  ].filter(Boolean).join("");
  return { subject, textBody: lines.join("\n"), htmlBody: html };
}

export function buildPaymentConfirmationEmail(input: {
  storeName: string;
  ownerName?: string | null;
  packageName: string;
  receiptNumber: string;
  amount: number;
  currency?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  billingEmail: string;
  supportEmail: string;
}): CustomerEmailMessage {
  const subject = `ยืนยันการรับชำระเงินและเปิดใช้งาน CpIPOS | ${text(input.storeName, 100)} | แพ็กเกจ ${text(input.packageName, 100)}`;
  const lines = [
    `เรียน ${text(input.ownerName, 120) || text(input.storeName, 120)}`,
    "",
    "บริษัทได้รับและตรวจสอบการชำระเงินเรียบร้อยแล้ว ระบบได้เปิด/ต่ออายุแพ็กเกจ CpIPOS ให้แล้ว",
    `ร้านค้า: ${text(input.storeName, 180)}`,
    `แพ็กเกจ: ${text(input.packageName, 120)}`,
    `เลขที่ใบเสร็จ: ${text(input.receiptNumber, 80)}`,
    `ยอดรับชำระ: ${money(input.amount, input.currency || "THB")}`,
    `รอบบริการ: ${thaiDate(input.periodStart)} - ${thaiDate(input.periodEnd)}`,
    "",
    "ใบเสร็จฉบับจริงสามารถเปิดดูได้จากเมนูแพ็กเกจและการชำระเงินใน CpIPOS",
    `ติดต่อฝ่ายบัญชี: ${text(input.billingEmail, 254)}`,
    `ติดต่อ Support: ${text(input.supportEmail, 254)}`,
    companySignatureText(input.supportEmail)
  ];
  const html = [
    `<p>เรียน <strong>${escapeHtml(input.ownerName || input.storeName)}</strong></p>`,
    "<p>บริษัทได้รับและตรวจสอบการชำระเงินเรียบร้อยแล้ว ระบบได้ <strong>เปิด/ต่ออายุแพ็กเกจ CpIPOS</strong> ให้แล้ว</p>",
    "<ul>",
    `<li>ร้านค้า: ${escapeHtml(input.storeName)}</li>`,
    `<li>แพ็กเกจ: ${escapeHtml(input.packageName)}</li>`,
    `<li>เลขที่ใบเสร็จ: <strong>${escapeHtml(input.receiptNumber)}</strong></li>`,
    `<li>ยอดรับชำระ: <strong>${escapeHtml(money(input.amount, input.currency || "THB"))}</strong></li>`,
    `<li>รอบบริการ: ${escapeHtml(thaiDate(input.periodStart))} - ${escapeHtml(thaiDate(input.periodEnd))}</li>`,
    "</ul>",
    "<p>ใบเสร็จฉบับจริงสามารถเปิดดูได้จากเมนูแพ็กเกจและการชำระเงินใน CpIPOS</p>",
    `<p>ฝ่ายบัญชี: ${escapeHtml(input.billingEmail)}<br/>Support: ${escapeHtml(input.supportEmail)}</p>`,
    companySignatureHtml(input.supportEmail)
  ].join("");
  return { subject, textBody: lines.join("\n"), htmlBody: html };
}

export async function deliverCustomerEmail(input: {
  db: SupabaseClient;
  eventType: CustomerEmailEventType;
  sourceId: string;
  tenantId: string | null;
  to: string;
  message: CustomerEmailMessage;
  triggerMode: CustomerEmailTriggerMode;
  actorUserId?: string | null;
}): Promise<CustomerEmailDeliveryResult> {
  const settings = await loadSettings(input.db);
  const automaticEnabled = input.eventType === "store_activation"
    ? settings.auto_send_store_activation
    : settings.auto_send_payment_confirmation;
  if (input.triggerMode === "automatic" && !automaticEnabled) {
    return { status: "automatic_disabled", message: "ปิดการส่งอัตโนมัติไว้ในการตั้งค่า" };
  }

  const to = input.to.trim().toLowerCase();
  const problem = customerEmailProblem(to);
  const delivery = await getOrCreateDelivery({
    db: input.db,
    eventType: input.eventType,
    sourceId: input.sourceId,
    tenantId: input.tenantId,
    to,
    subject: input.message.subject,
    triggerMode: input.triggerMode,
    actorUserId: input.actorUserId
  });

  if (delivery.status === "sent") {
    return { status: "already_sent", delivery_id: delivery.id, message: "อีเมลเหตุการณ์นี้ถูกส่งสำเร็จแล้ว ระบบป้องกันการส่งซ้ำ" };
  }

  const lastAttempt = delivery.last_attempt_at ? Date.parse(delivery.last_attempt_at) : 0;
  const now = Date.now();
  if (delivery.status === "sending" && lastAttempt && now - lastAttempt < STALE_SENDING_MS) {
    return { status: "suppressed", delivery_id: delivery.id, message: "อีเมลกำลังถูกส่งจากคำสั่งก่อนหน้า" };
  }
  if (delivery.status === "failed" && lastAttempt && now - lastAttempt < RETRY_COOLDOWN_MS) {
    return { status: "suppressed", delivery_id: delivery.id, message: "ป้องกันการส่งซ้ำ กรุณารออย่างน้อย 5 นาทีก่อนลองใหม่" };
  }

  if (problem) {
    await updateDelivery(input.db, delivery.id, {
      status: "blocked",
      last_error: problem,
      last_attempt_at: new Date().toISOString()
    });
    return { status: "blocked", delivery_id: delivery.id, message: problem };
  }

  const bridgeUrl = process.env.CPIPOS_MAIL_BRIDGE_URL?.trim();
  const bridgeSecret = process.env.CPIPOS_MAIL_BRIDGE_SECRET?.trim();
  if (!bridgeUrl || !bridgeSecret) {
    const message = "ยังไม่ได้ตั้งค่า CPIPOS_MAIL_BRIDGE_URL / CPIPOS_MAIL_BRIDGE_SECRET จึงยังส่งอีเมลจริงไม่ได้";
    await updateDelivery(input.db, delivery.id, {
      status: "blocked",
      last_error: message,
      last_attempt_at: new Date().toISOString()
    });
    return { status: "blocked", delivery_id: delivery.id, message };
  }

  let claimStatus = delivery.status;
  if (delivery.status === "sending" && lastAttempt && now - lastAttempt >= STALE_SENDING_MS) {
    await updateDelivery(input.db, delivery.id, {
      status: "failed",
      last_error: "stale_sending_recovered"
    });
    claimStatus = "failed";
  }

  const claimed = await input.db.from("customer_email_deliveries").update({
    status: "sending",
    trigger_mode: input.triggerMode,
    recipient_email: to,
    subject: input.message.subject,
    attempt_count: delivery.attempt_count + 1,
    last_attempt_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString()
  }).eq("id", delivery.id).eq("status", claimStatus)
    .select("id").maybeSingle<{ id: string }>();

  if (claimed.error) throw new Error("customer_email_delivery_claim_failed");
  if (!claimed.data) {
    return { status: "suppressed", delivery_id: delivery.id, message: "คำสั่งส่งซ้ำถูกระงับ" };
  }

  try {
    const response = await fetch(bridgeUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: bridgeSecret,
        idempotencyKey: delivery.event_key,
        to,
        subject: input.message.subject,
        textBody: input.message.textBody,
        htmlBody: input.message.htmlBody,
        senderName: input.eventType === "payment_confirmation"
          ? settings.billing_sender_name : settings.support_sender_name,
        replyTo: input.eventType === "payment_confirmation"
          ? settings.billing_email : settings.support_email
      }),
      signal: AbortSignal.timeout(8000)
    });

    const payload = await response.json().catch(() => null) as { ok?: boolean; messageId?: string; error?: string } | null;
    if (!response.ok || payload?.ok !== true) {
      throw new Error(text(payload?.error || `mail_bridge_http_${response.status}`, 300));
    }

    await updateDelivery(input.db, delivery.id, {
      status: "sent",
      sent_at: new Date().toISOString(),
      last_error: null,
      provider: "google_apps_script_mailapp",
      provider_message_id: text(payload?.messageId, 300) || null
    });
    return { status: "sent", delivery_id: delivery.id, message: "ส่งอีเมลสำเร็จ" };
  } catch (error) {
    const message = text(error instanceof Error ? error.message : "mail_delivery_failed", 500);
    await updateDelivery(input.db, delivery.id, { status: "failed", last_error: message });
    return { status: "failed", delivery_id: delivery.id, message };
  }
}
