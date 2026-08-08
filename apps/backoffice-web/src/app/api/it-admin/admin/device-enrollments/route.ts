import { assertActivationScope, guardActivationAdminError, requireActivationAdmin } from "@/lib/activation-admin-guard";
import { requireTenantFeatureIfConfigured } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";

type EnrollmentQuery = {
  tenant_id?: string;
  branch_id?: string;
  status?: "pending" | "active" | "revoked" | "blocked";
  device_type?: "pos_terminal" | "mobile_scanner" | "manager_phone" | "owner_phone" | "staff_phone";
};

export async function GET(request: Request) {
  try {
    const { auth, supabase } = await requireActivationAdmin();
    const { searchParams } = new URL(request.url);
    const tenantIdParam = searchParams.get("tenant_id")?.trim() ?? auth.tenantId ?? "";
    const branchIdParam = searchParams.get("branch_id")?.trim() || null;
    const status = searchParams.get("status")?.trim() || null;
    const deviceType = searchParams.get("device_type")?.trim() || null;

    if (!tenantIdParam) {
      return fail("missing_tenant_id", "tenant_id is required.", 422);
    }

    const { tenantId, branchId } = await assertActivationScope({
      auth,
      tenantId: tenantIdParam,
      branchId: branchIdParam,
      allowTenantWide: auth.platformRole === "it_admin"
    });

    await requireTenantFeatureIfConfigured(tenantId, "mobile_device_enrollment", branchId);

    let query = supabase
      .from("device_enrollments")
      .select(
        "id,tenant_id,branch_id,device_code,device_type,enrollment_status,trust_level,activation_token_id,enrolled_by,approved_by,approved_at,revoked_at,last_seen_at,metadata,created_at,updated_at"
      )
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (branchId) query = query.eq("branch_id", branchId);
    if (status) query = query.eq("enrollment_status", status);
    if (deviceType) query = query.eq("device_type", deviceType);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return ok({
      enrollments: data ?? []
    });
  } catch (error) {
    return guardActivationAdminError(error);
  }
}

