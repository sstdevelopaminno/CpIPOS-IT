import type { BranchRole } from "@pos/shared-types";
import type { AuthContext } from "@/lib/auth-context";
import { canManageTables } from "@/lib/table-management";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type TableBranchScopeItem = {
  id: string;
  code: string;
  name: string;
  role: BranchRole;
};

type ScopeResult =
  | {
      ok: true;
      branchIds: string[];
      targetBranchId: string | null;
      branches: TableBranchScopeItem[];
    }
  | {
      ok: false;
      code: string;
      message: string;
      status: number;
    };

function normalizeBranchRole(value: unknown): BranchRole | null {
  if (value === "owner" || value === "manager" || value === "staff" || value === "accountant") return value;
  return null;
}

export async function resolveTableBranchScope(args: {
  auth: AuthContext;
  requestedBranchId?: string | null;
  allowAll?: boolean;
  requireManage?: boolean;
  supabaseClient?: ReturnType<typeof getSupabaseServiceClient>;
}): Promise<ScopeResult> {
  const { auth, allowAll = false, requireManage = false } = args;
  const requestedBranchId = String(args.requestedBranchId ?? "").trim();
  if (!auth.tenantId) {
    return { ok: false, code: "tenant_scope_required", message: "Tenant scope is required.", status: 401 };
  }

  const supabase = args.supabaseClient ?? getSupabaseServiceClient();
  const { data: roleRows, error: roleError } = await supabase
    .from("user_branch_roles")
    .select("branch_id,role")
    .eq("tenant_id", auth.tenantId)
    .eq("user_id", auth.userId);

  if (roleError) {
    return { ok: false, code: "branch_scope_query_failed", message: roleError.message, status: 500 };
  }

  const roleByBranch = new Map<string, BranchRole>();
  for (const row of roleRows ?? []) {
    const branchId = String((row as { branch_id?: string | null }).branch_id ?? "").trim();
    const role = normalizeBranchRole((row as { role?: string | null }).role);
    if (!branchId || !role) continue;
    if (requireManage && !canManageTables(role)) continue;
    roleByBranch.set(branchId, role);
  }

  if (auth.branchId && auth.branchRole && (!requireManage || canManageTables(auth.branchRole))) {
    roleByBranch.set(auth.branchId, auth.branchRole);
  }

  const allowedBranchIds = [...roleByBranch.keys()];
  if (allowedBranchIds.length === 0) {
    return {
      ok: false,
      code: requireManage ? "forbidden_role" : "forbidden_branch",
      message: requireManage ? "Only manager or owner can manage tables." : "No branch permission is available.",
      status: 403
    };
  }

  const { data: branchRows, error: branchError } = await supabase
    .from("branches")
    .select("id,code,name,is_active")
    .eq("tenant_id", auth.tenantId)
    .in("id", allowedBranchIds)
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (branchError) {
    return { ok: false, code: "branches_query_failed", message: branchError.message, status: 500 };
  }

  const branches = (branchRows ?? [])
    .map((row) => {
      const id = String((row as { id?: string | null }).id ?? "").trim();
      const role = roleByBranch.get(id);
      if (!id || !role) return null;
      return {
        id,
        code: String((row as { code?: string | null }).code ?? id),
        name: String((row as { name?: string | null }).name ?? id),
        role
      };
    })
    .filter((row): row is TableBranchScopeItem => Boolean(row));

  if (branches.length === 0) {
    return { ok: false, code: "forbidden_branch", message: "No active branch permission is available.", status: 403 };
  }

  if (requestedBranchId === "all") {
    if (!allowAll) {
      return { ok: false, code: "branch_id_required", message: "A specific branch_id is required for this action.", status: 422 };
    }
    return { ok: true, branchIds: branches.map((branch) => branch.id), targetBranchId: null, branches };
  }

  const fallbackBranchId = branches.some((branch) => branch.id === auth.branchId) ? auth.branchId : branches[0]?.id ?? null;
  const targetBranchId = requestedBranchId || fallbackBranchId;
  if (!targetBranchId || !branches.some((branch) => branch.id === targetBranchId)) {
    return { ok: false, code: "forbidden_branch", message: "You do not have permission for this branch.", status: 403 };
  }

  return { ok: true, branchIds: [targetBranchId], targetBranchId, branches };
}
