import "server-only";

import { redirect } from "next/navigation";
import { requireTenantFeature } from "@/lib/feature-gate";
import { featureForPosPermission } from "@/lib/pos-feature-map";
import { requirePermission, requirePosSession, type PosPermission, type PosSessionScope } from "@/lib/pos-session-guard";

export async function requirePosPagePermission(permission: PosPermission, fallbackPath = "/preview/pos"): Promise<PosSessionScope> {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, permission);
    const feature = featureForPosPermission(permission);
    if (feature) {
      await requireTenantFeature(scope.session.tenant_id, feature, scope.session.branch_id);
    }
    return scope;
  } catch {
    redirect(fallbackPath);
  }
}
