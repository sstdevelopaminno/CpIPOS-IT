import "server-only";

import { readEnv } from "@/lib/env";
import { getVerifiedSupabaseAccessToken } from "@/lib/supabase-server";
import type { ItAdminContext } from "@/lib/it-admin-guard";

export type CommunicationsCleanupResult = {
  completed: boolean;
  error: string | null;
  removed_files: number;
};

export async function cleanupTenantCommunications(
  admin: ItAdminContext,
  tenantId: string,
  request: Request
): Promise<CommunicationsCleanupResult> {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const bearerToken = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "";
    const accessToken = bearerToken || await getVerifiedSupabaseAccessToken(admin.auth.userId);
    if (!accessToken) return { completed: false, error: "communications_auth_unavailable", removed_files: 0 };

    const endpoint = readEnv("CPIPOS_COMMUNICATIONS_EDGE_URL");
    if (!endpoint) return { completed: false, error: "communications_gateway_unavailable", removed_files: 0 };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "delete_tenant_communications", tenant_id: tenantId }),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json().catch(() => null) as {
      completed?: boolean;
      storage_removed?: number;
      error?: string;
    } | null;
    const removed = Math.max(0, Number(payload?.storage_removed ?? 0) || 0);
    if (!response.ok || payload?.completed !== true) {
      return {
        completed: false,
        error: payload?.error ?? `communications_gateway_failed_${response.status}`,
        removed_files: removed
      };
    }
    return { completed: true, error: null, removed_files: removed };
  } catch (error) {
    console.error("[tenant-deletion] communications cleanup deferred", {
      tenantId,
      error: error instanceof Error ? error.message : "unknown_error"
    });
    return { completed: false, error: "communications_cleanup_deferred", removed_files: 0 };
  }
}

/** Persist result of cross-plane cleanup so a failed gateway request remains
 * in the IT queue even after the Primary tenant has been permanently deleted.
 */
export async function recordTenantCommunicationsCleanup(
  admin: ItAdminContext,
  tenantId: string,
  outcome: CommunicationsCleanupResult
) {
  const now = new Date().toISOString();
  const { data, error } = await admin.supabase
    .from("it_tenant_communications_cleanup")
    .update({
      status: outcome.completed ? "complete" : "pending",
      attempted_at: now,
      completed_at: outcome.completed ? now : null,
      last_error: outcome.error,
      storage_removed: outcome.removed_files
    })
    .eq("tenant_id", tenantId)
    .select("tenant_id")
    .maybeSingle<{ tenant_id: string }>();
  if (error || !data) {
    throw new Error(`tenant_communications_cleanup_journal_failed:${error?.message ?? "missing"}`);
  }
}
