import { appendAuditLog } from "@/lib/audit-log";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type ContactSettings = {
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

const SELECT = [
  "billing_email",
  "support_email",
  "billing_sender_name",
  "support_sender_name",
  "auto_send_store_activation",
  "auto_send_payment_confirmation",
  "company_thai_name",
  "company_english_name",
  "contact_phone",
  "website_url",
  "email_footer_note"
].join(",");

const DEFAULTS: ContactSettings = {
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function read(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function pickText(body: Record<string, unknown>, key: keyof ContactSettings, current: ContactSettings, max: number) {
  if (!(key in body)) return String(current[key]);
  return read(body[key], max);
}

function pickBool(body: Record<string, unknown>, key: "auto_send_store_activation" | "auto_send_payment_confirmation", current: ContactSettings) {
  if (!(key in body)) return current[key];
  return body[key] !== false;
}

function validWebsite(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const { supabase } = await requireItAdmin();
    const result = await supabase.from("it_communication_settings").select(SELECT)
      .eq("id", "default").maybeSingle<ContactSettings>();
    if (result.error) throw new Error("communication_settings_read_failed");
    const response = ok({ settings: result.data ?? DEFAULTS });
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
    if (!body || typeof body !== "object") {
      throw new ItAdminGuardError("invalid_body", "Contact settings are required.", 422);
    }

    const existing = await supabase.from("it_communication_settings").select(SELECT)
      .eq("id", "default").maybeSingle<ContactSettings>();
    if (existing.error) throw new Error("communication_settings_read_failed");
    const current = existing.data ?? DEFAULTS;

    const patch: ContactSettings = {
      billing_email: pickText(body, "billing_email", current, 320).toLowerCase(),
      support_email: pickText(body, "support_email", current, 320).toLowerCase(),
      billing_sender_name: pickText(body, "billing_sender_name", current, 120),
      support_sender_name: pickText(body, "support_sender_name", current, 120),
      auto_send_store_activation: pickBool(body, "auto_send_store_activation", current),
      auto_send_payment_confirmation: pickBool(body, "auto_send_payment_confirmation", current),
      company_thai_name: pickText(body, "company_thai_name", current, 180),
      company_english_name: pickText(body, "company_english_name", current, 180),
      contact_phone: pickText(body, "contact_phone", current, 80),
      website_url: pickText(body, "website_url", current, 500),
      email_footer_note: pickText(body, "email_footer_note", current, 500)
    };

    if (!EMAIL.test(patch.billing_email) || !EMAIL.test(patch.support_email)
      || !patch.billing_sender_name || !patch.support_sender_name
      || !patch.company_thai_name || !patch.company_english_name
      || !patch.contact_phone || !validWebsite(patch.website_url)) {
      throw new ItAdminGuardError(
        "invalid_contact_settings",
        "กรุณาตรวจสอบชื่อบริษัท อีเมล เบอร์โทร เว็บไซต์ และชื่อผู้ส่งให้ถูกต้อง",
        422
      );
    }

    const saved = await supabase.from("it_communication_settings")
      .upsert({
        id: "default",
        ...patch,
        updated_by: auth.userId,
        updated_at: new Date().toISOString()
      }, { onConflict: "id" })
      .select(SELECT)
      .single<ContactSettings>();

    if (saved.error || !saved.data) throw new Error("communication_settings_update_failed");

    await appendAuditLog({
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "company_contact_email_settings_updated",
      targetTable: "it_communication_settings",
      module: "it_admin",
      beforeData: current,
      afterData: saved.data,
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ settings: saved.data });
  } catch (error) {
    return guardItAdminError(error);
  }
}
