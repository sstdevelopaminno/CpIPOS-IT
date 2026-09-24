import { appendAuditLog } from "@/lib/audit-log";
import { hasBranchFeature, invalidateTenantFeatureGateCache } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
const FEATURE = "customer_facing_display";

export async function GET(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    const branchId = new URL(req.url).searchParams.get("branch_id")?.trim();
    if (!branchId) return fail("branch_required", "branch_id is required.", 422);
    const branch = await admin.supabase.from("branches").select("id")
      .eq("tenant_id", tenantId).eq("id", branchId).maybeSingle();
    if (branch.error) throw branch.error;
    if (!branch.data) return fail("branch_not_found", "Branch is not in this store.", 404);
    const enabled = await hasBranchFeature(tenantId, branchId, FEATURE);
    const response = ok({ tenant_id: tenantId, branch_id: branchId, feature_code: FEATURE, enabled });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) { return guardItAdminError(error); }
}

export async function PATCH(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const admin = await requireItAdmin();
    const tenantId = parseTenantParam((await context.params).tenantId);
    const limit = await enforceRateLimit({
      namespace: "it_dual_screen_feature_override", key: admin.auth.userId,
      max: 15, windowMs: 60_000
    });
    if (!limit.ok) return fail("rate_limited", "Try again shortly.", 429);
    const body = await req.json().catch(() => null) as { branch_id?: unknown; enabled?: unknown } | null;
    const branchId = typeof body?.branch_id === "string" ? body.branch_id.trim() : "";
    if (!branchId || typeof body?.enabled !== "boolean") {
      return fail("invalid_body", "branch_id and boolean enabled are required.", 422);
    }
    const branch = await admin.supabase.from("branches")
      .select("id").eq("id", branchId).eq("tenant_id", tenantId).maybeSingle();
    if (branch.error) throw branch.error;
    if (!branch.data) return fail("branch_not_found", "Branch is not in this store.", 404);
    const before = await hasBranchFeature(tenantId, branchId, FEATURE);
    const update = await admin.supabase.from("tenant_feature_subscriptions")
      .upsert({
        tenant_id: tenantId, branch_id: branchId, feature_code: FEATURE,
        is_enabled: body.enabled, source: "override", updated_at: new Date().toISOString()
      }, { onConflict: "tenant_id,branch_id,feature_code" });
    if (update.error) throw update.error;
    invalidateTenantFeatureGateCache(tenantId);
    await appendAuditLog({
      tenantId, branchId,
      actorUserId: admin.auth.userId, actorRole: "it_admin",
      action: "it_customer_facing_display_entitlement_changed",
      targetTable: "tenant_feature_subscriptions",
      beforeData: { enabled: before },
      afterData: { enabled: body.enabled },
      metadata: { feature_code: FEATURE, scope: "branch", source: "it_admin_override" },
      ipAddress: admin.requestMeta.ipAddress ?? undefined,
      userAgent: admin.requestMeta.userAgent ?? undefined
    });
    return ok({
      tenant_id: tenantId, branch_id: branchId,
      feature_code: FEATURE, enabled: body.enabled,
      note: "POS customer-display feature gates refresh within their normal cache TTL."
    });
  } catch (error) { return guardItAdminError(error); }
}
