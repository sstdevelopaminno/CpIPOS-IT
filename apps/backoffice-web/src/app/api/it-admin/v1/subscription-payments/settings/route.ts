import { appendAuditLog } from "@/lib/audit-log";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type ContactSettings = {
  billing_email: string;
  support_email: string;
  billing_sender_name: string;
  support_sender_name: string;
};
const SELECT = "billing_email,support_email,billing_sender_name,support_sender_name";
const DEFAULTS: ContactSettings = {
  billing_email: "cuttingpointtech@gmail.com",
  support_email: "cuttingpointtech.support@gmail.com",
  billing_sender_name: "CUTTING POINTTECH",
  support_sender_name: "Cutting Point Tech Support"
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function read(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
  } catch (error) { return guardItAdminError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      throw new ItAdminGuardError("invalid_body", "Contact settings are required.", 422);
    }
    const patch: ContactSettings = {
      billing_email: read(body.billing_email, 320).toLowerCase(),
      support_email: read(body.support_email, 320).toLowerCase(),
      billing_sender_name: read(body.billing_sender_name, 120),
      support_sender_name: read(body.support_sender_name, 120)
    };
    if (!EMAIL.test(patch.billing_email) || !EMAIL.test(patch.support_email)
      || !patch.billing_sender_name || !patch.support_sender_name) {
      throw new ItAdminGuardError("invalid_contact_settings", "Enter valid business/Support emails and sender names.", 422);
    }
    const existing = await supabase.from("it_communication_settings").select(SELECT)
      .eq("id", "default").maybeSingle<ContactSettings>();
    if (existing.error) throw new Error("communication_settings_read_failed");
    const saved = await supabase.from("it_communication_settings")
      .upsert({ id: "default", ...patch, updated_by: auth.userId, updated_at: new Date().toISOString() },
        { onConflict: "id" }).select(SELECT).single<ContactSettings>();
    if (saved.error || !saved.data) throw new Error("communication_settings_update_failed");
    await appendAuditLog({
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "company_contact_email_settings_updated",
      targetTable: "it_communication_settings",
      module: "it_admin",
      beforeData: existing.data ?? DEFAULTS,
      afterData: saved.data,
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });
    return ok({ settings: saved.data });
  } catch (error) { return guardItAdminError(error); }
}
