import { readBoundedJson } from "@/lib/server/limited-json";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ tenantId: string }> };

async function assertTenantExists(tenantId: string, admin: Awaited<ReturnType<typeof requireItAdmin>>) {
  const result = await admin.supabase.from("tenants").select("id").eq("id", tenantId).maybeSingle<{ id: string }>();
  if (result.error) throw result.error;
  return Boolean(result.data);
}

export async function GET(_request: Request, context: Params) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    if (!(await assertTenantExists(tenantId, admin))) return fail("tenant_not_found", "ไม่พบร้านค้า", 404);
    const row = await admin.supabase.from("tenant_android_security_policies")
      .select("enforce_developer_options_off,updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle<{ enforce_developer_options_off: boolean; updated_at: string }>();
    if (row.error) throw row.error;
    const response = ok({
      tenant_id: tenantId,
      enforce_developer_options_off: row.data?.enforce_developer_options_off === true,
      updated_at: row.data?.updated_at ?? null
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}

export async function PATCH(request: Request, context: Params) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    const rate = await enforceRateLimit({
      namespace: "it_android_developer_policy", key: admin.auth.userId,
      max: 15, windowMs: 60_000
    });
    if (!rate.ok) return fail("rate_limited", "คำขอมากเกินไป กรุณาลองใหม่", 429);
    const body = await readBoundedJson<{ enforce_developer_options_off?: unknown } | null>(request, 2048);
    if (typeof body?.enforce_developer_options_off !== "boolean") {
      return fail("invalid_android_security_policy", "กรุณาระบุสถานะเปิดหรือปิดที่ถูกต้อง", 422);
    }
    if (!(await assertTenantExists(tenantId, admin))) return fail("tenant_not_found", "ไม่พบร้านค้า", 404);
    const existing = await admin.supabase.from("tenant_android_security_policies")
      .select("enforce_developer_options_off").eq("tenant_id", tenantId)
      .maybeSingle<{ enforce_developer_options_off: boolean }>();
    if (existing.error) throw existing.error;
    const next = await admin.supabase.from("tenant_android_security_policies")
      .upsert({
        tenant_id: tenantId,
        enforce_developer_options_off: body.enforce_developer_options_off,
        updated_by: admin.auth.userId,
        updated_at: new Date().toISOString()
      }, { onConflict: "tenant_id" })
      .select("enforce_developer_options_off,updated_at")
      .single<{ enforce_developer_options_off: boolean; updated_at: string }>();
    if (next.error || !next.data) throw next.error ?? new Error("android_security_policy_write_failed");
    await appendAuditLog({
      tenantId, actorUserId: admin.auth.userId, actorRole: "it_admin",
      action: "it_tenant_android_security_policy_changed",
      targetTable: "tenant_android_security_policies",
      beforeData: { enforce_developer_options_off: existing.data?.enforce_developer_options_off === true },
      afterData: { enforce_developer_options_off: next.data.enforce_developer_options_off },
      metadata: { scope: "all_android_native_devices_in_tenant" },
      ipAddress: admin.requestMeta.ipAddress ?? undefined,
      userAgent: admin.requestMeta.userAgent ?? undefined
    });
    const response = ok({ tenant_id: tenantId, ...next.data });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}
