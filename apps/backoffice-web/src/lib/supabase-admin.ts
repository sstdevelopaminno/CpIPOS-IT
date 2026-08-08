import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPrimarySupabaseServiceClient as getPrimaryClient,
  getRoutedSupabaseServiceClient,
  getTrialSupabaseServiceClient as getTrialClient,
  invalidateTenantDataRouteCache,
  TenantDataRoutingError
} from "@/lib/tenant-data-router";

// Keep the same public client shape the application had before data-plane
// routing. The dynamic project selection is contained inside the router.
type ServiceClient = SupabaseClient<any, "public", "public", any, any>;

export function getSupabaseServiceClient(): ServiceClient {
  return getRoutedSupabaseServiceClient() as ServiceClient;
}

export function getPrimarySupabaseServiceClient(): ServiceClient {
  return getPrimaryClient() as ServiceClient;
}

export function getTrialSupabaseServiceClient(): ServiceClient {
  return getTrialClient() as ServiceClient;
}

export { invalidateTenantDataRouteCache, TenantDataRoutingError };
