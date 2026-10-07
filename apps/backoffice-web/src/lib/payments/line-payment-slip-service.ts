import "server-only";

import crypto from "node:crypto";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { scanSubscriptionSlipFromPrimary, type SubscriptionSlipScanResult } from "@/lib/payments/subscription-slip-ai";
import { getLinePackagePaymentSnapshot } from "@/lib/payments/line-payment-service";
import type { LineSupportSession } from "@/lib/support-chat/line-support-auth";
import { dispatchSupportPush } from "@/lib/support-chat/support-push";

export const SUBSCRIPTION_SLIP_BUCKET = "subscription-payment-evidence";
const MAX_SLIP_BYTES = 4 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export class LinePaymentSlipError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "LinePaymentSlipError";
    this.code = code;
    this.status = status;
  }
}

function actualMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0,4).toString("ascii") === "RIFF" && buffer.subarray(8,12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function submitLinePackagePaymentSlip(input: {
  session: LineSupportSession;
  slip: File;
  note?: string;
}) {
  const snapshot = await getLinePackagePaymentSnapshot(input.session);
  if (!snapshot.due || !snapshot.package.id) {
    throw new LinePaymentSlipError("payment_not_due", "ร้านนี้ยังไม่มียอดชำระที่ถึงกำหนด", 409);
  }
  if (snapshot.due.support_required || !snapshot.due.self_service_payment_allowed) {
    throw new LinePaymentSlipError(
      "payment_support_required",
      snapshot.due.support_required
        ? "รายการนี้เกินช่วงชำระด้วยตนเองแล้ว กรุณาติดต่อฝ่าย Support"
        : "รอบนี้ยังไม่เปิดให้ส่งสลิปผ่านระบบ",
      409
    );
  }
  if (!snapshot.due.billing_cycle_id) {
    throw new LinePaymentSlipError("billing_cycle_missing", "ระบบยังไม่สามารถเปิดรอบบิลได้ กรุณาลองใหม่", 503);
  }
  if (snapshot.open_request) {
    throw new LinePaymentSlipError("payment_request_exists", "ส่งสลิปแล้ว และรายการกำลังรอตรวจสอบ", 409);
  }

  const evidence = input.slip;
  if (!(evidence instanceof File) || evidence.size <= 0) {
    throw new LinePaymentSlipError("slip_required", "กรุณาแนบรูปสลิปการชำระเงิน", 422);
  }
  if (evidence.size > MAX_SLIP_BYTES || !FILE_TYPES[evidence.type]) {
    throw new LinePaymentSlipError("slip_invalid", "รองรับสลิป JPG, PNG หรือ WebP ขนาดไม่เกิน 4 MB", 422);
  }

  const buffer = Buffer.from(await evidence.arrayBuffer());
  const detectedMime = actualMime(buffer);
  if (!detectedMime || detectedMime !== evidence.type || !FILE_TYPES[detectedMime]) {
    throw new LinePaymentSlipError("slip_type_invalid", "ไฟล์สลิปไม่ถูกต้อง กรุณาเลือกรูปจากกล้องหรือแกลเลอรีอีกครั้ง", 422);
  }

  const db = getPrimarySupabaseServiceClient();

  const open = await db.from("tenant_subscription_payment_requests")
    .select("id,status")
    .eq("tenant_id", input.session.tenantId)
    .in("status", ["pending", "under_review"])
    .limit(1)
    .maybeSingle<{ id: string; status: string }>();
  if (open.error) throw new LinePaymentSlipError("payment_request_lookup_failed", "ตรวจสอบรายการเดิมไม่สำเร็จ กรุณาลองใหม่", 503);
  if (open.data) {
    throw new LinePaymentSlipError("payment_request_exists", "ส่งสลิปแล้ว และรายการกำลังรอตรวจสอบ", 409);
  }

  const requestId = crypto.randomUUID();
  const filePath = input.session.tenantId + "/" + requestId + "/slip." + FILE_TYPES[detectedMime];

  const upload = await db.storage.from(SUBSCRIPTION_SLIP_BUCKET).upload(filePath, buffer, {
    contentType: detectedMime,
    cacheControl: "0",
    upsert: false
  });
  if (upload.error) {
    throw new LinePaymentSlipError("slip_upload_failed", "จัดเก็บสลิปไม่สำเร็จ กรุณาลองใหม่", 503);
  }

  const scan: SubscriptionSlipScanResult = await scanSubscriptionSlipFromPrimary({
    tenantId: input.session.tenantId,
    requestId,
    storagePath: filePath,
    expectedAmount: snapshot.due.outstanding_amount,
    expectedPayeeName: snapshot.payment_account.account_name,
    expectedAccountNumber: snapshot.payment_account.account_number,
    expectedPromptPayId: snapshot.payment_account.promptpay_id
  });

  const amountReported = scan.parsed.amount != null
    && Number.isFinite(scan.parsed.amount)
    && scan.parsed.amount > 0
    && scan.parsed.amount <= 10_000_000
      ? Math.round(scan.parsed.amount * 100) / 100
      : null;

  const metadata = {
    kind: "payment_notice",
    billing_interval: snapshot.package.billing_interval === "yearly" ? "yearly" : "monthly",
    expected_amount: snapshot.due.outstanding_amount,
    source: "line_payment_center",
    line_binding_id: input.session.bindingId,
    store_code: input.session.storeCode,
    due_source: snapshot.due.source,
    due_date: snapshot.due.due_date,
    service_period_start: snapshot.due.period_start,
    service_period_end: snapshot.due.period_end,
    billing_cycle_id: snapshot.due.billing_cycle_id,
    payer_name: scan.parsed.payer_name ?? "",
    transfer_reference: scan.parsed.reference_no ?? scan.parsed.transaction_id ?? "",
    transfer_at: scan.parsed.transfer_datetime ?? "",
    slip_ai: {
      version: "subscription-slip-ai-v1",
      status: scan.status,
      model: scan.model,
      parsed: scan.parsed,
      checks: scan.checks,
      error_message: scan.error_message
    },
    note: String(input.note ?? "").trim().slice(0, 500)
  };

  const inserted = await db.from("tenant_subscription_payment_requests").insert({
    id: requestId,
    tenant_id: input.session.tenantId,
    requested_package_id: snapshot.package.id,
    request_type: snapshot.due.kind === "trial" ? "trial_conversion" : "renewal",
    amount_reported: amountReported,
    status: "pending",
    currency: snapshot.due.currency || "THB",
    evidence_url: filePath,
    metadata
  }).select("id,status,submitted_at").maybeSingle<{ id: string; status: string; submitted_at: string }>();

  if (inserted.error || !inserted.data) {
    await db.storage.from(SUBSCRIPTION_SLIP_BUCKET).remove([filePath]);
    if (inserted.error?.code === "23505") {
      throw new LinePaymentSlipError("payment_request_exists", "ส่งสลิปแล้ว และรายการกำลังรอตรวจสอบ", 409);
    }
    throw new LinePaymentSlipError("payment_request_failed", "ส่งรายการให้ฝ่ายตรวจสอบไม่สำเร็จ กรุณาลองใหม่", 503);
  }

  let provisional: { granted?: boolean; review_deadline?: string; provisional_access_expires_at?: string } | null = null;
  if (scan.status === "verified" && scan.checks.passed) {
    const granted = await db.rpc("grant_provisional_subscription_access", {
      p_request_id: inserted.data.id,
      p_scan: scan,
      p_actor_id: null
    });
    if (!granted.error && granted.data && typeof granted.data === "object") {
      provisional = granted.data as { granted?: boolean; review_deadline?: string; provisional_access_expires_at?: string };
    } else if (granted.error) {
      await db.from("tenant_subscription_payment_requests").update({
        auto_check_status: "failed",
        auto_check_reason: "provisional_grant_failed:" + granted.error.message.slice(0,180)
      }).eq("id", inserted.data.id);
    }
  }

  await dispatchSupportPush({
    audience: "it",
    tenant_id: input.session.tenantId,
    kind: "request",
    title: "แจ้งชำระแพ็กเกจจาก LINE · " + input.session.storeName,
    body: snapshot.package.name + " · " + snapshot.due.outstanding_amount.toLocaleString("th-TH") + " บาท",
    url: "/it-admin/subscription-payments/" + input.session.tenantId,
    tag: "subscription-request:" + inserted.data.id
  }).catch(() => null);

  return {
    request: {
      id: inserted.data.id,
      status: provisional?.granted ? "under_review" : inserted.data.status,
      submitted_at: inserted.data.submitted_at,
      review_note: null as string | null,
      scan_status: scan.status,
      provisional_access: provisional?.granted === true,
      review_deadline: provisional?.review_deadline ?? provisional?.provisional_access_expires_at ?? null,
      expected_amount: snapshot.due.outstanding_amount,
      currency: snapshot.due.currency || "THB"
    },
    scan: {
      status: scan.status,
      amount_match: scan.checks.amount_match,
      payee_match: scan.checks.payee_match,
      issues: scan.checks.issues
    }
  };
}

export async function getLinePaymentRequestStatus(input: {
  session: LineSupportSession;
  requestId: string;
}) {
  const db = getPrimarySupabaseServiceClient();
  const request = await db.from("tenant_subscription_payment_requests")
    .select("id,status,submitted_at,reviewed_at,review_note,amount_reported,currency,metadata,auto_check_status,provisional_access_granted_at,provisional_access_expires_at,provisional_access_revoked_at")
    .eq("id", input.requestId)
    .eq("tenant_id", input.session.tenantId)
    .maybeSingle<{
      id: string;
      status: string;
      submitted_at: string;
      reviewed_at: string | null;
      review_note: string | null;
      amount_reported: number | null;
      currency: string;
      metadata: Record<string, unknown> | null;
      auto_check_status: string;
      provisional_access_granted_at: string | null;
      provisional_access_expires_at: string | null;
      provisional_access_revoked_at: string | null;
    }>();

  if (request.error) throw new LinePaymentSlipError("payment_status_failed", "ตรวจสอบสถานะการชำระไม่สำเร็จ", 503);
  if (!request.data) throw new LinePaymentSlipError("payment_request_not_found", "ไม่พบรายการชำระนี้", 404);

  let receipt: null | {
    id: string;
    number: string;
    issued_at: string;
    amount: number;
    currency: string;
  } = null;

  if (request.data.status === "approved") {
    const found = await db.from("tenant_subscription_receipts")
      .select("id,receipt_number,issued_at,amount,currency")
      .eq("payment_request_id", request.data.id)
      .maybeSingle<{
        id: string;
        receipt_number: string;
        issued_at: string;
        amount: number;
        currency: string;
      }>();
    if (found.error) throw new LinePaymentSlipError("receipt_status_failed", "โหลดข้อมูลใบเสร็จไม่สำเร็จ", 503);
    if (found.data) {
      receipt = {
        id: found.data.id,
        number: found.data.receipt_number,
        issued_at: found.data.issued_at,
        amount: Number(found.data.amount),
        currency: found.data.currency
      };
    }
  }

  const slipAi = request.data.metadata?.slip_ai;
  const scanStatus = slipAi && typeof slipAi === "object" && !Array.isArray(slipAi)
    ? String((slipAi as Record<string, unknown>).status ?? "") || null
    : null;

  return {
    request: {
      id: request.data.id,
      status: request.data.status,
      submitted_at: request.data.submitted_at,
      reviewed_at: request.data.reviewed_at,
      review_note: request.data.review_note,
      amount_reported: request.data.amount_reported,
      currency: request.data.currency,
      scan_status: scanStatus,
      auto_check_status: request.data.auto_check_status,
      provisional_access_granted_at: request.data.provisional_access_granted_at,
      provisional_access_expires_at: request.data.provisional_access_expires_at,
      provisional_access_active: Boolean(
        request.data.provisional_access_granted_at
        && !request.data.provisional_access_revoked_at
        && request.data.provisional_access_expires_at
        && Date.parse(request.data.provisional_access_expires_at)>Date.now()
        && request.data.status==="under_review"
      ),
      receipt
    }
  };
}
