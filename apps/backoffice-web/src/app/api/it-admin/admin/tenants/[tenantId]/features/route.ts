import { appendAuditLog } from "@/lib/audit-log";
import { invalidateTenantFeatureGateCache } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";

type FeaturePayload = {
  feature_code?: string;
  is_enabled?: boolean;
  branch_id?: string | null;
};

type FeatureCatalogRow = {
  code: string;
  name: string;
  description: string;
  is_active: boolean;
};

type FeatureSubscriptionRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  feature_code: string;
  is_enabled: boolean;
  source: string;
  updated_at: string;
};

type ContractRow = {
  id: string;
  package_id: string;
  status: string;
  ended_at: string | null;
};

export async function GET(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { supabase } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branch_id")?.trim() || null;

    const [{ data: catalog, error: catalogError }, { data: contract, error: contractError }] = await Promise.all([
      supabase.from("package_feature_catalog").select("code,name,description,is_active").eq("is_active", true).returns<FeatureCatalogRow[]>(),
      supabase
        .from("tenant_subscription_contracts")
        .select("id,package_id,status,ended_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<ContractRow>()
    ]);

    if (catalogError) {
      throw new Error(catalogError.message);
    }
    if (contractError) {
      throw new Error(contractError.message);
    }

    const contractActive =
      Boolean(contract) &&
      (contract?.status === "active" || contract?.status === "trial") &&
      (!contract?.ended_at || new Date(contract.ended_at).getTime() > Date.now());

    const [{ data: planFeatures, error: planFeatureError }, { data: tenantOverrides, error: tenantOverrideError }, { data: branchOverrides, error: branchOverrideError }] = await Promise.all([
      contract?.package_id
        ? supabase
            .from("subscription_package_features")
            .select("feature_code,included")
            .eq("package_id", contract.package_id)
            .returns<Array<{ feature_code: string; included: boolean | null }>>()
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("tenant_feature_subscriptions")
        .select("id,tenant_id,branch_id,feature_code,is_enabled,source,updated_at")
        .eq("tenant_id", tenantId)
        .is("branch_id", null)
        .returns<FeatureSubscriptionRow[]>(),
      branchId
        ? supabase
            .from("tenant_feature_subscriptions")
            .select("id,tenant_id,branch_id,feature_code,is_enabled,source,updated_at")
            .eq("tenant_id", tenantId)
            .eq("branch_id", branchId)
            .returns<FeatureSubscriptionRow[]>()
        : Promise.resolve({ data: [], error: null })
    ]);

    if (planFeatureError) {
      throw new Error(planFeatureError.message);
    }
    if (tenantOverrideError) {
      throw new Error(tenantOverrideError.message);
    }
    if (branchOverrideError) {
      throw new Error(branchOverrideError.message);
    }

    const planFeatureMap = new Map<string, boolean>();
    for (const row of planFeatures ?? []) {
      planFeatureMap.set(String(row.feature_code), Boolean(row.included));
    }

    const tenantOverrideMap = new Map<string, FeatureSubscriptionRow>();
    for (const row of tenantOverrides ?? []) {
      tenantOverrideMap.set(row.feature_code, row);
    }

    const branchOverrideMap = new Map<string, FeatureSubscriptionRow>();
    for (const row of branchOverrides ?? []) {
      branchOverrideMap.set(row.feature_code, row);
    }

    return ok({
      branch_id: branchId,
      features: (catalog ?? []).map((feature) => {
        const tenantOverride = tenantOverrideMap.get(feature.code);
        const branchOverride = branchOverrideMap.get(feature.code);
        const planEnabled = contractActive ? Boolean(planFeatureMap.get(feature.code)) : false;
        let enabled = planEnabled;
        let source = planEnabled ? "plan" : "none";

        if (tenantOverride) {
          enabled = tenantOverride.is_enabled;
          source = "tenant_override";
        }

        if (branchOverride) {
          enabled = branchOverride.is_enabled;
          source = "branch_override";
        }

        if (!contractActive) {
          enabled = false;
          source = "contract_inactive";
        }

        return {
          code: feature.code,
          name: feature.name,
          description: feature.description,
          is_enabled: enabled,
          source,
          subscription_id: branchOverride?.id ?? tenantOverride?.id ?? null,
          updated_at: branchOverride?.updated_at ?? tenantOverride?.updated_at ?? null
        };
      })
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = (await req.json()) as FeaturePayload;
    const featureCode = String(body.feature_code ?? "").trim();
    const branchId = typeof body.branch_id === "string" ? body.branch_id.trim() || null : null;

    if (!featureCode || typeof body.is_enabled !== "boolean") {
      return fail("invalid_payload", "feature_code and is_enabled are required.", 422);
    }

    if (branchId) {
      const { data: branch, error: branchError } = await supabase
        .from("branches")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("id", branchId)
        .maybeSingle<{ id: string }>();
      if (branchError) {
        throw new Error(branchError.message);
      }
      if (!branch) {
        return fail("forbidden_branch_scope", "Branch does not belong to this tenant.", 403);
      }
    }

    let current: FeatureSubscriptionRow | null = null;
    {
      let query = supabase
        .from("tenant_feature_subscriptions")
        .select("id,tenant_id,branch_id,feature_code,is_enabled,source,updated_at")
        .eq("tenant_id", tenantId)
        .eq("feature_code", featureCode)
        .limit(1);

      query = branchId ? query.eq("branch_id", branchId) : query.is("branch_id", null);

      const { data, error } = await query.maybeSingle<FeatureSubscriptionRow>();
      if (error) {
        throw new Error(error.message);
      }
      current = data ?? null;
    }

    const payload = {
      tenant_id: tenantId,
      branch_id: branchId,
      feature_code: featureCode,
      is_enabled: body.is_enabled,
      source: "override"
    };

    let updated: FeatureSubscriptionRow;
    if (current) {
      const { data, error } = await supabase
        .from("tenant_feature_subscriptions")
        .update({ is_enabled: body.is_enabled, source: "override" })
        .eq("id", current.id)
        .select("id,tenant_id,branch_id,feature_code,is_enabled,source,updated_at")
        .single<FeatureSubscriptionRow>();

      if (error) {
        throw new Error(error.message);
      }
      updated = data;
    } else {
      const { data, error } = await supabase
        .from("tenant_feature_subscriptions")
        .insert(payload)
        .select("id,tenant_id,branch_id,feature_code,is_enabled,source,updated_at")
        .single<FeatureSubscriptionRow>();

      if (error) {
        throw new Error(error.message);
      }
      updated = data;
    }

    invalidateTenantFeatureGateCache(tenantId);

    await appendAuditLog({
      tenantId,
      branchId: branchId ?? undefined,
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: body.is_enabled ? "feature_enabled" : "feature_disabled",
      targetTable: "tenant_feature_subscriptions",
      targetId: updated.id,
      beforeData: current ?? undefined,
      afterData: updated,
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ feature: updated });
  } catch (error) {
    return guardItAdminError(error);
  }
}

