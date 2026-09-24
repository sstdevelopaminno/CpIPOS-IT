import { readBoundedJson } from "@/lib/server/limited-json";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { POS_MENU_CATALOG, isValidPosMenuKey } from "@/lib/pos-menu-policy";
import { resolvePosMenuAvailability, type FeatureFlag, type PlanFlag, type ContractStatus } from "@/lib/pos-menu-effective-state";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    // Read the same independent IT switches plus the subscription feature
    // grants that the customer POS uses for each active store branch.
    const [tenant, rows, contract, branches, featureOverrides] = await Promise.all([
      admin.supabase.from("tenants").select("id").eq("id", tenantId).maybeSingle(),
      admin.supabase.from("tenant_pos_menu_policies").select("menu_key,is_enabled,updated_at")
        .eq("tenant_id", tenantId),
      admin.supabase.from("tenant_subscription_contracts")
        .select("package_id,status,ended_at").eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(1)
        .maybeSingle<{ package_id: string; status: string; ended_at: string | null }>(),
      admin.supabase.from("branches").select("id").eq("tenant_id", tenantId).eq("is_active", true),
      admin.supabase.from("tenant_feature_subscriptions")
        .select("feature_code,is_enabled,branch_id").eq("tenant_id", tenantId)
        .returns<FeatureFlag[]>()
    ]);
    if (tenant.error) throw tenant.error;
    if (!tenant.data) return fail("tenant_not_found", "ไม่พบร้านค้า", 404);
    if (rows.error) throw rows.error;
    if (contract.error) throw contract.error;
    if (branches.error) throw branches.error;
    if (featureOverrides.error) throw featureOverrides.error;
    const plan = contract.data?.package_id
      ? await admin.supabase.from("subscription_package_features")
        .select("feature_code,included").eq("package_id", contract.data.package_id)
        .returns<PlanFlag[]>()
      : { data: [] as PlanFlag[], error: null };
    if (plan.error) throw plan.error;
    const overrides = Object.fromEntries((rows.data ?? []).map(row => [row.menu_key, row.is_enabled]));
    const availability = resolvePosMenuAvailability({
      overrides,
      contract: (contract.data ?? null) as ContractStatus,
      plan: plan.data ?? [],
      feature_overrides: featureOverrides.data ?? [],
      active_branch_ids: (branches.data ?? []).map(branch => branch.id)
    });
    const response = ok({
      tenant_id: tenantId, catalog: POS_MENU_CATALOG, overrides, availability,
      total: POS_MENU_CATALOG.length,
      disabled: POS_MENU_CATALOG.filter(item => overrides[item.key] === false).length,
      unavailable: POS_MENU_CATALOG.filter(item => availability[item.key]?.reason !== "available").length
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const rate = await enforceRateLimit({
      namespace: "it_tenant_pos_menu_toggle", key: admin.auth.userId,
      max: 30, windowMs: 60_000
    });
    if (!rate.ok) return fail("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);
    const tenantId = parseTenantParam((await context.params).tenantId);
    const body = await readBoundedJson<{
      menu_key?: unknown; is_enabled?: unknown
    } | null>(request, 4_096);
    const key = typeof body?.menu_key === "string" ? body.menu_key.trim() : "";
    if (!isValidPosMenuKey(key) || typeof body?.is_enabled !== "boolean") {
      return fail("invalid_menu_policy", "กรุณาเลือกเมนูและสถานะที่ถูกต้อง", 422);
    }
    const existing = await admin.supabase.from("tenant_pos_menu_policies")
      .select("is_enabled").eq("tenant_id", tenantId).eq("menu_key", key)
      .maybeSingle<{ is_enabled: boolean }>();
    if (existing.error) throw existing.error;
    const next = await admin.supabase.from("tenant_pos_menu_policies")
      .upsert({
        tenant_id: tenantId, menu_key: key, is_enabled: body.is_enabled,
        updated_by: admin.auth.userId, updated_at: new Date().toISOString()
      }, { onConflict: "tenant_id,menu_key" })
      .select("menu_key,is_enabled,updated_at").single();
    if (next.error || !next.data) throw next.error ?? new Error("menu_policy_write_failed");
    await appendAuditLog({
      tenantId, actorUserId: admin.auth.userId, actorRole: "it_admin",
      action: "it_tenant_pos_menu_policy_changed",
      targetTable: "tenant_pos_menu_policies",
      beforeData: { menu_key: key, is_enabled: existing.data?.is_enabled ?? true },
      afterData: { menu_key: key, is_enabled: body.is_enabled },
      metadata: { menu_key: key },
      ipAddress: admin.requestMeta.ipAddress ?? undefined,
      userAgent: admin.requestMeta.userAgent ?? undefined
    });
    const response = ok({ tenant_id: tenantId, ...next.data });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}
