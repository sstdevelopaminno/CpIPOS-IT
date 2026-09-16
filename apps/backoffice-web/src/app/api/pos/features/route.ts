import { FeatureGateError, hasBranchFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { allPosMenuFeatureCodes } from "@/lib/pos-feature-map";
import { normalizePosSalesModes } from "@/lib/pos-sales-modes";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type ContractRow = {
  metadata: Record<string, unknown> | null;
};

async function loadSalesModes(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_subscription_contracts")
    .select("metadata")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ContractRow>();

  if (error) throw new FeatureGateError("sales_modes_query_failed", error.message, 500);
  return normalizePosSalesModes(data?.metadata?.sales_modes);
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const scope = await requirePosSession();
    const featureCodes = allPosMenuFeatureCodes();
    const decisions = await Promise.all(
      featureCodes.map(async (featureCode) => [featureCode, await hasBranchFeature(scope.session.tenant_id, scope.session.branch_id, featureCode)] as const)
    );
    const response = ok({
      features: Object.fromEntries(decisions),
      sales_modes: await loadSalesModes(scope.session.tenant_id)
    });
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-pos-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const status = error instanceof PosGuardError || error instanceof FeatureGateError ? error.status : 500;
    const code = error instanceof PosGuardError || error instanceof FeatureGateError ? error.code : "pos_features_failed";
    const message = error instanceof Error ? error.message : "Unable to load POS features.";
    const response = fail(code, message, status);
    response.headers.set("cache-control", "no-store");
    response.headers.set("x-pos-api-ms", String(Date.now() - startedAt));
    return response;
  }
}
