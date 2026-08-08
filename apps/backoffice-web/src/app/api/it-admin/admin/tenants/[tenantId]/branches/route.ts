import { appendAuditLog } from "@/lib/audit-log";
import { enforceQuota, FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { guardItAdminError, parseTenantParam, requireItAdmin } from "@/lib/it-admin-guard";

type BranchPayload = {
  branch_id?: string;
  code?: string;
  name?: string;
  address?: string;
  is_active?: boolean;
};

export async function GET(_req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { supabase } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);

    const { data, error } = await supabase
      .from("branches")
      .select("id,tenant_id,code,name,address,is_active,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return ok({ branches: data ?? [] });
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = (await req.json()) as BranchPayload;
    const code = String(body.code ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();

    if (!code || !name) {
      return fail("invalid_payload", "code and name are required.", 422);
    }

    await requireTenantFeature(tenantId, "branch_management");
    try {
      await enforceQuota(tenantId, "branches");
    } catch (error) {
      if (error instanceof FeatureGateError && error.code === "quota_blocked") {
        await appendAuditLog({
          tenantId,
          actorUserId: auth.userId,
          actorRole: "it_admin",
          action: "quota_blocked",
          targetTable: "branches",
          metadata: {
            resource_type: "branches",
            reason: error.message
          },
          ipAddress: requestMeta.ipAddress ?? undefined,
          userAgent: requestMeta.userAgent ?? undefined
        });
      }
      throw error;
    }

    const { data, error } = await supabase
      .from("branches")
      .insert({
        tenant_id: tenantId,
        code,
        name,
        address: String(body.address ?? "").trim() || null,
        is_active: body.is_active ?? true
      })
      .select("id,tenant_id,code,name,address,is_active,created_at,updated_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return fail("branch_code_duplicate", "Branch code already exists in this tenant.", 409);
      }
      throw new Error(error.message);
    }

    await appendAuditLog({
      tenantId,
      branchId: data.id,
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "admin_branch_created",
      targetTable: "branches",
      targetId: data.id,
      afterData: data,
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ branch: data }, 201);
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const { tenantId: tenantIdParam } = await context.params;
    const tenantId = parseTenantParam(tenantIdParam);
    const body = (await req.json()) as BranchPayload;
    const branchId = String(body.branch_id ?? "").trim();

    if (!branchId) {
      return fail("invalid_payload", "branch_id is required.", 422);
    }

    const { data: before } = await supabase
      .from("branches")
      .select("id,tenant_id,code,name,address,is_active")
      .eq("tenant_id", tenantId)
      .eq("id", branchId)
      .maybeSingle();

    if (!before) {
      return fail("branch_not_found", "Branch was not found in this tenant.", 404);
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.code === "string" && body.code.trim()) patch.code = body.code.trim().toLowerCase();
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
    if (typeof body.address === "string") patch.address = body.address.trim() || null;
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

    if (Object.keys(patch).length === 0) {
      return fail("empty_patch", "No update fields provided.", 422);
    }

    const { data, error } = await supabase
      .from("branches")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", branchId)
      .select("id,tenant_id,code,name,address,is_active,created_at,updated_at")
      .single();

    if (error) {
      if (error.code === "23505") {
        return fail("branch_code_duplicate", "Branch code already exists in this tenant.", 409);
      }
      throw new Error(error.message);
    }

    await appendAuditLog({
      tenantId,
      branchId,
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "admin_branch_updated",
      targetTable: "branches",
      targetId: branchId,
      beforeData: before,
      afterData: data,
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ branch: data });
  } catch (error) {
    return guardItAdminError(error);
  }
}

