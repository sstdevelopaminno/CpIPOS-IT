import { appendAuditLog } from "@/lib/audit-log";
import { ok } from "@/lib/http";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { normalizePromptPayId } from "@/lib/payments/line-payment-service";

export const dynamic = "force-dynamic";

type PaymentSettings = {
  billing_bank_name: string;
  billing_bank_account_name: string;
  billing_bank_account_number: string;
  billing_promptpay_id: string;
};

const SELECT = "billing_bank_name,billing_bank_account_name,billing_bank_account_number,billing_promptpay_id";

function read(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function redact(settings: PaymentSettings | null) {
  if (!settings) return {};
  return {
    ...settings,
    billing_bank_account_number: settings.billing_bank_account_number
      ? "****" + settings.billing_bank_account_number.replace(/\D/g, "").slice(-4)
      : "",
    billing_promptpay_id: settings.billing_promptpay_id
      ? "****" + settings.billing_promptpay_id.slice(-4)
      : ""
  };
}

export async function GET() {
  try {
    const { supabase } = await requireItAdmin();
    const found = await supabase.from("it_communication_settings")
      .select(SELECT)
      .eq("id", "default")
      .single<PaymentSettings>();
    if (found.error || !found.data) throw new Error("payment_settings_read_failed");

    const response = ok({ settings: found.data });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ItAdminGuardError("invalid_body", "กรุณาระบุข้อมูลบัญชีรับชำระ", 422);
    }

    const patch: PaymentSettings = {
      billing_bank_name: read(body.billing_bank_name, 120),
      billing_bank_account_name: read(body.billing_bank_account_name, 180),
      billing_bank_account_number: read(body.billing_bank_account_number, 40),
      billing_promptpay_id: normalizePromptPayId(body.billing_promptpay_id)
    };

    if (patch.billing_bank_account_number && !/^[\d -]{5,40}$/.test(patch.billing_bank_account_number)) {
      throw new ItAdminGuardError("invalid_bank_account", "กรุณาตรวจสอบเลขบัญชีธนาคาร", 422);
    }
    if (patch.billing_promptpay_id && !/^(?:\d{10}|\d{13})$/.test(patch.billing_promptpay_id)) {
      throw new ItAdminGuardError("invalid_promptpay_id", "พร้อมเพย์ต้องเป็นเบอร์โทร 10 หลัก หรือเลขประจำตัว 13 หลัก", 422);
    }

    const previous = await supabase.from("it_communication_settings")
      .select(SELECT)
      .eq("id", "default")
      .single<PaymentSettings>();
    if (previous.error || !previous.data) throw new Error("payment_settings_read_failed");

    const saved = await supabase.from("it_communication_settings")
      .update({
        ...patch,
        updated_by: auth.userId,
        updated_at: new Date().toISOString()
      })
      .eq("id", "default")
      .select(SELECT)
      .single<PaymentSettings>();
    if (saved.error || !saved.data) throw new Error("payment_settings_update_failed");

    await appendAuditLog({
      actorUserId: auth.userId,
      actorRole: auth.platformRole,
      action: "payment_account_settings_updated",
      targetTable: "it_communication_settings",
      targetId: "default",
      module: "it_admin",
      beforeData: redact(previous.data),
      afterData: redact(saved.data),
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ settings: saved.data });
  } catch (error) {
    return guardItAdminError(error);
  }
}
