import { appendAuditLog } from "@/lib/audit-log";
import { assertActivationScope, guardActivationAdminError, requireActivationAdmin } from "@/lib/activation-admin-guard";
import { requireTenantFeatureIfConfigured } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";

type EnrollmentRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  device_code: string;
  device_type: string;
  enrollment_status: string;
  trust_level: string;
};

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { auth, actorRole, supabase, requestMeta } = await requireActivationAdmin();
    const { id } = await context.params;
    const enrollmentId = String(id ?? "").trim();
    if (!enrollmentId) {
      return fail("invalid_enrollment_id", "Enrollment id is required.", 422);
    }

    const { data: current, error: currentError } = await supabase
      .from("device_enrollments")
      .select("id,tenant_id,branch_id,device_code,device_type,enrollment_status,trust_level")
      .eq("id", enrollmentId)
      .maybeSingle<EnrollmentRow>();

    if (currentError) throw new Error(currentError.message);
    if (!current) return fail("enrollment_not_found", "Device enrollment was not found.", 404);

    await assertActivationScope({
      auth,
      tenantId: current.tenant_id,
      branchId: current.branch_id,
      allowTenantWide: auth.platformRole === "it_admin"
    });
    await requireTenantFeatureIfConfigured(current.tenant_id, "mobile_device_enrollment", current.branch_id);

    const { data: updated, error: updateError } = await supabase
      .from("device_enrollments")
      .update({
        enrollment_status: "active",
        trust_level: "trusted",
        approved_by: auth.userId,
        approved_at: new Date().toISOString(),
        revoked_at: null
      })
      .eq("id", current.id)
      .select(
        "id,tenant_id,branch_id,device_code,device_type,enrollment_status,trust_level,activation_token_id,enrolled_by,approved_by,approved_at,revoked_at,last_seen_at,metadata,created_at,updated_at"
      )
      .single();

    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "Failed to approve enrollment.");
    }

    await appendAuditLog({
      tenantId: current.tenant_id,
      branchId: current.branch_id ?? undefined,
      actorUserId: auth.userId,
      actorRole,
      action: "device_enrollment_approved",
      targetTable: "device_enrollments",
      targetId: current.id,
      metadata: {
        device_code: current.device_code
      },
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ enrollment: updated });
  } catch (error) {
    return guardActivationAdminError(error);
  }
}
