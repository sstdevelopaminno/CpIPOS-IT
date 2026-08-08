import { invalidateRuntimeCacheByPrefix } from "@/lib/route-runtime-cache";

export function invalidatePosBranchRuntimeCaches(args: { tenantId: string; branchId: string }) {
  const { tenantId, branchId } = args;
  invalidateRuntimeCacheByPrefix(`pos-monitor:${tenantId}:${branchId}`);
  invalidateRuntimeCacheByPrefix(`pos-tables:${tenantId}:${branchId}`);
  invalidateRuntimeCacheByPrefix(`pos-sales:${tenantId}:${branchId}`);
}

export function invalidatePosTenantRuntimeCaches(args: { tenantId: string }) {
  const { tenantId } = args;
  invalidateRuntimeCacheByPrefix(`admin-pos-monitor:${tenantId}:`);
}

export function invalidatePosScopeRuntimeCaches(args: { tenantId: string; branchId: string }) {
  invalidatePosBranchRuntimeCaches(args);
  invalidatePosTenantRuntimeCaches({ tenantId: args.tenantId });
}
