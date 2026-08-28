import "server-only";

import { headers } from "next/headers";
import { getAuthContext, type AuthContext } from "@/lib/auth-context";
import { FeatureGateError } from "@/lib/feature-gate";
import { fail } from "@/lib/http";
import { getItControlPlaneClient } from "@/lib/it-control-plane";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type ItAdminContext = {
  auth: AuthContext;
  supabase: ReturnType<typeof getSupabaseServiceClient>;
  itSupabase: ReturnType<typeof getItControlPlaneClient>;
  requestMeta: {
    ipAddress: string | null;
    userAgent: string | null;
  };
};

export class ItAdminGuardError extends Error {
  status: number;
  code: string;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "ItAdminGuardError";
    this.code = code;
    this.status = status;
  }
}

function readIpAddress(headerStore: Headers): string | null {
  const forwarded = headerStore.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headerStore.get("x-real-ip")?.trim();
  return forwarded || realIp || null;
}

export async function requireItAdmin(): Promise<ItAdminContext> {
  let auth: AuthContext;
  try {
    auth = await getAuthContext({ requireBranchScope: false });
  } catch (error) {
    if (error instanceof Error && /not authenticated/i.test(error.message)) {
      throw new ItAdminGuardError("unauthorized", "Authentication is required.", 401);
    }
    throw error;
  }

  if (auth.platformRole !== "it_admin") {
    throw new ItAdminGuardError("forbidden", "Only platform admin can access this endpoint.", 403);
  }

  const headerStore = await headers();
  return {
    auth,
    // Authentication/business control remains authoritative on CpiPOS-001.
    supabase: getSupabaseServiceClient(),
    // Device/health/incident/command operations are isolated on CpiPOS-002.
    itSupabase: getItControlPlaneClient(),
    requestMeta: {
      ipAddress: readIpAddress(headerStore),
      userAgent: headerStore.get("user-agent")
    }
  };
}

export function parseTenantParam(raw: string | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value) {
    throw new ItAdminGuardError("missing_tenant_id", "tenantId is required.", 422);
  }
  return value;
}

export function parseBranchParam(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value || null;
}

export function guardItAdminError(error: unknown): Response {
  if (error instanceof ItAdminGuardError) {
    return fail(error.code, error.message, error.status);
  }
  if (error instanceof FeatureGateError) {
    return fail(error.code, error.message, error.status);
  }

  console.error("[it-admin-api] internal error", error);
  return fail("it_admin_internal_error", "Internal server error.", 500);
}
