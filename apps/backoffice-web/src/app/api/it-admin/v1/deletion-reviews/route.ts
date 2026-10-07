import { appendItAuditLog } from "@/lib/it-control-plane";
import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readBoundedJson } from "@/lib/server/limited-json";
import { applyTenantControlAction } from "@/lib/services/it-admin/tenant-control-service";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;

type DeletionReviewRow = {
  tenant_id: string;
  store_name: string;
  store_code: string;
  lifecycle_kind: "trial" | "subscription";
  service_ended_at: string;
  access_grace_until: string;
  deletion_review_at: string;
  review_status: string;
  mdm_release_required: boolean;
  mdm_release_completed_at: string | null;
  it_notified_at: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  confirmation_note: string | null;
  metadata: JsonRecord | null;
  updated_at: string;
};

type ReviewActionBody = {
  action?: string;
  tenant_id?: string;
  note?: string;
};

function text(value: unknown, max = 600) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

async function loadRows(admin: Awaited<ReturnType<typeof requireItAdmin>>) {
  await admin.supabase.rpc("refresh_tenant_deletion_reviews");

  const { data, error } = await admin.supabase
    .from("it_tenant_deletion_review_queue")
    .select("tenant_id,store_name,store_code,lifecycle_kind,service_ended_at,access_grace_until,deletion_review_at,review_status,mdm_release_required,mdm_release_completed_at,it_notified_at,confirmed_by,confirmed_at,confirmation_note,metadata,updated_at")
    .order("deletion_review_at", { ascending: true })
    .returns<DeletionReviewRow[]>();
  if (error) throw new Error(`tenant_deletion_review_query_failed:${error.message}`);

  const rows = data ?? [];
  return {
    rows,
    counts: {
      total: rows.length,
      watching: rows.filter((row) => row.review_status === "watching").length,
      retention: rows.filter((row) => row.review_status === "retention_window").length,
      ready: rows.filter((row) => row.review_status === "ready_for_it_review").length,
      mdm_pending: rows.filter((row) => row.review_status === "mdm_release_pending").length,
      ready_to_delete: rows.filter((row) => row.review_status === "ready_to_delete").length
    }
  };
}

async function queueDeviceOwnerRelease(
  admin: Awaited<ReturnType<typeof requireItAdmin>>,
  tenantId: string,
  note: string
) {
  const { data: devices, error } = await admin.supabase
    .from("mdm_devices")
    .select("device_id,display_name,is_device_owner,is_full_mdm_eligible,capabilities,last_heartbeat_at")
    .eq("tenant_id", tenantId)
    .eq("is_device_owner", true)
    .returns<Array<{
      device_id: string;
      display_name: string | null;
      is_device_owner: boolean;
      is_full_mdm_eligible: boolean;
      capabilities: unknown;
      last_heartbeat_at: string | null;
    }>>();
  if (error) throw new Error(`tenant_mdm_release_devices_failed:${error.message}`);

  let queued = 0;
  const blocked: Array<{ device_id: string; reason: string }> = [];
  for (const device of devices ?? []) {
    const capabilities = Array.isArray(device.capabilities)
      ? device.capabilities.map((value) => String(value).trim().toLowerCase())
      : [];
    if (!capabilities.includes("device_owner_release")) {
      blocked.push({ device_id: device.device_id, reason: "android_app_update_required_for_device_owner_release" });
      continue;
    }

    const existing = await admin.supabase
      .from("mdm_commands")
      .select("id,status")
      .eq("tenant_id", tenantId)
      .eq("device_id", device.device_id)
      .eq("command_type", "release_device_owner")
      .in("status", ["queued", "picked_up", "running"])
      .order("queued_at", { ascending: false })
      .limit(1);
    if (existing.error) throw new Error(`tenant_mdm_release_lookup_failed:${existing.error.message}`);
    if ((existing.data ?? []).length > 0) continue;

    const now = new Date();
    const { error: insertError } = await admin.supabase.from("mdm_commands").insert({
      tenant_id: tenantId,
      device_id: device.device_id,
      command_type: "release_device_owner",
      status: "queued",
      reason: note || "IT-confirmed tenant offboarding: release Android Device Owner before permanent deletion.",
      payload: {
        offboarding: true,
        allow_customer_uninstall: true,
        tenant_id: tenantId
      },
      requested_by: admin.auth.userId,
      requested_by_role: admin.auth.platformRole,
      eligibility_snapshot: {
        is_device_owner: device.is_device_owner,
        is_full_mdm_eligible: device.is_full_mdm_eligible,
        capabilities,
        last_heartbeat_at: device.last_heartbeat_at
      },
      queued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 24 * 60 * 60_000).toISOString()
    });
    if (insertError) throw new Error(`tenant_mdm_release_queue_failed:${insertError.message}`);
    queued += 1;
  }

  return { queued, blocked, device_count: devices?.length ?? 0 };
}

async function cleanupCommunications(
  admin: Awaited<ReturnType<typeof requireItAdmin>>,
  tenantId: string
) {
  const { data, error } = await admin.itSupabase.rpc("it_delete_tenant_communications", {
    p_tenant_id: tenantId
  });
  if (error) {
    return { completed: false, error: error.message, removed_files: 0 };
  }

  const payload = data && typeof data === "object" && !Array.isArray(data)
    ? data as JsonRecord
    : {};
  const files = Array.isArray(payload.storage_objects)
    ? payload.storage_objects as Array<{ bucket?: unknown; path?: unknown }>
    : [];

  let removed = 0;
  const byBucket = new Map<string, string[]>();
  for (const item of files) {
    const bucket = text(item.bucket, 120);
    const path = text(item.path, 600);
    if (!bucket || !path) continue;
    if (!path.startsWith(tenantId + "/")) {
      return { completed: false, error: "communications_cleanup_path_invalid", removed_files: removed };
    }
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path]);
  }
  for (const [bucket, paths] of byBucket) {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const chunk = paths.slice(offset, offset + 100);
      const result = await admin.itSupabase.storage.from(bucket).remove(chunk);
      if (result.error) {
        return { completed: false, error: result.error.message, removed_files: removed };
      }
      removed += chunk.length;
    }
  }
  return { completed: true, error: null, removed_files: removed };
}

async function finalizeApprovedDeletion(
  admin: Awaited<ReturnType<typeof requireItAdmin>>,
  tenantId: string,
  note: string
) {
  const { data: review, error: reviewError } = await admin.supabase
    .from("tenant_lifecycle_deletion_reviews")
    .select("review_status,mdm_release_required,mdm_release_completed_at,confirmed_at")
    .eq("tenant_id", tenantId)
    .maybeSingle<{
      review_status: string;
      mdm_release_required: boolean;
      mdm_release_completed_at: string | null;
      confirmed_at: string | null;
    }>();
  if (reviewError) throw new Error(`tenant_deletion_review_state_failed:${reviewError.message}`);
  if (!review || review.review_status !== "ready_to_delete" || !review.confirmed_at) {
    return { deleted: false, pending: true, reason: "tenant_not_ready_to_delete" };
  }
  if (review.mdm_release_required && !review.mdm_release_completed_at) {
    return { deleted: false, pending: true, reason: "mdm_release_pending" };
  }

  const tenant = await admin.supabase
    .from("tenants")
    .select("id,code,is_active")
    .eq("id", tenantId)
    .maybeSingle<{ id: string; code: string; is_active: boolean }>();
  if (tenant.error) throw new Error(`tenant_delete_lookup_failed:${tenant.error.message}`);
  if (!tenant.data) return { deleted: true, already_deleted: true, communications: null };

  const access = await admin.supabase
    .from("tenant_access_codes")
    .select("access_code")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ access_code: string }>();
  if (access.error) throw new Error(`tenant_delete_access_code_failed:${access.error.message}`);
  const confirmationCode = access.data?.access_code ?? tenant.data.code;

  if (tenant.data.is_active) {
    const deactivate = await admin.supabase.from("tenants")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", tenantId);
    if (deactivate.error) throw new Error(`tenant_delete_deactivate_failed:${deactivate.error.message}`);
  }

  const primary = await applyTenantControlAction(admin, tenantId, {
    action: "delete_store",
    confirmation_code: confirmationCode,
    admin_reason: note || "IT-confirmed lifecycle retention expiry and permanent tenant deletion."
  });

  const communications = await cleanupCommunications(admin, tenantId);
  await appendItAuditLog({
    tenantId: undefined,
    actorUserId: admin.auth.userId,
    action: communications.completed
      ? "tenant_cross_plane_deletion_completed"
      : "tenant_cross_plane_deletion_partial",
    targetType: "tenant_offboarding",
    targetId: tenantId,
    ipAddress: admin.requestMeta.ipAddress,
    userAgent: admin.requestMeta.userAgent,
    metadata: {
      deleted_tenant_id: tenantId,
      communications_cleanup_completed: communications.completed,
      communications_cleanup_error: communications.error,
      communications_storage_removed: communications.removed_files
    }
  });

  return { deleted: true, primary, communications };
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const admin = await requireItAdmin();
    const data = await loadRows(admin);
    const response = ok(data);
    response.headers.set("cache-control", "private, no-store");
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const admin = await requireItAdmin();
    assertItSupportAction(admin, "เฉพาะ IT Support เท่านั้นที่ยืนยันการเก็บหรือลบร้านถาวรได้");
    const rate = await enforceRateLimit({
      namespace: "it_tenant_deletion_review",
      key: admin.auth.userId,
      max: 12,
      windowMs: 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) return fail("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);

    const body = await readBoundedJson<ReviewActionBody>(request, 8_192);
    const action = text(body?.action, 40).toLowerCase();
    const tenantId = text(body?.tenant_id, 80);
    const note = text(body?.note, 600);
    if (!isUuid(tenantId)) return fail("invalid_tenant_id", "tenant_id is required.", 422);

    if (action === "keep") {
      const { data, error } = await admin.supabase.rpc("it_decide_tenant_deletion_review", {
        p_tenant_id: tenantId,
        p_action: "keep",
        p_actor_user_id: admin.auth.userId,
        p_note: note || "IT reviewed the retention expiry and chose to keep this store."
      });
      if (error) throw new Error(`tenant_deletion_keep_failed:${error.message}`);
      return ok({ decision: data, ...(await loadRows(admin)) });
    }

    if (action === "delete") {
      const { data, error } = await admin.supabase.rpc("it_decide_tenant_deletion_review", {
        p_tenant_id: tenantId,
        p_action: "delete",
        p_actor_user_id: admin.auth.userId,
        p_note: note || "IT confirmed permanent deletion after the configured retention period."
      });
      if (error) throw new Error(`tenant_deletion_confirm_failed:${error.message}`);
      const decision = data && typeof data === "object" && !Array.isArray(data)
        ? data as JsonRecord
        : {};
      const reviewStatus = String(decision.review_status ?? "");
      if (reviewStatus === "mdm_release_pending") {
        const mdm = await queueDeviceOwnerRelease(admin, tenantId, note);
        return ok({ decision, mdm, deleted: false, ...(await loadRows(admin)) });
      }
      if (reviewStatus === "ready_to_delete") {
        const finalized = await finalizeApprovedDeletion(admin, tenantId, note);
        return ok({ decision, finalized, ...(await loadRows(admin)) });
      }
      return ok({ decision, deleted: false, ...(await loadRows(admin)) });
    }

    if (action === "finalize") {
      const finalized = await finalizeApprovedDeletion(admin, tenantId, note);
      return ok({ finalized, ...(await loadRows(admin)) });
    }

    if (action === "release_mdm") {
      const mdm = await queueDeviceOwnerRelease(admin, tenantId, note);
      return ok({ mdm, ...(await loadRows(admin)) });
    }

    return fail("invalid_action", "Unknown deletion-review action.", 422);
  } catch (error) {
    const response = guardItAdminError(error);
    response.headers.set("x-admin-api-ms", String(Date.now() - startedAt));
    return response;
  }
}