import { cookies } from "next/headers";
import type { AuthContext } from "@/lib/auth-context";
import { getAuthContext } from "@/lib/auth-context";
import { requirePermission, requirePosSession, type PosPermission, type PosSessionScope } from "@/lib/pos-session-guard";
import { resolveSessionCookieConfig } from "@/lib/server/pos-session";

type PosApiAuthInput = {
  requireBranchScope?: boolean;
  requiredPermission?: PosPermission;
  requiredPermissions?: PosPermission[];
};

// Collapse concurrent POS API authentication checks for the same browser session.
// A busy POS screen starts several API requests at once; without single-flight each
// request can miss the short session cache at the same time and repeat the same
// Supabase session/scope lookups. This map never shares work across session IDs.
const posSessionScopeInFlight = new Map<string, Promise<PosSessionScope>>();

function normalizeBranchRole(role: string): AuthContext["branchRole"] {
  if (role === "owner" || role === "manager" || role === "staff" || role === "accountant") {
    return role;
  }
  return "staff";
}

async function requirePosSessionSingleFlight(): Promise<PosSessionScope> {
  const config = resolveSessionCookieConfig();
  const cookieStore = await cookies();
  const sessionId = String(cookieStore.get(config.sessionIdName)?.value ?? "").trim();

  // Handoff/legacy flows may not have the session-id cookie yet. Do not merge those
  // requests because there is no safe identity key available for isolation.
  if (!sessionId) {
    return requirePosSession();
  }

  const existing = posSessionScopeInFlight.get(sessionId);
  if (existing) {
    return existing;
  }

  const pending = requirePosSession();
  posSessionScopeInFlight.set(sessionId, pending);
  try {
    return await pending;
  } finally {
    if (posSessionScopeInFlight.get(sessionId) === pending) {
      posSessionScopeInFlight.delete(sessionId);
    }
  }
}

export async function getPosApiAuthContext(input: PosApiAuthInput = {}): Promise<AuthContext> {
  const { requireBranchScope = true, requiredPermission, requiredPermissions } = input;
  const permissions = [...(requiredPermission ? [requiredPermission] : []), ...(requiredPermissions ?? [])];

  try {
    const scope = await requirePosSessionSingleFlight();
    for (const permission of permissions) {
      requirePermission(scope, permission);
    }
    return {
      userId: scope.session.user_id,
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      branchRole: normalizeBranchRole(scope.session.role),
      platformRole: "tenant_user"
    };
  } catch (error) {
    if (permissions.length > 0) {
      throw error;
    }
    return getAuthContext({ requireBranchScope });
  }
}
