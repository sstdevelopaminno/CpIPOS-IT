import "server-only";

import { randomUUID } from "node:crypto";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { scanSubscriptionSlipFromPrimary } from "@/lib/payments/subscription-slip-ai";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ requestId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "subscription-payment-evidence";
const MAX_SLIP_BYTES = 4 * 1024 * 1024;
const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

type OpenRequest = {
  id: string;
  tenant_id: string;
  status: string;
  requested_package_id: string | null;
  evidence_url: string | null;
  amount_reported: number | null;
  metadata: Record<string, unknown> | null;
};

function detectMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const { requestId } = await params;
    if (!UUID.test(requestId)) return fail("request_invalid", "รหัสคำขอชำระเงินไม่ถูกต้อง", 422);

    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(request.url).host) {
      return fail("cross_origin_forbidden", "ไม่อนุญาตให้อัปโหลดหลักฐานข้ามเว็บไซต์", 403);
    }

    const rate = await enforceRateLimit({
      namespace: "it-forwarded-subscription-slip",
      key: auth.userId,
      max: 12,
      windowMs: 10 * 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) return fail("slip_rate_limited", "ส่งสลิปถี่เกินไป กรุณาลองใหม่ภายหลัง", 429);

    const rawLength = Number(request.headers.get("content-length") || 0);
    if (rawLength > MAX_SLIP_BYTES + 16_000) {
      return fail("upload_too_large", "สลิปต้องมีขนาดไม่เกิน 4 MB", 413);
    }
    const form = await request.formData().catch(() => null);
    if (!form) return fail("invalid_form", "ไม่สามารถอ่านไฟล์ที่แนบได้", 422);

    const slip = form.get("slip");
    const sourceNote = typeof form.get("source_note") === "string"
      ? String(form.get("source_note")).trim().slice(0, 500) : "";
    if (!(slip instanceof File) || slip.size <= 0 || slip.size > MAX_SLIP_BYTES ||
      !EXTENSION[slip.type]) {
      return fail("slip_invalid", "แนบภาพสลิป JPG, PNG หรือ WebP ขนาดไม่เกิน 4 MB", 422);
    }
    const fileBytes = Buffer.from(await slip.arrayBuffer());
    const detectedMime = detectMime(fileBytes);
    if (!detectedMime || detectedMime !== slip.type) {
      return fail("slip_type_invalid", "ประเภทไฟล์ไม่ตรงกับเนื้อหาภาพ กรุณาเลือกภาพสลิปจริง", 422);
    }

    const selected = await supabase.from("tenant_subscription_payment_requests")
      .select("id,tenant_id,status,requested_package_id,evidence_url,amount_reported,metadata")
      .eq("id", requestId).maybeSingle<OpenRequest>();
    if (selected.error) throw new Error("subscription_request_lookup_failed");
    if (!selected.data) return fail("request_not_found", "ไม่พบคำขอชำระเงิน", 404);
    const current = selected.data;
    const metadata = current.metadata ?? {};
    if (!["pending", "under_review"].includes(current.status)) {
      return fail("request_not_open", "รายการนี้สิ้นสุดการตรวจสอบแล้ว ไม่สามารถเพิ่มสลิปได้", 409);
    }
    if (current.evidence_url) {
      return fail("evidence_already_attached", "รายการนี้มีสลิปแล้ว กรุณารีเฟรชก่อนดำเนินการ", 409);
    }
    if (!current.requested_package_id || !["renewal_intent", "payment_notice"].includes(String(metadata.kind ?? ""))) {
      return fail("request_not_eligible", "รายการนี้ยังไม่พร้อมรับหลักฐานการชำระแพ็กเกจ", 422);
    }

    // This is evidence submitted by IT on behalf of a customer, NOT verified money.
    // Even when the scanner reports verified, do NOT grant provisional access or settle.
    const filePath = current.tenant_id + "/" + requestId + "/it-chat-" + randomUUID() + "." + EXTENSION[detectedMime];
    const stored = await supabase.storage.from(BUCKET).upload(filePath, fileBytes, {
      contentType: detectedMime, cacheControl: "0", upsert: false
    });
    if (stored.error) throw new Error("evidence_storage_upload_failed");

    let linked = false;
    try {
      const bank = await supabase.from("it_communication_settings")
        .select("billing_bank_account_name,billing_bank_account_number,billing_promptpay_id")
        .eq("id", "default").maybeSingle<{
          billing_bank_account_name: string | null;
          billing_bank_account_number: string | null;
          billing_promptpay_id: string | null;
        }>();
      const expected = Number(metadata.expected_amount ?? current.amount_reported ?? 0);
      const scan = await scanSubscriptionSlipFromPrimary({
        tenantId: current.tenant_id,
        requestId,
        storagePath: filePath,
        expectedAmount: Number.isFinite(expected) && expected > 0 ? expected : 0,
        expectedPayeeName: bank.data?.billing_bank_account_name ?? "",
        expectedAccountNumber: bank.data?.billing_bank_account_number ?? "",
        expectedPromptPayId: bank.data?.billing_promptpay_id ?? ""
      });
      const foundAmount = Number(scan.parsed.amount);
      const amountReported = scan.parsed.amount != null && Number.isFinite(foundAmount) &&
        foundAmount > 0 && foundAmount <= 10_000_000
        ? Math.round(foundAmount * 100) / 100 : current.amount_reported;

      const at = new Date().toISOString();
      const nextMetadata = {
        ...metadata,
        kind: "payment_notice",
        evidence_source: "it_forwarded_customer_chat",
        evidence_received_via: "customer_chat",
        evidence_submitted_by: auth.userId,
        evidence_submitted_by_role: auth.platformRole,
        evidence_attached_at: at,
        evidence_source_note: sourceNote,
        slip_ai: {
          version: "subscription-slip-ai-v1",
          status: scan.status,
          model: scan.model,
          parsed: scan.parsed,
          checks: scan.checks,
          error_message: scan.error_message
        }
      };
      const updated = await supabase.from("tenant_subscription_payment_requests")
        .update({
          evidence_url: filePath,
          amount_reported: amountReported,
          metadata: nextMetadata,
          auto_check_status: "needs_review",
          auto_check_reason: "it_forwarded_chat_evidence_requires_bank_verification",
          updated_at: at
        })
        .eq("id", requestId)
        .eq("tenant_id", current.tenant_id)
        .eq("status", current.status)
        .is("evidence_url", null)
        .select("id,tenant_id,status,evidence_url").maybeSingle<{
          id: string; tenant_id: string; status: string; evidence_url: string;
        }>();
      if (updated.error) throw new Error("evidence_link_update_failed");
      if (!updated.data) return fail("evidence_conflict", "รายการถูกแก้ไขแล้ว กรุณารีเฟรชข้อมูลก่อนแนบสลิปอีกครั้ง", 409);
      linked = true;
      try {
        await appendAuditLog({
          tenantId: current.tenant_id,
          actorUserId: auth.userId,
          actorRole: auth.platformRole,
          action: "subscription_customer_chat_slip_attached_by_it",
          targetTable: "tenant_subscription_payment_requests",
          targetId: requestId,
          module: "it_admin",
          beforeData: { status: current.status, kind: metadata.kind ?? null, has_evidence: false },
          afterData: { status: updated.data.status, kind: "payment_notice", has_evidence: true },
          metadata: { evidence_source: "customer_chat", storage_path: filePath, source_note: sourceNote, scan_status: scan.status },
          ipAddress: requestMeta.ipAddress ?? undefined,
          userAgent: requestMeta.userAgent ?? undefined
        });
      } catch (auditError) {
        // Metadata already stores the actor and timestamp; do not misreport a
        // committed evidence upload as failed and invite duplicate submissions.
        console.error("[it-billing] slip attached but audit log failed", auditError);
      }

      const response = ok({
        request: { id: updated.data.id, status: updated.data.status },
        evidence_attached: true,
        bank_confirmed: false,
        requires_manual_bank_verification: true,
        scan_status: scan.status
      });
      response.headers.set("cache-control", "private, no-store");
      return response;
    } finally {
      // A concurrent POS or IT upload wins only once; discard this orphaned file.
      if (!linked) {
        const removed = await supabase.storage.from(BUCKET).remove([filePath]);
        if (removed.error) console.error("[it-billing] orphan slip cleanup failed", removed.error.message);
      }
    }
  } catch (error) {
    return guardItAdminError(error);
  }
}
