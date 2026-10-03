import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { customerEmailProblem } from "@/lib/services/it-admin/customer-email-service";

export const dynamic = "force-dynamic";

type Owner = {
  user_id: string | null;
  full_name: string;
  email: string;
  is_active: boolean;
};

async function loadState(
  admin: Awaited<ReturnType<typeof requireItAdmin>>,
  tenantId: string
) {
  const [tenantResult, settingResult, deliveryResult] = await Promise.all([
    admin.supabase
      .from("tenants")
      .select("id,name,display_name,owner_name,primary_owner_user_id,is_active")
      .eq("id", tenantId)
      .maybeSingle<{
        id: string;
        name: string;
        display_name: string | null;
        owner_name: string | null;
        primary_owner_user_id: string | null;
        is_active: boolean;
      }>(),
    admin.supabase
      .from("tenant_daily_sales_email_settings")
      .select("tenant_id,enabled,updated_by,updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle<{
        tenant_id: string;
        enabled: boolean;
        updated_by: string | null;
        updated_at: string;
      }>(),
    admin.supabase
      .from("customer_email_deliveries")
      .select("id,event_key,recipient_email,status,attempt_count,last_attempt_at,sent_at,last_error,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .eq("event_type", "daily_sales_summary")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{
        id: string;
        event_key: string;
        recipient_email: string;
        status: string;
        attempt_count: number;
        last_attempt_at: string | null;
        sent_at: string | null;
        last_error: string | null;
        created_at: string;
        updated_at: string;
      }>()
  ]);

  if (tenantResult.error) throw new Error("daily_sales_email_tenant_read_failed:" + tenantResult.error.message);
  if (!tenantResult.data) return null;
  if (settingResult.error) throw new Error("daily_sales_email_setting_read_failed:" + settingResult.error.message);
  if (deliveryResult.error) throw new Error("daily_sales_email_delivery_read_failed:" + deliveryResult.error.message);

  const tenant = tenantResult.data;
  let owner: Owner = {
    user_id: tenant.primary_owner_user_id,
    full_name: tenant.owner_name || tenant.display_name || tenant.name,
    email: "",
    is_active: false
  };

  if (tenant.primary_owner_user_id) {
    const profile = await admin.supabase
      .from("users_profiles")
      .select("id,full_name,email,is_active,archived_at")
      .eq("id", tenant.primary_owner_user_id)
      .maybeSingle<{
        id: string;
        full_name: string | null;
        email: string | null;
        is_active: boolean;
        archived_at: string | null;
      }>();
    if (profile.error) throw new Error("daily_sales_email_owner_read_failed:" + profile.error.message);
    if (profile.data) {
      owner = {
        user_id: profile.data.id,
        full_name: profile.data.full_name?.trim() || owner.full_name,
        email: profile.data.email?.trim().toLowerCase() || "",
        is_active: Boolean(profile.data.is_active && !profile.data.archived_at)
      };
    }
  }

  const emailProblem = owner.email ? customerEmailProblem(owner.email) : "ยังไม่มีอีเมล Owner";

  return {
    tenant: {
      id: tenant.id,
      name: tenant.display_name || tenant.name,
      is_active: tenant.is_active
    },
    enabled: Boolean(settingResult.data?.enabled),
    owner: {
      ...owner,
      email_valid: Boolean(owner.email && !emailProblem),
      email_problem: emailProblem || null
    },
    schedule: {
      timezone: "Asia/Bangkok",
      cutoff: "00:00",
      send_at: "00:15",
      business_day_rule: "[00:00, 00:00 วันถัดไป)",
      only_when_completed_sales: true
    },
    last_delivery: deliveryResult.data ?? null,
    updated_at: settingResult.data?.updated_at ?? null
  };
}

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const { tenantId: rawTenantId } = await context.params;
    const tenantId = parseTenantParam(rawTenantId);
    const state = await loadState(admin, tenantId);
    if (!state) return fail("tenant_not_found", "ไม่พบร้านค้า", 404);
    const response = ok(state);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const { tenantId: rawTenantId } = await context.params;
    const tenantId = parseTenantParam(rawTenantId);
    const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== "boolean") {
      return fail("daily_sales_email_enabled_required", "enabled must be true or false", 422);
    }

    const before = await loadState(admin, tenantId);
    if (!before) return fail("tenant_not_found", "ไม่พบร้านค้า", 404);

    if (body.enabled) {
      if (!before.tenant.is_active) {
        return fail("tenant_inactive", "ร้านถูกปิดใช้งาน จึงไม่สามารถเปิดการส่งสรุปยอดขายได้", 409);
      }
      if (!before.owner.user_id || !before.owner.is_active) {
        return fail("owner_not_ready", "Owner ของร้านยังไม่พร้อมใช้งาน กรุณาตรวจสอบผู้ใช้งาน Owner ก่อน", 422);
      }
      if (!before.owner.email_valid) {
        return fail("owner_email_invalid", before.owner.email_problem || "อีเมล Owner ไม่ถูกต้อง", 422);
      }
    }

    const now = new Date().toISOString();
    const upsert = await admin.supabase
      .from("tenant_daily_sales_email_settings")
      .upsert({
        tenant_id: tenantId,
        enabled: body.enabled,
        updated_by: admin.auth.userId,
        updated_at: now
      }, { onConflict: "tenant_id" });
    if (upsert.error) throw new Error("daily_sales_email_setting_update_failed:" + upsert.error.message);

    await appendAuditLog({
      tenantId,
      actorUserId: admin.auth.userId,
      actorRole: admin.auth.platformRole,
      action: body.enabled ? "daily_sales_summary_email_enabled" : "daily_sales_summary_email_disabled",
      targetTable: "tenant_daily_sales_email_settings",
      targetId: tenantId,
      module: "it_admin",
      beforeData: { enabled: before.enabled, recipient_email: before.owner.email || null },
      afterData: { enabled: body.enabled, recipient_email: before.owner.email || null },
      metadata: {
        schedule_timezone: "Asia/Bangkok",
        cutoff: "00:00",
        send_at: "00:15",
        recipient_source: "tenants.primary_owner_user_id -> users_profiles.email"
      },
      ipAddress: admin.requestMeta.ipAddress ?? undefined,
      userAgent: admin.requestMeta.userAgent ?? undefined
    });

    const state = await loadState(admin, tenantId);
    if (!state) return fail("tenant_not_found", "ไม่พบร้านค้า", 404);
    return ok(state);
  } catch (error) {
    return guardItAdminError(error);
  }
}
