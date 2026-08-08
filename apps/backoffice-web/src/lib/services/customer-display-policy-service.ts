import { readEnv } from "@/lib/env";
import { invalidateRuntimeCacheByPrefix, readThroughRuntimeCache } from "@/lib/route-runtime-cache";

export type CustomerDisplayPolicy = {
  maxActiveDevices: number;
  inactiveExpireHours: number;
  source: "default" | "table";
};

export type CustomerDisplayPolicyScope = {
  tenantId: string;
  branchId: string;
  channel: string;
};

const POLICY_CACHE_PREFIX = "pos-customer-display-policy";
const DEFAULT_MAX_ACTIVE_DEVICES = clampInt(readEnv("POS_CUSTOMER_DISPLAY_MAX_ACTIVE_DEVICES"), 1, 64, 4);
const DEFAULT_INACTIVE_EXPIRE_HOURS = clampInt(readEnv("POS_CUSTOMER_DISPLAY_INACTIVE_EXPIRE_HOURS"), 1, 2160, 72);

type PolicyRow = {
  max_active_devices: number;
  inactive_expire_hours: number;
  is_active: boolean;
};

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.trunc(numeric);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function isSchemaMissingError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("does not exist") || normalized.includes("pgrst") || normalized.includes("undefined table");
}

export function buildCustomerDisplayPolicyCacheKey(scope: CustomerDisplayPolicyScope): string {
  return `${POLICY_CACHE_PREFIX}:${scope.tenantId}:${scope.branchId}:${scope.channel}`;
}

export function invalidateCustomerDisplayPolicyCache(scope: CustomerDisplayPolicyScope) {
  invalidateRuntimeCacheByPrefix(buildCustomerDisplayPolicyCacheKey(scope));
}

export async function getCustomerDisplayPolicy(supabase: any, scope: CustomerDisplayPolicyScope): Promise<CustomerDisplayPolicy> {
  const { value } = await readThroughRuntimeCache<CustomerDisplayPolicy>({
    key: buildCustomerDisplayPolicyCacheKey(scope),
    ttlMs: 15_000,
    loader: async () => {
      const { data, error } = await supabase
        .from("pos_customer_display_policies")
        .select("max_active_devices,inactive_expire_hours,is_active")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .eq("channel", scope.channel)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        if (isSchemaMissingError(error.message)) {
          return {
            maxActiveDevices: DEFAULT_MAX_ACTIVE_DEVICES,
            inactiveExpireHours: DEFAULT_INACTIVE_EXPIRE_HOURS,
            source: "default" as const
          };
        }
        throw new Error(`customer_display_policy_query_failed:${error.message}`);
      }

      const row = data as PolicyRow | null;
      if (!row) {
        return {
          maxActiveDevices: DEFAULT_MAX_ACTIVE_DEVICES,
          inactiveExpireHours: DEFAULT_INACTIVE_EXPIRE_HOURS,
          source: "default"
        };
      }

      return {
        maxActiveDevices: clampInt(String(row.max_active_devices), 1, 64, DEFAULT_MAX_ACTIVE_DEVICES),
        inactiveExpireHours: clampInt(String(row.inactive_expire_hours), 1, 2160, DEFAULT_INACTIVE_EXPIRE_HOURS),
        source: "table"
      };
    }
  });

  return value;
}

export async function deactivateExpiredAndInactiveDevices(args: {
  supabase: any;
  scope: CustomerDisplayPolicyScope;
  policy: CustomerDisplayPolicy;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const staleCutoffIso = new Date(now.getTime() - args.policy.inactiveExpireHours * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const { error: expiredError } = await args.supabase
    .from("pos_customer_display_pairings")
    .update({ is_active: false, updated_at: nowIso })
    .eq("tenant_id", args.scope.tenantId)
    .eq("branch_id", args.scope.branchId)
    .eq("channel", args.scope.channel)
    .eq("is_active", true)
    .not("device_token_hash", "is", null)
    .lte("device_token_expires_at", nowIso);

  if (expiredError && !isSchemaMissingError(expiredError.message)) {
    throw new Error(`customer_display_pairing_cleanup_failed:${expiredError.message}`);
  }

  const { error: inactiveError } = await args.supabase
    .from("pos_customer_display_pairings")
    .update({ is_active: false, updated_at: nowIso })
    .eq("tenant_id", args.scope.tenantId)
    .eq("branch_id", args.scope.branchId)
    .eq("channel", args.scope.channel)
    .eq("is_active", true)
    .not("device_token_hash", "is", null)
    .not("last_seen_at", "is", null)
    .lt("last_seen_at", staleCutoffIso);

  if (inactiveError && !isSchemaMissingError(inactiveError.message)) {
    throw new Error(`customer_display_pairing_cleanup_failed:${inactiveError.message}`);
  }
}

export async function countActivePairedDevices(args: {
  supabase: any;
  scope: CustomerDisplayPolicyScope;
  now?: Date;
}): Promise<number> {
  const nowIso = (args.now ?? new Date()).toISOString();
  const { count, error } = await args.supabase
    .from("pos_customer_display_pairings")
    .select("id", { head: true, count: "exact" })
    .eq("tenant_id", args.scope.tenantId)
    .eq("branch_id", args.scope.branchId)
    .eq("channel", args.scope.channel)
    .eq("is_active", true)
    .not("device_token_hash", "is", null)
    .gt("device_token_expires_at", nowIso);

  if (error) {
    throw new Error(`customer_display_pairing_count_failed:${error.message}`);
  }
  return Number(count ?? 0);
}
