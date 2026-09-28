import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { buildPaymentConfirmationEmail, deliverCustomerEmail } from "@/lib/services/it-admin/customer-email-service";
import { dispatchSupportPush } from "@/lib/support-chat/support-push";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ requestId: string }> };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SettlementResult = {
  already_settled?: boolean;
  settlement_id?: string;
  billing_cycle_id?: string;
  receipt_id?: string;
  receipt_number?: string;
  first_paid_activation?: boolean;
  period_start?: string;
  period_end?: string;
  new_expiry?: string;
};

function obj(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function friendlySettlementError(message: string) {
  const map: Record<string, [string, number]> = {
    request_not_found: ["ไม่พบคำขอชำระแพ็กเกจ", 404],
    request_not_under_review: ["ต้องรับเรื่องตรวจสอบก่อนยืนยันเงินเข้า", 409],
    payment_notice_required: ["คำขอนี้ยังไม่มีรายการแจ้งชำระเงินจริง", 422],
    requested_package_missing: ["คำขอไม่มีแพ็กเกจที่ต้องการ", 422],
    package_not_found: ["ไม่พบแพ็กเกจที่เปิดใช้งาน", 422],
    billing_interval_invalid: ["รอบชำระของคำขอไม่ถูกต้อง", 422],
    expected_amount_missing: ["ยังไม่สามารถยืนยันยอดได้ เพราะแพ็กเกจไม่มีราคาที่เชื่อถือได้", 422],
    verified_amount_mismatch: ["ยอดเงินเข้าที่ตรวจสอบแล้วไม่ตรงกับยอดแพ็กเกจ", 422],
    tenant_not_found: ["ไม่พบร้านค้า", 404],
    tenant_lifecycle_not_found: ["ไม่พบสถานะวงจรชีวิตของร้าน", 409],
    internal_demo_not_billable: ["บัญชีทดสอบภายในไม่สามารถสร้างรายการรับชำระได้", 422],
    primary_data_migration_not_ready: ["ข้อมูลร้านยังไม่พร้อมสำหรับเปิดแพ็กเกจแบบชำระเงินจริง", 409],
    bank_reference_invalid: ["กรุณาระบุเลขอ้างอิงธุรกรรมธนาคารที่ถูกต้อง", 422],
    bank_received_at_invalid: ["กรุณาตรวจสอบวันและเวลาที่ธนาคารรับเงิน", 422],
    amount_received_invalid: ["ยอดเงินเข้าที่ตรวจสอบแล้วไม่ถูกต้อง", 422],
    bank_reference_already_used: ["เลขอ้างอิงธนาคารนี้ถูกใช้ยืนยันรายการอื่นแล้ว", 409]
  };
  const key = Object.keys(map).find((item) => message.includes(item));
  return key ? { code: key, message: map[key][0], status: map[key][1] } : null;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const { requestId } = await params;
    if (!UUID.test(requestId)) {
      throw new ItAdminGuardError("request_invalid", "Invalid request ID.", 422);
    }

    const body = await request.json().catch(() => null) as {
      bank_transaction_reference?: unknown;
      bank_received_at?: unknown;
      amount_received?: unknown;
      note?: unknown;
      confirmed_bank_receipt?: unknown;
    } | null;

    if (body?.confirmed_bank_receipt !== true) {
      return fail("bank_confirmation_required", "กรุณายืนยันว่าได้ตรวจสอบเงินเข้าบัญชีบริษัทจากรายการธนาคารแล้ว", 422);
    }

    const reference = typeof body.bank_transaction_reference === "string"
      ? body.bank_transaction_reference.trim().slice(0, 160) : "";
    const receivedAtText = typeof body.bank_received_at === "string" ? body.bank_received_at.trim() : "";
    const parsedReceivedAt = Date.parse(receivedAtText);
    const amount = typeof body.amount_received === "number"
      ? body.amount_received : Number(body.amount_received);
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";

    if (!reference || !Number.isFinite(parsedReceivedAt) || !Number.isFinite(amount) || amount <= 0) {
      return fail("settlement_fields_required", "กรอกเลขอ้างอิงธนาคาร วันเวลาเงินเข้า และยอดเงินที่ตรวจสอบแล้วให้ครบ", 422);
    }

    const result = await supabase.rpc("settle_subscription_payment", {
      p_request_id: requestId,
      p_actor_id: auth.userId,
      p_bank_transaction_reference: reference,
      p_bank_received_at: new Date(parsedReceivedAt).toISOString(),
      p_amount_received: Number(amount.toFixed(2)),
      p_note: note || null
    });

    if (result.error) {
      const friendly = friendlySettlementError(result.error.message || "");
      if (friendly) return fail(friendly.code, friendly.message, friendly.status);
      throw new Error(result.error.message);
    }

    const settlement = (result.data ?? {}) as SettlementResult;
    if (!settlement.receipt_id || !settlement.receipt_number) {
      throw new Error("settlement_receipt_missing");
    }

    await appendAuditLog({
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: settlement.already_settled ? "subscription_settlement_reopened" : "subscription_payment_settled",
      targetTable: "tenant_subscription_settlements",
      targetId: settlement.settlement_id,
      metadata: {
        request_id: requestId,
        billing_cycle_id: settlement.billing_cycle_id ?? null,
        receipt_id: settlement.receipt_id,
        receipt_number: settlement.receipt_number,
        first_paid_activation: settlement.first_paid_activation ?? null,
        bank_reference_suffix: reference.slice(-6)
      },
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    const receiptResult = await supabase.from("tenant_subscription_receipts")
      .select("id,tenant_id,receipt_number,amount,currency,customer_snapshot,package_snapshot")
      .eq("id", settlement.receipt_id).maybeSingle();
    if (receiptResult.error) throw receiptResult.error;
    if (!receiptResult.data) throw new Error("settlement_receipt_not_found");

    // Customer runtime is already unlocked atomically by the settlement RPC.
    // Push the confirmation before email delivery so notification latency is
    // never coupled to the mail provider.
    await dispatchSupportPush({
      audience:"store",
      tenant_id:receiptResult.data.tenant_id,
      kind:"request",
      title:"ยืนยันการชำระเงินแล้ว",
      body:`อนุมัติแพ็กเกจแล้ว · ใบเสร็จ ${receiptResult.data.receipt_number}`,
      url:"/preview/pos/payments/package",
      tag:`subscription-request:${requestId}`
    }).catch(()=>null);

    let emailDelivery: { status: string; delivery_id?: string; message?: string } = {
      status: "failed",
      message: "ยังไม่ได้ส่งอีเมลยืนยันการชำระ"
    };
    try {
      const settingsResult = await supabase.from("it_communication_settings")
        .select("billing_email,support_email").eq("id", "default").maybeSingle();

      const customer = obj(receiptResult.data.customer_snapshot);
      const pkg = obj(receiptResult.data.package_snapshot);
      const recipient = typeof customer.email === "string" ? customer.email : "";
      if (!recipient) {
        emailDelivery = { status: "blocked", message: "ไม่พบอีเมล Owner ในข้อมูลใบเสร็จ กรุณาแก้ข้อมูลลูกค้าก่อนส่ง" };
      } else {
        const message = buildPaymentConfirmationEmail({
          storeName: String(customer.store_name || "ร้านค้า"),
          ownerName: typeof customer.owner_name === "string" ? customer.owner_name : null,
          packageName: String(pkg.package_name || "CpIPOS"),
          receiptNumber: receiptResult.data.receipt_number,
          amount: Number(receiptResult.data.amount),
          currency: receiptResult.data.currency,
          periodStart: typeof pkg.period_start === "string" ? pkg.period_start : settlement.period_start ?? null,
          periodEnd: typeof pkg.period_end === "string" ? pkg.period_end : settlement.period_end ?? null,
          billingEmail: settingsResult.data?.billing_email || "cuttingpointtech@gmail.com",
          supportEmail: settingsResult.data?.support_email || "cuttingpointtech.support@gmail.com"
        });
        emailDelivery = await deliverCustomerEmail({
          db: supabase,
          eventType: "payment_confirmation",
          sourceId: receiptResult.data.id,
          tenantId: receiptResult.data.tenant_id,
          to: recipient,
          message,
          triggerMode: "automatic",
          actorUserId: auth.userId
        });
      }

      await appendAuditLog({
        tenantId: receiptResult.data.tenant_id,
        actorUserId: auth.userId,
        actorRole: "it_admin",
        action: "customer_payment_email_auto_attempt",
        targetTable: "customer_email_deliveries",
        targetId: emailDelivery.delivery_id,
        module: "it_admin",
        metadata: {
          receipt_id: receiptResult.data.id,
          receipt_number: receiptResult.data.receipt_number,
          delivery_status: emailDelivery.status
        },
        ipAddress: requestMeta.ipAddress ?? undefined,
        userAgent: requestMeta.userAgent ?? undefined
      });
    } catch (emailError) {
      console.error("[it-mail] payment confirmation email failed without rolling back settlement",
        emailError instanceof Error ? emailError.message : emailError);
    }

    const response = ok({ settlement, email_delivery: emailDelivery });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}
