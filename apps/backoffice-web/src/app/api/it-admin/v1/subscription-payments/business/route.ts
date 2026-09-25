import { appendAuditLog } from "@/lib/audit-log";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type BillingIdentity = {
  billing_legal_name_th: string;
  billing_legal_name_en: string;
  billing_registered_address: string;
  billing_registration_no: string;
  billing_bank_name: string;
  billing_bank_account_name: string;
  billing_bank_account_number: string;
  billing_promptpay_id: string;
  billing_vat_registered: boolean;
};

const SELECT = [
  "billing_legal_name_th", "billing_legal_name_en", "billing_registered_address",
  "billing_registration_no", "billing_bank_name", "billing_bank_account_name",
  "billing_bank_account_number", "billing_promptpay_id", "billing_vat_registered"
].join(",");

function requiredString(body: Record<string, unknown>, key: keyof BillingIdentity, max: number) {
  const value = body[key];
  if (typeof value !== "string" || value.trim().length > max) {
    throw new ItAdminGuardError("invalid_billing_identity", `Invalid ${key}.`, 422);
  }
  return value.trim();
}

function redactForAudit(profile: BillingIdentity | null) {
  if (!profile) return {};
  const { billing_bank_account_number, billing_promptpay_id, ...visible } = profile;
  return {
    ...visible,
    billing_bank_account_number: billing_bank_account_number
      ? `****${billing_bank_account_number.slice(-4)}` : "",
    billing_promptpay_id: billing_promptpay_id ? "[configured]" : ""
  };
}

export async function GET() {
  try {
    const { supabase } = await requireItAdmin();
    const found = await supabase.from("it_communication_settings").select(SELECT)
      .eq("id", "default").single<BillingIdentity>();
    if (found.error || !found.data) throw new Error("billing_identity_read_failed");
    const response = ok({ profile: found.data });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ItAdminGuardError("invalid_body", "Billing identity is required.", 422);
    }
    // The VAT flag is deliberately not client-editable: the company is not yet VAT registered.
    // A future verified status change must have its own explicit controlled workflow.
    if ("billing_vat_registered" in body) {
      throw new ItAdminGuardError("vat_status_not_editable", "VAT status cannot be changed here.", 422);
    }
    const patch = {
      billing_legal_name_th: requiredString(body, "billing_legal_name_th", 180),
      billing_legal_name_en: requiredString(body, "billing_legal_name_en", 180),
      billing_registered_address: requiredString(body, "billing_registered_address", 900),
      billing_registration_no: requiredString(body, "billing_registration_no", 13),
      billing_bank_name: requiredString(body, "billing_bank_name", 120),
      billing_bank_account_name: requiredString(body, "billing_bank_account_name", 180),
      billing_bank_account_number: requiredString(body, "billing_bank_account_number", 40),
      billing_promptpay_id: requiredString(body, "billing_promptpay_id", 40)
    };
    if (!patch.billing_legal_name_th || !patch.billing_legal_name_en) {
      throw new ItAdminGuardError("missing_legal_name", "Both legal names are required.", 422);
    }
    if (patch.billing_registration_no && !/^\d{13}$/.test(patch.billing_registration_no)) {
      throw new ItAdminGuardError("invalid_registration_no", "Registration number must contain 13 digits.", 422);
    }
    if (patch.billing_bank_account_number && !/^[\d -]{5,40}$/.test(patch.billing_bank_account_number)) {
      throw new ItAdminGuardError("invalid_bank_account", "Check the bank account number.", 422);
    }
    const previous = await supabase.from("it_communication_settings").select(SELECT)
      .eq("id", "default").single<BillingIdentity>();
    if (previous.error || !previous.data) throw new Error("billing_identity_read_failed");
    const saved = await supabase.from("it_communication_settings")
      .update({ ...patch, updated_by: auth.userId, updated_at: new Date().toISOString() })
      .eq("id", "default").select(SELECT).single<BillingIdentity>();
    if (saved.error || !saved.data) throw new Error("billing_identity_update_failed");
    await appendAuditLog({
      actorUserId: auth.userId, actorRole: "it_admin",
      action: "company_billing_identity_updated",
      targetTable: "it_communication_settings", targetId: "default", module: "it_admin",
      beforeData: redactForAudit(previous.data),
      afterData: redactForAudit(saved.data),
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });
    return ok({ profile: saved.data });
  } catch (error) { return guardItAdminError(error); }
}
