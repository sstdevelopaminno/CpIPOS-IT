import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TenantNotificationLanguage = "th" | "en" | "lo";
export function asTenantNotificationLanguage(value: unknown): TenantNotificationLanguage {
  return value === "en" || value === "lo" ? value : "th";
}

/** The single tenant-level authority for all outbound Email and Push templates.
 * POS screen language is per-user/device and must never override this value.
 */
export async function getTenantNotificationLanguage(db: SupabaseClient, tenantId: string | null | undefined): Promise<TenantNotificationLanguage> {
  if (!tenantId) return "th";
  const { data, error } = await db.from("tenants").select("metadata").eq("id", tenantId)
    .maybeSingle<{ metadata: Record<string, unknown> | null }>();
  if (error) throw new Error("tenant_notification_language_unavailable");
  return asTenantNotificationLanguage(data?.metadata?.notification_language);
}
