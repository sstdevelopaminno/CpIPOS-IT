import "server-only";

import crypto from "node:crypto";

const SUPPORT_EMAIL = "cuttingpointtech.support@gmail.com";
const LOGIN_URL = "https://cp-ipos-it-backoffice-web.vercel.app/it-admin/login";
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pick(value: string) {
  return value[crypto.randomInt(0, value.length)] ?? "A";
}

export function generateItTemporaryPassword(length = 16) {
  const targetLength = Math.max(12, Math.min(32, Math.trunc(length)));
  const required = [
    pick("ABCDEFGHJKLMNPQRSTUVWXYZ"),
    pick("abcdefghijkmnopqrstuvwxyz"),
    pick("23456789"),
    pick("!@#$%")
  ];
  while (required.length < targetLength) required.push(pick(PASSWORD_ALPHABET));

  for (let i = required.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [required[i], required[j]] = [required[j]!, required[i]!];
  }
  return required.join("");
}

export async function sendItTemporaryPasswordEmail(input: {
  to: string;
  temporaryPassword: string;
  expiresAt: Date;
  requestId: string;
}) {
  const bridgeUrl = process.env.CPIPOS_MAIL_BRIDGE_URL?.trim();
  const bridgeSecret = process.env.CPIPOS_MAIL_BRIDGE_SECRET?.trim();
  if (!bridgeUrl || !bridgeSecret) {
    throw new Error("mail_bridge_not_configured");
  }

  const expiresLabel = new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(input.expiresAt);

  const subject = "รหัสผ่านชั่วคราวสำหรับ CpiPOS IT";
  const textBody = [
    "มีคำขอรีเซ็ตรหัสผ่านสำหรับ CpiPOS IT Control Plane",
    "",
    `รหัสผ่านชั่วคราว: ${input.temporaryPassword}`,
    `ใช้ได้ถึง: ${expiresLabel}`,
    `เข้าสู่ระบบ: ${LOGIN_URL}`,
    "",
    "หลังเข้าสู่ระบบ ระบบจะพาไปที่เมนู ตั้งค่า > เปลี่ยนรหัสผ่าน เพื่อกำหนดรหัสใหม่",
    "หากคุณไม่ได้เป็นผู้ขอ กรุณาติดต่อฝ่าย Support ทันที",
    "",
    `Support: ${SUPPORT_EMAIL}`
  ].join("\n");

  const htmlBody = [
    '<!doctype html><html><body style="margin:0;padding:0;background:#f3f6fb;font-family:Arial,\'Noto Sans Thai\',sans-serif">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px">',
    '<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #dbe5f3;border-radius:18px;overflow:hidden">',
    '<tr><td style="padding:22px 28px;background:linear-gradient(135deg,#123f86,#2382ef);color:#fff;font-size:25px;font-weight:900">CpIPOS IT</td></tr>',
    '<tr><td style="padding:30px;color:#142946">',
    '<h1 style="margin:0 0 12px;font-size:22px">รหัสผ่านชั่วคราว</h1>',
    '<p style="margin:0 0 18px;color:#64748b;line-height:1.7">มีคำขอรีเซ็ตรหัสผ่านสำหรับ IT Control Plane</p>',
    `<div style="padding:18px;border-radius:12px;background:#f5f9ff;border:1px solid #cfe0f5;text-align:center"><div style="font-size:12px;color:#64748b">รหัสผ่านชั่วคราว</div><div style="margin-top:8px;font-family:ui-monospace,Consolas,monospace;font-size:22px;font-weight:900;letter-spacing:1px;color:#102a50">${escapeHtml(input.temporaryPassword)}</div></div>`,
    `<p style="margin:16px 0 0;color:#64748b;font-size:12px">ใช้ได้ถึง ${escapeHtml(expiresLabel)}</p>`,
    `<p style="margin:22px 0;text-align:center"><a href="${LOGIN_URL}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#176fe8;color:#fff;font-weight:800;text-decoration:none">เข้าสู่ระบบ CpiPOS IT</a></p>`,
    '<div style="padding:13px 15px;border-radius:10px;background:#fff8e8;color:#7a5512;font-size:12px;line-height:1.7"><strong>สำคัญ:</strong> หลังเข้าสู่ระบบให้ตั้งรหัสใหม่ที่เมนู ตั้งค่า &gt; เปลี่ยนรหัสผ่าน ทันที</div>',
    '<p style="margin:18px 0 0;color:#64748b;font-size:11px;line-height:1.7">หากคุณไม่ได้เป็นผู้ขอ กรุณาติดต่อฝ่าย Support ทันที</p>',
    '</td></tr></table></td></tr></table></body></html>'
  ].join("");

  const response = await fetch(bridgeUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret: bridgeSecret,
      idempotencyKey: `it-password-reset:${input.requestId}`,
      to: input.to,
      subject,
      textBody,
      htmlBody,
      senderName: "CpiPOS IT Support",
      replyTo: SUPPORT_EMAIL
    }),
    signal: AbortSignal.timeout(8000),
    cache: "no-store"
  });

  const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || `mail_bridge_http_${response.status}`);
  }
}
