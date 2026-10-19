import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
const BASELINE_FEATURES = ["pos.sales.access", "core_pos_sales"] as const;

type Contract = { id: string; package_id: string; status: string; ended_at: string | null; metadata: Record<string, unknown> | null };
type Grant = { id: string; is_enabled: boolean; source: string };
type Policy = { is_enabled: boolean };

export async function POST(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const rate = await enforceRateLimit({ namespace: "it_optical_sales_activate", key: admin.auth.userId, max: 8, windowMs: 60_000 });
    if (!rate.ok) return fail("rate_limited", "กรุณารอสักครู่แล้วลองอีกครั้ง", 429);
    const tenantId = parseTenantParam((await context.params).tenantId);
    const [tenant, contract, lifecycle] = await Promise.all([
      admin.supabase.from("tenants").select("id").eq("id", tenantId).maybeSingle(),
      admin.supabase.from("tenant_subscription_contracts")
        .select("id,package_id,status,ended_at,metadata").eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle<Contract>(),
      admin.supabase.from("tenant_data_lifecycle")
        .select("access_locked,trial_expires_at,subscription_expires_at").eq("tenant_id", tenantId).maybeSingle()
    ]);
    if (tenant.error || contract.error || lifecycle.error) throw tenant.error ?? contract.error ?? lifecycle.error;
    if (!tenant.data || !contract.data) return fail("tenant_or_contract_missing", "ไม่พบร้านหรือสัญญา", 404);
    const c = contract.data;
    const now = Date.now();
    const active = (c.status === "active" || c.status === "trial") &&
      (!c.ended_at || Date.parse(c.ended_at) > now) && lifecycle.data?.access_locked !== true &&
      (c.status !== "trial" || !lifecycle.data?.trial_expires_at || Date.parse(lifecycle.data.trial_expires_at) > now);
    const modes = c.metadata?.sales_modes;
    if (!active || !modes || typeof modes !== "object" || Array.isArray(modes) ||
      (modes as Record<string, unknown>).optical_retail !== true) {
      return fail("optical_contract_not_active", "สัญญา CUSTOM Optical ยังไม่พร้อมใช้งาน", 409);
    }
    const packageLookup = await admin.supabase.from("subscription_packages")
      .select("code").eq("id", c.package_id).maybeSingle<{ code: string }>();
    if (packageLookup.error) throw packageLookup.error;
    if (String(packageLookup.data?.code ?? "").toLowerCase() !== "custom") {
      return fail("custom_only", "อนุญาตเฉพาะสัญญา CUSTOM Optical", 403);
    }

    const activeBranches = await admin.supabase.from("branches")
      .select("id").eq("tenant_id", tenantId).eq("is_active", true);
    if (activeBranches.error) throw activeBranches.error;
    if (!activeBranches.data?.length) return fail("no_active_branch", "ไม่พบสาขาที่ใช้งานได้", 409);
    const explicitlyDenied = await admin.supabase.from("tenant_feature_subscriptions")
      .select("feature_code,branch_id").eq("tenant_id", tenantId).in("feature_code", [...BASELINE_FEATURES])
      .eq("is_enabled", false).not("branch_id", "is", null);
    if (explicitlyDenied.error) throw explicitlyDenied.error;
    if (explicitlyDenied.data?.some(row => activeBranches.data.some(b => b.id === row.branch_id))) {
      return fail("branch_feature_denied", "มีสาขาที่ IT ปฏิเสธสิทธิ์ขายไว้ กรุณาตรวจสิทธิ์สาขาก่อน", 409);
    }

    const catalog = await admin.supabase.from("package_feature_catalog")
      .select("code").in("code", [...BASELINE_FEATURES]);
    if (catalog.error) throw catalog.error;
    if (catalog.data?.length !== BASELINE_FEATURES.length) throw new Error("pos_feature_catalog_incomplete");
    // Idempotent authenticated maintenance; scope is the exact tenant ONLY.
    for (const code of BASELINE_FEATURES) {
      const previous = await admin.supabase.from("tenant_feature_subscriptions")
        .select("id,is_enabled,source").eq("tenant_id", tenantId)
        .is("branch_id", null).eq("feature_code", code).maybeSingle<Grant>();
      if (previous.error) throw previous.error;
      if (previous.data?.is_enabled === true) continue;
      const write = previous.data
        ? await admin.supabase.from("tenant_feature_subscriptions")
          .update({ is_enabled: true, source: "it_custom_optical_activation", updated_at: new Date().toISOString() })
          .eq("id", previous.data.id).select("id,is_enabled,source").single<Grant>()
        : await admin.supabase.from("tenant_feature_subscriptions")
          .insert({ tenant_id: tenantId, branch_id: null, feature_code: code,
            is_enabled: true, source: "it_custom_optical_activation" })
          .select("id,is_enabled,source").single<Grant>();
      if (write.error || !write.data) throw write.error ?? new Error("feature_grant_write_failed");
      await appendAuditLog({ tenantId, actorUserId: admin.auth.userId, actorRole: "it_admin",
        action: "it_custom_optical_pos_sales_feature_enabled", targetTable: "tenant_feature_subscriptions",
        targetId: write.data.id, beforeData: previous.data ?? {}, afterData: { ...write.data, feature_code: code },
        metadata: { feature_code: code, source: "it_optical_sales_activate" },
        ipAddress: admin.requestMeta.ipAddress ?? undefined, userAgent: admin.requestMeta.userAgent ?? undefined
      });
    }
    const existingMenu = await admin.supabase.from("tenant_pos_menu_policies")
      .select("is_enabled").eq("tenant_id", tenantId).eq("menu_key", "main.sales")
      .maybeSingle<Policy>();
    if (existingMenu.error) throw existingMenu.error;
    if (existingMenu.data?.is_enabled !== true) {
      const write = await admin.supabase.from("tenant_pos_menu_policies").upsert({
        tenant_id: tenantId, menu_key: "main.sales", is_enabled: true,
        updated_by: admin.auth.userId, updated_at: new Date().toISOString()
      }, { onConflict: "tenant_id,menu_key" }).select("menu_key,is_enabled").single();
      if (write.error || !write.data) throw write.error ?? new Error("sales_menu_write_failed");
      await appendAuditLog({ tenantId, actorUserId: admin.auth.userId, actorRole: "it_admin",
        action: "it_custom_optical_sales_menu_enabled", targetTable: "tenant_pos_menu_policies",
        beforeData: { menu_key: "main.sales", is_enabled: existingMenu.data?.is_enabled ?? null },
        afterData: write.data, metadata: { source: "it_optical_sales_activate" },
        ipAddress: admin.requestMeta.ipAddress ?? undefined, userAgent: admin.requestMeta.userAgent ?? undefined
      });
    }
    const response = ok({ tenant_id: tenantId, activated: true, feature_codes: BASELINE_FEATURES, menu_key: "main.sales" });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}
