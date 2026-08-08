import type { BranchRole, PlatformRole } from "@pos/shared-types";
import { headers } from "next/headers";
import { readEnv } from "@/lib/env";
import { requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type AuthContextInput = {
  requireBranchScope?: boolean;
};

export type AuthContext = {
  userId: string;
  platformRole: PlatformRole;
  tenantId: string | null;
  branchId: string | null;
  branchRole: BranchRole | null;
};

export const POS_ACTIVE_BRANCH_COOKIE = "pos_active_branch_id";

const branchRoles: BranchRole[] = ["owner", "manager", "staff", "accountant"];
const platformRoles: PlatformRole[] = ["it_admin", "tenant_user"];

type BranchMembershipRow = {
  tenant_id: string;
  branch_id: string;
  role: BranchRole;
  is_default: boolean;
};

function parseRole<T extends string>(value: unknown, allowed: T[]): T | null {
  if (typeof value !== "string") {
    return null;
  }

  return allowed.includes(value as T) ? (value as T) : null;
}

function getFallbackContext(): AuthContext | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const userId = readEnv("DEV_AUTH_USER_ID");
  const tenantId = readEnv("DEV_AUTH_TENANT_ID") ?? null;
  const branchId = readEnv("DEV_AUTH_BRANCH_ID") ?? null;
  const branchRole = parseRole(readEnv("DEV_AUTH_BRANCH_ROLE"), branchRoles);
  const platformRole = parseRole(readEnv("DEV_AUTH_PLATFORM_ROLE"), platformRoles) ?? "tenant_user";

  if (!userId) {
    return null;
  }

  return {
    userId,
    tenantId,
    branchId,
    branchRole,
    platformRole
  };
}

function assertBranchScope(context: AuthContext) {
  if (!context.tenantId || !context.branchId || !context.branchRole) {
    throw new Error("Missing tenant/branch claims in authenticated context.");
  }
}

function readCookieValue(cookieHeader: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1] ?? null;
  }
}

function hasPosSessionCookie(cookieHeader: string): boolean {
  const sessionIdCookie = String(process.env.POS_SESSION_ID_COOKIE_NAME ?? "pos_session_id").trim() || "pos_session_id";
  const handoffCookie = String(process.env.POS_SESSION_COOKIE_NAME ?? "pos_session_handoff").trim() || "pos_session_handoff";
  return cookieHeader.includes(`${sessionIdCookie}=`) || cookieHeader.includes(`${handoffCookie}=`);
}

async function loadBranchMemberships(userId: string): Promise<BranchMembershipRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("user_branch_roles")
    .select("tenant_id,branch_id,role,is_default")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  return (data ?? [])
    .map((row) => {
      const role = parseRole((row as { role?: string | null }).role, branchRoles);
      const tenantId = String((row as { tenant_id?: string | null }).tenant_id ?? "").trim();
      const branchId = String((row as { branch_id?: string | null }).branch_id ?? "").trim();
      if (!role || !tenantId || !branchId) return null;
      return {
        tenant_id: tenantId,
        branch_id: branchId,
        role,
        is_default: Boolean((row as { is_default?: boolean | null }).is_default)
      };
    })
    .filter((row): row is BranchMembershipRow => Boolean(row));
}

async function loadPlatformRole(userId: string): Promise<PlatformRole | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase
    .from("users_profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle<{ platform_role: PlatformRole | null }>();

  return parseRole(data?.platform_role, platformRoles);
}

function resolveMembership(args: {
  memberships: BranchMembershipRow[];
  preferredTenantId: string | null;
  preferredBranchId: string | null;
}) {
  const { memberships, preferredTenantId, preferredBranchId } = args;
  if (memberships.length === 0) return null;

  const inPreferredTenant = preferredTenantId ? memberships.filter((row) => row.tenant_id === preferredTenantId) : memberships;
  const byTenant = inPreferredTenant.length > 0 ? inPreferredTenant : memberships;

  if (preferredBranchId) {
    const exact = byTenant.find((row) => row.branch_id === preferredBranchId);
    if (exact) return exact;
  }

  const defaultMembership = byTenant.find((row) => row.is_default);
  if (defaultMembership) return defaultMembership;
  return byTenant[0] ?? null;
}

export async function getAuthContext(input: AuthContextInput = {}): Promise<AuthContext> {
  const { requireBranchScope = true } = input;
  const headerStore = await headers();
  const fallback = getFallbackContext();
  const authHeader = headerStore.get("authorization") ?? headerStore.get("Authorization");
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;
  const cookieHeader = headerStore.get("cookie") ?? "";
  const requestedBranchIdFromCookie = readCookieValue(cookieHeader, POS_ACTIVE_BRANCH_COOKIE)?.trim() || null;
  const hasSupabaseSessionCookie = /sb-[^=]+=/.test(cookieHeader);

  // Support POS login handoff/session auth for API routes that still rely on auth-context.
  if (!bearerToken && !hasSupabaseSessionCookie && hasPosSessionCookie(cookieHeader)) {
    const posScope = await requirePosSession();
    const contextFromPos: AuthContext = {
      userId: posScope.session.user_id,
      tenantId: posScope.session.tenant_id,
      branchId: posScope.session.branch_id,
      branchRole: parseRole(posScope.session.role, branchRoles),
      platformRole: "tenant_user"
    };
    if (requireBranchScope) {
      assertBranchScope(contextFromPos);
    }
    return contextFromPos;
  }

  if (!bearerToken && fallback && !hasSupabaseSessionCookie && !requestedBranchIdFromCookie) {
    if (requireBranchScope) {
      assertBranchScope(fallback);
    }
    return fallback;
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = bearerToken ? await supabase.auth.getUser(bearerToken) : await supabase.auth.getUser();

  if (error || !data.user) {
    if (!fallback) {
      throw new Error("User is not authenticated.");
    }

    if (requestedBranchIdFromCookie) {
      const resolvedFromFallback: AuthContext = { ...fallback };
      const memberships = await loadBranchMemberships(fallback.userId);
      const resolvedMembership = resolveMembership({
        memberships,
        preferredTenantId: fallback.tenantId,
        preferredBranchId: requestedBranchIdFromCookie ?? fallback.branchId
      });
      if (resolvedMembership) {
        resolvedFromFallback.tenantId = resolvedMembership.tenant_id;
        resolvedFromFallback.branchId = resolvedMembership.branch_id;
        resolvedFromFallback.branchRole = resolvedMembership.role;
      }
      if (requireBranchScope) {
        assertBranchScope(resolvedFromFallback);
      }
      return resolvedFromFallback;
    }

    if (requireBranchScope) {
      assertBranchScope(fallback);
    }

    return fallback;
  }

  const appMeta = data.user.app_metadata ?? {};
  const claims = {
    tenant_id: appMeta.tenant_id,
    branch_id: appMeta.branch_id,
    branch_role: appMeta.branch_role,
    platform_role: appMeta.platform_role
  };

  const context: AuthContext = {
    userId: data.user.id,
    tenantId: typeof claims.tenant_id === "string" ? claims.tenant_id : null,
    branchId: typeof claims.branch_id === "string" ? claims.branch_id : null,
    branchRole: parseRole(claims.branch_role, branchRoles),
    platformRole: parseRole(claims.platform_role, platformRoles) ?? "tenant_user"
  };

  const shouldResolveMembership =
    requireBranchScope ||
    Boolean(requestedBranchIdFromCookie) ||
    !context.tenantId ||
    !context.branchId ||
    !context.branchRole;

  if (shouldResolveMembership) {
    const memberships = await loadBranchMemberships(context.userId);
    const resolvedMembership = resolveMembership({
      memberships,
      preferredTenantId: context.tenantId,
      preferredBranchId: requestedBranchIdFromCookie ?? context.branchId
    });

    if (resolvedMembership) {
      context.tenantId = resolvedMembership.tenant_id;
      context.branchId = resolvedMembership.branch_id;
      context.branchRole = resolvedMembership.role;
    }

    if (!parseRole(claims.platform_role, platformRoles)) {
      const resolvedPlatformRole = await loadPlatformRole(context.userId);
      if (resolvedPlatformRole) {
        context.platformRole = resolvedPlatformRole;
      }
    }
  }

  if (requireBranchScope) {
    assertBranchScope(context);
  }

  return context;
}

