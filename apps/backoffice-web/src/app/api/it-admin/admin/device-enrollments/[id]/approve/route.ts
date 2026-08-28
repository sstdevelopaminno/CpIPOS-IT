import { appendAuditLog } from "@/lib/audit-log";
import { assertActivationScope, guardActivationAdminError, requireActivationAdmin } from "@/lib/activation-admin-guard";
import { requireTenantFeatureIfConfigured } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";

type JsonRecord = Record<string, unknown>;

type EnrollmentRow = {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  device_code: string;
  device_type: string;
  enrollment_status: string;
  trust_level: string;
  metadata: JsonRecord | null;
};

type BranchDeviceRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_code: string;
  status: string;
  is_active: boolean;
  metadata: JsonRecord | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

async function prepareAndroidBinding(
  supabase: Awaited<ReturnType<typeof requireActivationAdmin>>["supabase"],
  enrollment: EnrollmentRow
) {
  const metadata = asRecord(enrollment.metadata);
  if (metadata.pairing_source !== "android_activation_token") return null;
  if (!enrollment.branch_id) {
    throw new Error("android_pairing_branch_required");
  }

  const installId = String(metadata.android_mdm_install_id ?? "").trim();
  if (!UUID_PATTERN.test(installId)) {
    throw new Error("android_pairing_install_id_invalid");
  }

  const { data: device, error: deviceError } = await supabase
    .from("branch_devices")
    .select("id,tenant_id,branch_id,device_code,status,is_active,metadata")
    .eq("tenant_id", enrollment.tenant_id)
    .eq("branch_id", enrollment.branch_id)
    .eq("device_code", enrollment.device_code)
    .maybeSingle<BranchDeviceRow>();
  if (deviceError) throw new Error(deviceError.message);
  if (!device || !device.is_active || device.status !== "active") {
    throw new Error("android_pairing_device_not_found");
  }

  const { data: conflicts, error: conflictError } = await supabase
    .from("branch_devices")
    .select("id,tenant_id,branch_id,device_code,status,is_active,metadata")
    .eq("is_active", true)
    .contains("metadata", { android_mdm_install_id: installId })
    .neq("id", device.id)
    .limit(1)
    .returns<BranchDeviceRow[]>();
  if (conflictError) throw new Error(conflictError.message);
  if ((conflicts ?? []).length > 0) {
    throw new Error("android_pairing_install_id_conflict");
  }

  return { device, installId, enrollmentMetadata: metadata };
}

function mapPairingApprovalError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "android_pairing_branch_required") {
    return fail("android_pairing_branch_required", "Android POS enrollment must be scoped to a branch.", 422);
  }
  if (message === "android_pairing_install_id_invalid") {
    return fail("android_pairing_install_id_invalid", "Android install id in the enrollment is invalid.", 422);
  }
  if (message === "android_pairing_device_not_found") {
    return fail("android_pairing_device_not_found", "Active POS device was not found for this enrollment.", 404);
  }
  if (message === "android_pairing_install_id_conflict") {
    return fail("android_pairing_install_id_conflict", "This Android installation is already paired with another POS device.", 409);
  }
  return null;
}

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
      .select("id,tenant_id,branch_id,device_code,device_type,enrollment_status,trust_level,metadata")
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

    const androidBinding = await prepareAndroidBinding(supabase, current);
    const approvedAt = new Date().toISOString();
    const approvedMetadata = androidBinding
      ? {
          ...androidBinding.enrollmentMetadata,
          android_mdm_branch_device_id: androidBinding.device.id,
          android_mdm_approved_at: approvedAt
        }
      : asRecord(current.metadata);

    const { data: updated, error: updateError } = await supabase
      .from("device_enrollments")
      .update({
        enrollment_status: "active",
        trust_level: "trusted",
        approved_by: auth.userId,
        approved_at: approvedAt,
        revoked_at: null,
        metadata: approvedMetadata
      })
      .eq("id", current.id)
      .select(
        "id,tenant_id,branch_id,device_code,device_type,enrollment_status,trust_level,activation_token_id,enrolled_by,approved_by,approved_at,revoked_at,last_seen_at,metadata,created_at,updated_at"
      )
      .single();

    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "Failed to approve enrollment.");
    }

    if (androidBinding) {
      const deviceMetadata = asRecord(androidBinding.device.metadata);
      const previousInstallId = String(deviceMetadata.android_mdm_install_id ?? "").trim();
      const nextDeviceMetadata: JsonRecord = {
        ...deviceMetadata,
        mdm_enrolled: true,
        android_mdm_install_id: androidBinding.installId,
        android_mdm_app_version: androidBinding.enrollmentMetadata.android_mdm_app_version ?? null,
        android_mdm_pair_source: "device_enrollment_approval",
        android_mdm_last_pair_confirmed_at: approvedAt
      };
      if (previousInstallId !== androidBinding.installId || !deviceMetadata.android_mdm_paired_at) {
        nextDeviceMetadata.android_mdm_paired_at = approvedAt;
      }

      const { error: bindingError } = await supabase
        .from("branch_devices")
        .update({
          metadata: nextDeviceMetadata,
          last_seen_at: approvedAt,
          updated_at: approvedAt
        })
        .eq("id", androidBinding.device.id)
        .eq("tenant_id", current.tenant_id)
        .eq("branch_id", current.branch_id!);

      if (bindingError) {
        console.error("[device-enrollment] approved Android binding failed", {
          enrollmentId: current.id,
          deviceId: androidBinding.device.id,
          error: bindingError.message
        });

        const { error: rollbackError } = await supabase
          .from("device_enrollments")
          .update({
            enrollment_status: "pending",
            trust_level: "untrusted",
            approved_by: null,
            approved_at: null,
            metadata: androidBinding.enrollmentMetadata
          })
          .eq("id", current.id);
        if (rollbackError) {
          console.error("[device-enrollment] approval compensation failed", {
            enrollmentId: current.id,
            error: rollbackError.message
          });
        }
        throw new Error(`android_pairing_binding_failed:${bindingError.message}`);
      }
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
        device_code: current.device_code,
        android_pairing_bound: Boolean(androidBinding),
        branch_device_id: androidBinding?.device.id ?? null
      },
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({
      enrollment: updated,
      android_pairing: androidBinding
        ? { bound: true, branch_device_id: androidBinding.device.id }
        : { bound: false }
    });
  } catch (error) {
    const pairingError = mapPairingApprovalError(error);
    if (pairingError) return pairingError;
    return guardActivationAdminError(error);
  }
}
