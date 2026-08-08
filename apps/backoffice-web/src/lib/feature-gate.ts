import "server-only";

import { isFeatureUnlockEnabled } from "@/lib/feature-unlock";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type QuotaResourceType = "branches" | "devices" | "users";

export type TenantLimits = {
  contractId: string | null;
  planId: string | null;
  contractStatus: string | null;
  maxBranches: number | null;
  maxDevices: number | null;
  maxUsers: number | null;
  usage: {
    branches: number;
    devices: number;
    users: number;
  };
};

type ContractRow = {
  id: string;
  tenant_id: string;
  package_id: string;
  status: string;
  branch_limit: number | null;
  terminal_limit_per_branch: number | null;
  max_branches: number | null;
  max_devices: number | null;
  max_users: number | null;
  metadata: Record<string, unknown> | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
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

type FeatureDecisionCacheEntry = {
  enabled: boolean;
  expiresAt: number;
};

const FEATURE_DECISION_CACHE_TTL_MS = 15_000;

export class FeatureGateError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "FeatureGateError";
    this.code = code;
    this.status = status;
  }
}

function getFeatureDecisionCache() {
  const scopedGlobal = globalThis as typeof globalThis & {
    __featureDecisionCache?: Map<string, FeatureDecisionCacheEntry>;
  };
  if (!scopedGlobal.__featureDecisionCache) {
    scopedGlobal.__featureDecisionCache = new Map<string, FeatureDecisionCacheEntry>();
  }
  return scopedGlobal.__featureDecisionCache;
}

function readFeatureDecisionCache(cacheKey: string): boolean | null {
  const cache = getFeatureDecisionCache();
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    return null;
  }
  return entry.enabled;
}

function writeFeatureDecisionCache(cacheKey: string, enabled: boolean) {
  const cache = getFeatureDecisionCache();
  cache.set(cacheKey, {
    enabled,
    expiresAt: Date.now() + FEATURE_DECISION_CACHE_TTL_MS
  });
}

export function invalidateTenantFeatureGateCache(tenantId?: string | null) {
  const cache = getFeatureDecisionCache();
  if (!tenantId) {
    cache.clear();
    return;
  }
  const prefix = `${tenantId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

function parseLimit(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const normalized = Math.trunc(numeric);
  return normalized > 0 ? normalized : null;
}

function contractAllowsAccess(contract: ContractRow | null): boolean {
  if (!contract) return false;
  if (contract.status !== "active" && contract.status !== "trial") {
    return false;
  }

  if (contract.ended_at) {
    const endMs = new Date(contract.ended_at).getTime();
    if (Number.isFinite(endMs) && endMs <= Date.now()) {
      return false;
    }
  }

  return true;
}

async function getLatestContract(tenantId: string): Promise<ContractRow | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_subscription_contracts")
    .select("id,tenant_id,package_id,status,branch_limit,terminal_limit_per_branch,max_branches,max_devices,max_users,metadata,started_at,ended_at,created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ContractRow>();

  if (error) {
    throw new FeatureGateError("contract_query_failed", error.message, 500);
  }

  return data ?? null;
}

export async function hasBranchFeature(tenantId: string, branchId: string | null, featureKey: string): Promise<boolean> {
  const featureCode = String(featureKey).trim();
  if (!tenantId || !featureCode) return false;
  if (isFeatureUnlockEnabled()) return true;
  const normalizedBranchId = branchId || "tenant";
  const cacheKey = `${tenantId}:${normalizedBranchId}:${featureCode}`;
  const cached = readFeatureDecisionCache(cacheKey);
  if (cached !== null) return cached;

  const contract = await getLatestContract(tenantId);
  if (!contractAllowsAccess(contract)) {
    writeFeatureDecisionCache(cacheKey, false);
    return false;
  }

  const supabase = getSupabaseServiceClient();
  const [{ data: planFeatureRow, error: planFeatureError }, { data: tenantOverride, error: tenantOverrideError }, { data: branchOverride, error: branchOverrideError }] = await Promise.all([
    supabase
      .from("subscription_package_features")
      .select("included")
      .eq("package_id", contract?.package_id ?? "")
      .eq("feature_code", featureCode)
      .maybeSingle<{ included: boolean | null }>(),
    supabase
      .from("tenant_feature_subscriptions")
      .select("id,tenant_id,branch_id,feature_code,is_enabled,source,updated_at")
      .eq("tenant_id", tenantId)
      .eq("feature_code", featureCode)
      .is("branch_id", null)
      .maybeSingle<FeatureSubscriptionRow>(),
    branchId
      ? supabase
          .from("tenant_feature_subscriptions")
          .select("id,tenant_id,branch_id,feature_code,is_enabled,source,updated_at")
          .eq("tenant_id", tenantId)
          .eq("branch_id", branchId)
          .eq("feature_code", featureCode)
          .maybeSingle<FeatureSubscriptionRow>()
      : Promise.resolve({ data: null, error: null })
  ]);

  if (planFeatureError) {
    throw new FeatureGateError("plan_feature_query_failed", planFeatureError.message, 500);
  }
  if (tenantOverrideError) {
    throw new FeatureGateError("feature_override_query_failed", tenantOverrideError.message, 500);
  }
  if (branchOverrideError) {
    throw new FeatureGateError("branch_feature_override_query_failed", branchOverrideError.message, 500);
  }

  let enabled = Boolean(planFeatureRow?.included);

  if (tenantOverride) {
    enabled = tenantOverride.is_enabled;
  }

  if (branchOverride) {
    enabled = branchOverride.is_enabled;
  }

  writeFeatureDecisionCache(cacheKey, enabled);
  return enabled;
}

export async function hasTenantFeature(tenantId: string, featureKey: string): Promise<boolean> {
  return hasBranchFeature(tenantId, null, featureKey);
}

export async function isFeatureKeyConfigured(featureKey: string): Promise<boolean> {
  const normalized = String(featureKey ?? "").trim();
  if (!normalized) return false;
  if (isFeatureUnlockEnabled()) return true;

  const supabase = getSupabaseServiceClient();
  const [{ count: catalogCount, error: catalogError }, { count: planCount, error: planError }, { count: overrideCount, error: overrideError }] = await Promise.all([
    supabase
      .from("package_feature_catalog")
      .select("code", { count: "exact", head: true })
      .eq("code", normalized),
    supabase
      .from("subscription_package_features")
      .select("feature_code", { count: "exact", head: true })
      .eq("feature_code", normalized),
    supabase
      .from("tenant_feature_subscriptions")
      .select("feature_code", { count: "exact", head: true })
      .eq("feature_code", normalized)
  ]);

  if (catalogError) {
    throw new FeatureGateError("feature_catalog_query_failed", catalogError.message, 500);
  }
  if (planError) {
    throw new FeatureGateError("feature_catalog_query_failed", planError.message, 500);
  }
  if (overrideError) {
    throw new FeatureGateError("feature_catalog_query_failed", overrideError.message, 500);
  }

  return Number(catalogCount ?? 0) > 0 || Number(planCount ?? 0) > 0 || Number(overrideCount ?? 0) > 0;
}

export async function getTenantLimits(tenantId: string): Promise<TenantLimits> {
  const contract = await getLatestContract(tenantId);
  const supabase = getSupabaseServiceClient();

  const [{ count: branchCount, error: branchCountError }, { count: deviceCount, error: deviceCountError }, { data: userRows, error: userRowsError }] = await Promise.all([
    supabase.from("branches").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("is_active", true),
    supabase.from("branch_devices").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "active"),
    supabase.from("user_branch_roles").select("user_id").eq("tenant_id", tenantId)
  ]);

  if (branchCountError) {
    throw new FeatureGateError("quota_usage_branches_query_failed", branchCountError.message, 500);
  }
  if (deviceCountError) {
    throw new FeatureGateError("quota_usage_devices_query_failed", deviceCountError.message, 500);
  }
  if (userRowsError) {
    throw new FeatureGateError("quota_usage_users_query_failed", userRowsError.message, 500);
  }

  const metadata = contract?.metadata ?? {};
  const maxBranches = parseLimit(contract?.max_branches) ?? parseLimit(contract?.branch_limit);
  const maxDevices = parseLimit(contract?.max_devices) ?? parseLimit(contract?.terminal_limit_per_branch);
  const maxUsers = parseLimit(contract?.max_users) ?? parseLimit((metadata as { max_users?: unknown }).max_users);

  const users = new Set((userRows ?? []).map((row) => String((row as { user_id?: string }).user_id ?? "")).filter(Boolean));

  return {
    contractId: contract?.id ?? null,
    planId: contract?.package_id ?? null,
    contractStatus: contract?.status ?? null,
    maxBranches,
    maxDevices,
    maxUsers,
    usage: {
      branches: Number(branchCount ?? 0),
      devices: Number(deviceCount ?? 0),
      users: users.size
    }
  };
}

export async function enforceQuota(tenantId: string, resourceType: QuotaResourceType, branchId?: string | null): Promise<TenantLimits> {
  const limits = await getTenantLimits(tenantId);
  if (isFeatureUnlockEnabled()) return limits;

  if (limits.contractStatus && limits.contractStatus !== "active" && limits.contractStatus !== "trial") {
    throw new FeatureGateError("contract_suspended", "Tenant contract is not active for provisioning actions.", 403);
  }

  if (resourceType === "branches" && limits.maxBranches !== null && limits.usage.branches >= limits.maxBranches) {
    throw new FeatureGateError("quota_blocked", `Branch quota exceeded (${limits.usage.branches}/${limits.maxBranches}).`, 409);
  }

  if (resourceType === "devices" && limits.maxDevices !== null) {
    let deviceUsage = limits.usage.devices;
    if (branchId) {
      const supabase = getSupabaseServiceClient();
      const { count, error } = await supabase
        .from("branch_devices")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("status", "active");
      if (error) {
        throw new FeatureGateError("quota_usage_devices_query_failed", error.message, 500);
      }
      deviceUsage = Number(count ?? 0);
    }
    if (deviceUsage >= limits.maxDevices) {
      throw new FeatureGateError("quota_blocked", `Device quota exceeded (${deviceUsage}/${limits.maxDevices}).`, 409);
    }
  }

  if (resourceType === "users" && limits.maxUsers !== null && limits.usage.users >= limits.maxUsers) {
    throw new FeatureGateError("quota_blocked", `User quota exceeded (${limits.usage.users}/${limits.maxUsers}).`, 409);
  }

  return limits;
}

export async function requireTenantFeature(tenantId: string, featureKey: string, branchId?: string | null) {
  const enabled = branchId ? await hasBranchFeature(tenantId, branchId, featureKey) : await hasTenantFeature(tenantId, featureKey);
  if (!enabled) {
    throw new FeatureGateError("feature_not_enabled", `Feature '${featureKey}' is not enabled for this scope.`, 403);
  }
}

export async function requireTenantFeatureIfConfigured(tenantId: string, featureKey: string, branchId?: string | null) {
  const configured = await isFeatureKeyConfigured(featureKey);
  if (!configured) return;
  await requireTenantFeature(tenantId, featureKey, branchId);
}
