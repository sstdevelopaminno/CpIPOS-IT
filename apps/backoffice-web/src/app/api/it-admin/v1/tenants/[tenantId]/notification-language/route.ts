import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { appendAuditLog } from "@/lib/audit-log";
import { readBoundedJson } from "@/lib/server/limited-json";

export const dynamic = "force-dynamic";
type NotificationLanguage = "th" | "en" | "lo";
const permitted = (value: unknown): value is NotificationLanguage => value === "th" || value === "en" || value === "lo";

async function getTenant(tenantId: string) {
  const ctx = await requireItAdmin();
  const result = await ctx.supabase.from("tenants")
    .select("id,code,display_name,name,metadata,updated_at").eq("id", tenantId)
    .maybeSingle<{ id:string; code:string; display_name:string|null; name:string; updated_at:string; metadata:Record<string,unknown>|null }>();
  if (result.error) throw result.error;
  return { ctx, tenant: result.data };
}

export async function GET(_request: Request, { params }: {params: Promise<{tenantId:string}>}) {
  try {
    const tenantId = parseTenantParam((await params).tenantId);
    const { tenant } = await getTenant(tenantId);
    if (!tenant) return fail("tenant_not_found", "ไม่พบร้านค้า", 404);
    const language = permitted(tenant.metadata?.notification_language) ? tenant.metadata.notification_language : "th";
    const response = ok({ tenant_id:tenant.id, tenant_code:tenant.code, store_name:tenant.display_name || tenant.name,
      language, supported_languages:["th","en","lo"], channels:["email","push"],
      description:"This sets the default language for outbound system notifications, not the cashier screen language." });
    response.headers.set("Cache-Control","private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}

export async function PATCH(request: Request, { params }: {params: Promise<{tenantId:string}>}) {
  try {
    const tenantId = parseTenantParam((await params).tenantId);
    const { ctx, tenant } = await getTenant(tenantId);
    if (ctx.profile.platform_role !== "it_admin" && ctx.profile.platform_role !== "it_support")
      return fail("it_role_required", "เฉพาะฝ่าย IT เท่านั้น", 403);
    if (!tenant) return fail("tenant_not_found", "ไม่พบร้านค้า", 404);
    const body = await readBoundedJson<{language?:unknown; expected_language?:unknown} | null>(request, 1024);
    if (!permitted(body?.language)) return fail("invalid_language", "รองรับภาษาไทย อังกฤษ และลาวเท่านั้น", 422);
    const previous = permitted(tenant.metadata?.notification_language) ? tenant.metadata.notification_language : "th";
    if (body?.expected_language !== previous) return fail("language_conflict", "มีการเปลี่ยนค่า กรุณาโหลดข้อมูลใหม่", 409);
    if (body.language === previous) return ok({ language: previous, unchanged:true });
    // Optimistic concurrency prevents overwriting unrelated metadata edits.
    const result = await ctx.supabase.from("tenants")
      .update({ metadata:{ ...(tenant.metadata ?? {}), notification_language: body.language } })
      .eq("id", tenantId).eq("updated_at", tenant.updated_at)
      .select("id").maybeSingle<{id:string}>();
    if (result.error) throw result.error;
    if (!result.data) return fail("language_conflict", "มีการเปลี่ยนข้อมูลร้านพร้อมกัน กรุณาโหลดข้อมูลใหม่", 409);
    await appendAuditLog({
      tenantId, actorUserId:ctx.auth.userId, actorRole:ctx.profile.platform_role ?? "it_admin",
      action:"it_tenant_notification_language_updated", targetTable:"tenants", targetId:tenantId,
      beforeData:{notification_language:previous}, afterData:{notification_language:body.language},
      metadata:{channels:["email","push"],setting:"outbound_notification_language"},
      ipAddress:ctx.requestMeta.ipAddress ?? undefined, userAgent:ctx.requestMeta.userAgent ?? undefined
    });
    return ok({ language:body.language });
  } catch(error) { return guardItAdminError(error); }
}
