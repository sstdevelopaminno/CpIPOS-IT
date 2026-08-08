import "server-only";

import { isFeatureUnlockEnabled } from "@/lib/feature-unlock";
import { FeatureGateError, hasBranchFeature } from "@/lib/server/feature-gate";

function isMissingFeatureSchemaError(error: unknown) {
  if (!(error instanceof FeatureGateError)) return false;
  const message = String(error.message ?? "");
  return (
    message.includes("Could not find the table 'public.tenant_subscription_contracts'") ||
    message.includes("Could not find the table 'public.subscription_package_features'") ||
    message.includes("Could not find the table 'public.tenant_feature_subscriptions'") ||
    message.includes("Could not find the table 'public.package_feature_catalog'")
  );
}

export async function hasBranchFeatureSafe(tenantId: string, branchId: string, featureKey: string): Promise<boolean> {
  if (isFeatureUnlockEnabled()) return true;
  try {
    return await hasBranchFeature(tenantId, branchId, featureKey);
  } catch (error) {
    if (!isMissingFeatureSchemaError(error)) {
      throw error;
    }

    if (process.env.NODE_ENV === "production") {
      return false;
    }

    console.warn("[feature-gate-safe] Missing subscription schema in non-production. Allowing feature check for local preview.", {
      tenantId,
      branchId,
      featureKey
    });
    return true;
  }
}
