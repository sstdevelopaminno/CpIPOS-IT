import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readRequiredEnv } from "@/lib/env";

type ItControlPlaneClient = SupabaseClient<any, "public", "public", any, any>;

type ItAuditInput = {
  actorUserId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  tenantId?: string | null;
  branchId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

function globalCache() {
  return globalThis as typeof globalThis & {
    __cpiposItControlPlaneClient?: ItControlPlaneClient;
  };
}

export function getItControlPlaneClient(): ItControlPlaneClient {
  if (typeof window !== "undefined") {
    throw new Error("IT control-plane service client can only be used on the server.");
  }

  const cache = globalCache();
  if (cache.__cpiposItControlPlaneClient) return cache.__cpiposItControlPlaneClient;

  const url = readRequiredEnv("IT_SUPABASE_URL", "Missing IT control-plane Supabase URL.");
  const key = readRequiredEnv("IT_SUPABASE_SERVICE_ROLE_KEY", "Missing IT control-plane service role key.");

  cache.__cpiposItControlPlaneClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false }
  }) as ItControlPlaneClient;

  return cache.__cpiposItControlPlaneClient;
}

export async function appendItAuditLog(input: ItAuditInput): Promise<void> {
  try {
    const { error } = await getItControlPlaneClient().from("it_audit_logs").insert({
      actor_user_id: input.actorUserId ?? null,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      tenant_id: input.tenantId ?? null,
      branch_id: input.branchId ?? null,
      request_id: input.requestId ?? null,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
      metadata: input.metadata ?? {}
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error("[it-control-plane] audit write failed", {
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      error: error instanceof Error ? error.message : "unknown_error"
    });
  }
}
