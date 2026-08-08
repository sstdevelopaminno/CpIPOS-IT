import { appendAuditLog } from "@/lib/audit-log";
import { enforceQuota, FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";

type RolePayload = {
  user_id?: string;
  branch_id?: string;
  role?: "owner" | "manager" | "staff";
  is_default?: boolean;
  deactivate?: boolean;
};

export async function GET(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { supabase } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branch_id")?.trim();

    let query = supabase
      .from("user_branch_roles")
      .select("id,user_id,tenant_id,branch_id,role,is_default,created_at,users_profiles!inner(id,email,full_name,is_active,platform_role)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (branchId) {
      query = query.eq("branch_id", branchId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    return ok({ users: data ?? [] });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = (await req.json()) as RolePayload;
    const userId = String(body.user_id ?? "").trim();
    const branchId = String(body.branch_id ?? "").trim();
    const role = body.role;

    if (!userId || !branchId || !role) {
      return fail("invalid_payload", "user_id, branch_id and role are required.", 422);
    }

    await requireTenantFeature(tenantId, "user_management");
    const { data: existingTenantUser } = await supabase
      .from("user_branch_roles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (!existingTenantUser) {
      try {
        await enforceQuota(tenantId, "users");
      } catch (error) {
        if (error instanceof FeatureGateError && error.code === "quota_blocked") {
          await appendAuditLog({
            tenantId,
            branchId,
            actorUserId: auth.userId,
            actorRole: "it_admin",
            action: "quota_blocked",
            targetTable: "user_branch_roles",
            metadata: {
              resource_type: "users",
              reason: error.message
            },
            ipAddress: requestMeta.ipAddress ?? undefined,
            userAgent: requestMeta.userAgent ?? undefined
          });
        }
        throw error;
      }
    }

    const { data: existing, error: existingError } = await supabase
      .from("user_branch_roles")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message);
    }

    if (existing) {
      return fail("duplicate_role_assignment", "Role assignment already exists for this user + tenant + branch.", 409);
    }

    const { data, error } = await supabase
      .from("user_branch_roles")
      .insert({
        user_id: userId,
        tenant_id: tenantId,
        branch_id: branchId,
        role,
        is_default: body.is_default ?? false
      })
      .select("id,user_id,tenant_id,branch_id,role,is_default,created_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return fail("duplicate_role_assignment", "Role assignment already exists for this user + tenant + branch.", 409);
      }
      throw new Error(error.message);
    }

    await appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "admin_role_assigned",
      targetTable: "user_branch_roles",
      targetId: data.id,
      targetUserId: userId,
      afterData: data,
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ assignment: data }, 201);
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = (await req.json()) as RolePayload;
    const userId = String(body.user_id ?? "").trim();
    const branchId = String(body.branch_id ?? "").trim();

    if (!userId || !branchId) {
      return fail("invalid_payload", "user_id and branch_id are required.", 422);
    }

    const { data: current } = await supabase
      .from("user_branch_roles")
      .select("id,user_id,tenant_id,branch_id,role,is_default")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!current) {
      return fail("assignment_not_found", "Role assignment was not found.", 404);
    }

    if (body.deactivate) {
      const { error: removeError } = await supabase
        .from("user_branch_roles")
        .delete()
        .eq("id", current.id)
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId);

      if (removeError) {
        throw new Error(removeError.message);
      }

      await appendAuditLog({
        tenantId,
        branchId,
        actorUserId: auth.userId,
        actorRole: "it_admin",
        action: "admin_role_deactivated",
        targetTable: "user_branch_roles",
        targetId: current.id,
        targetUserId: userId,
        beforeData: current,
        ipAddress: requestMeta.ipAddress ?? undefined,
        userAgent: requestMeta.userAgent ?? undefined
      });

      return ok({ deactivated: true, assignment_id: current.id });
    }

    const patch: Record<string, unknown> = {};
    if (body.role) {
      patch.role = body.role;
    }
    if (typeof body.is_default === "boolean") {
      patch.is_default = body.is_default;
    }

    if (Object.keys(patch).length === 0) {
      return fail("empty_patch", "No update fields provided.", 422);
    }

    const { data: updated, error: updateError } = await supabase
      .from("user_branch_roles")
      .update(patch)
      .eq("id", current.id)
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .select("id,user_id,tenant_id,branch_id,role,is_default,created_at")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    await appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "admin_role_updated",
      targetTable: "user_branch_roles",
      targetId: current.id,
      targetUserId: userId,
      beforeData: current,
      afterData: updated,
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ assignment: updated });
  } catch (error) {
    return guardItAdminError(error);
  }
}

