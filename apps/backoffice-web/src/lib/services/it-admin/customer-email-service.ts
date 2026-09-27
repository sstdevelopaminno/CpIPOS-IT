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
  company_thai_name: string;
  company_english_name: string;
  contact_phone: string;
  website_url: string;
  email_footer_note: string;
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
  auto_send_payment_confirmation: true,
  company_thai_name: "บริษัท คัตติ้งพอยท์ เทค จำกัด",
  company_english_name: "Cutting Point Tech Co., Ltd.",
  contact_phone: "098-5460-355",
  website_url: "https://cuttingpointinnovation.vercel.app/",
  email_footer_note: "หากต้องการความช่วยเหลือ กรุณาติดต่อ Support"
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

function companySignatureText(settings: CommunicationSettings) {
  return [
    "",
    settings.email_footer_note,
    "",
    settings.company_thai_name,
    settings.company_english_name,
    "",
    `อีเมล: ${settings.support_email}`,
    `โทรศัพท์: ${settings.contact_phone}`,
    `เว็บไซต์: ${settings.website_url}`
  ].join("\n");
}

function companySignatureHtml(settings: CommunicationSettings) {
  const supportEmail = escapeHtml(settings.support_email);
  const website = escapeHtml(settings.website_url);
  const phone = escapeHtml(settings.contact_phone);
  const phoneHref = settings.contact_phone.replace(/[^0-9+]/g, "");
  return [
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:24px;border-top:1px solid #dbe5f3">',
    '<tr><td style="padding:22px 4px 2px;font-family:Arial,\'Noto Sans Thai\',sans-serif;color:#0f2747">',
    `<div style="font-size:15px;font-weight:800;line-height:1.5">${escapeHtml(settings.company_thai_name)}</div>`,
    `<div style="margin-top:2px;font-size:13px;color:#66758b">${escapeHtml(settings.company_english_name)}</div>`,
    '<div style="height:12px"></div>',
    `<div style="font-size:12px;line-height:1.8;color:#52657f">อีเมล: <a href="mailto:${supportEmail}" style="color:#1467e8;text-decoration:none">${supportEmail}</a></div>`,
    `<div style="font-size:12px;line-height:1.8;color:#52657f">โทรศัพท์: <a href="tel:${escapeHtml(phoneHref)}" style="color:#1467e8;text-decoration:none">${phone}</a></div>`,
    `<div style="font-size:12px;line-height:1.8;color:#52657f">เว็บไซต์: <a href="${website}" style="color:#1467e8;text-decoration:none">${website}</a></div>`,
    '</td></tr></table>'
  ].join("");
}

function brandMessage(
  message: CustomerEmailMessage,
  settings: CommunicationSettings,
  eventType: CustomerEmailEventType
): CustomerEmailMessage {
  const title = eventType === "payment_confirmation"
    ? "ยืนยันการรับชำระเงินเรียบร้อย"
    : "เปิดใช้งานระบบสำเร็จแล้ว";
  const subtitle = eventType === "payment_confirmation"
    ? "บริษัทได้รับและตรวจสอบการชำระเงินเรียบร้อยแล้ว ระบบได้เปิด/ต่ออายุแพ็กเกจ CpIPOS ให้แล้ว"
    : "ร้านค้าของคุณพร้อมเริ่มใช้งานระบบ CpIPOS แล้ว";
  const website = escapeHtml(settings.website_url);
  const footerNote = escapeHtml(settings.email_footer_note);

  const htmlBody = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f3f6fb;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f3f6fb">',
    '<tr><td align="center" style="padding:28px 12px">',
    '<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #dbe5f3;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(25,54,93,.08)">',
    '<tr><td style="padding:24px 30px;background:#165bc4;background:linear-gradient(135deg,#123f86,#2382ef);font-family:Arial,\'Noto Sans Thai\',sans-serif;color:#ffffff">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>',
    '<td style="font-size:27px;font-weight:900;letter-spacing:-.5px">CpIPOS</td>',
    '<td align="right" style="font-size:11px;line-height:1.5;color:#dbeafe">ระบบจัดการร้านค้า<br>เพื่อการเติบโตของธุรกิจคุณ</td>',
    '</tr></table></td></tr>',
    '<tr><td style="padding:34px 34px 28px;font-family:Arial,\'Noto Sans Thai\',sans-serif;color:#142946">',
    '<div style="text-align:center">',
    '<div style="width:64px;height:64px;line-height:64px;margin:0 auto 16px;border-radius:50%;background:#eaf3ff;color:#176fe8;font-size:36px;font-weight:900">✓</div>',
    `<div style="font-size:27px;font-weight:900;line-height:1.3;color:#102a50">${escapeHtml(title)}</div>`,
    `<div style="max-width:500px;margin:10px auto 0;font-size:14px;line-height:1.7;color:#66758b">${escapeHtml(subtitle)}</div>`,
    '</div>',
    `<div style="margin-top:24px">${message.htmlBody}</div>`,
    '<div style="text-align:center;margin:26px 0 8px">',
    `<a href="${website}" style="display:inline-block;min-width:230px;padding:14px 24px;border-radius:10px;background:#176fe8;color:#ffffff;font-size:15px;font-weight:800;text-decoration:none">เว็บไซต์ CpIPOS &nbsp;›</a>`,
    '</div>',
    `<div style="margin-top:24px;padding:14px 16px;border-radius:12px;background:#f5f9ff;color:#536780;font-size:12px;line-height:1.65;text-align:center">${footerNote}</div>`,
    companySignatureHtml(settings),
    '</td></tr></table>',
    '<div style="padding:14px 8px 0;font-family:Arial,\'Noto Sans Thai\',sans-serif;font-size:10px;color:#94a3b8">อีเมลธุรกรรมจากระบบ CpIPOS</div>',
    '</td></tr></table></body></html>'
  ].join("");

  return {
    subject: message.subject,
    textBody: message.textBody + companySignatureText(settings),
    htmlBody
  };
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
    .select("billing_email,support_email,billing_sender_name,support_sender_name,auto_send_store_activation,auto_send_payment_confirmation,company_thai_name,company_english_name,contact_phone,website_url,email_footer_note")
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

  const rows = [
    ["ร้านค้า", input.storeName],
    ["Store Code", input.storeCode],
    input.ownerCode ? ["รหัสผู้ใช้งาน Owner", input.ownerCode] : null,
    ["สิ้นสุดช่วงทดลองใช้", thaiDate(input.trialExpiresAt)]
  ].filter(Boolean) as string[][];

  const html = [
    `<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#52657f">เรียน <strong style="color:#142946">${escapeHtml(input.ownerName || input.storeName)}</strong></p>`,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;border:1px solid #cfe0f5;border-radius:12px;background:#f8fbff;overflow:hidden">',
    ...rows.map((row, index) => `<tr><td style="padding:13px 16px;border-bottom:${index === rows.length - 1 ? "0" : "1px solid #e3ebf5"};font-size:12px;color:#64748b;width:42%">${escapeHtml(row[0])}</td><td style="padding:13px 16px;border-bottom:${index === rows.length - 1 ? "0" : "1px solid #e3ebf5"};font-size:14px;font-weight:800;color:#102a50">${escapeHtml(row[1])}</td></tr>`),
    '</table>',
    '<div style="margin-top:18px;padding:13px 15px;border-radius:10px;background:#fff8e8;color:#7a5512;font-size:12px;line-height:1.65"><strong>เพื่อความปลอดภัย:</strong> ระบบจะไม่ส่ง PIN หรือรหัสลับทางอีเมล</div>'
  ].join("");

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
    `ติดต่อ Support: ${text(input.supportEmail, 254)}`
  ];

  const rows = [
    ["ร้านค้า", input.storeName],
    ["แพ็กเกจ", input.packageName],
    ["เลขที่ใบเสร็จ", input.receiptNumber],
    ["ยอดรับชำระ", money(input.amount, input.currency || "THB")],
    ["รอบบริการ", `${thaiDate(input.periodStart)} - ${thaiDate(input.periodEnd)}`]
  ];

  const html = [
    `<p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#52657f">เรียน <strong style="color:#142946">${escapeHtml(input.ownerName || input.storeName)}</strong></p>`,
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0;border:1px solid #cfe0f5;border-radius:12px;background:#f8fbff;overflow:hidden">',
    ...rows.map((row, index) => `<tr><td style="padding:13px 16px;border-bottom:${index === rows.length - 1 ? "0" : "1px solid #e3ebf5"};font-size:12px;color:#64748b;width:42%">${escapeHtml(row[0])}</td><td style="padding:13px 16px;border-bottom:${index === rows.length - 1 ? "0" : "1px solid #e3ebf5"};font-size:14px;font-weight:800;color:${row[0] === "ยอดรับชำระ" ? "#176fe8" : "#102a50"}">${escapeHtml(row[1])}</td></tr>`),
    '</table>',
    '<p style="margin:18px 0 0;font-size:12px;line-height:1.65;color:#66758b">ใบเสร็จฉบับจริงสามารถเปิดดูได้จากเมนูแพ็กเกจและการชำระเงินใน CpIPOS</p>'
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
  const brandedMessage = brandMessage(input.message, settings, input.eventType);
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
    subject: brandedMessage.subject,
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
    subject: brandedMessage.subject,
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
        subject: brandedMessage.subject,
        textBody: brandedMessage.textBody,
        htmlBody: brandedMessage.htmlBody,
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
