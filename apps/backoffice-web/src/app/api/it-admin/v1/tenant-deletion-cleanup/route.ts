import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";
import { readBoundedJson } from "@/lib/server/limited-json";
import {
  cleanupTenantCommunications,
  recordTenantCommunicationsCleanup
} from "@/lib/services/it-admin/tenant-communications-cleanup";

export const dynamic = "force-dynamic";

const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

type PrimaryJournal = {
  tenant_id: string;
  storage_objects: unknown;
  auth_user_ids: unknown;
  status: string;
  storage_completed_at: string | null;
  auth_users_completed_at: string | null;
};
type CommunicationsJournal = {
  tenant_id: string;
  status: string;
  last_error: string | null;
  attempted_at: string | null;
  completed_at: string | null;
};

export async function GET() {
  try {
    const admin = await requireItAdmin();
    const [primary, communications] = await Promise.all([
      admin.supabase.from("it_tenant_deletion_cleanup")
        .select("tenant_id,storage_objects,auth_user_ids,storage_completed_at,auth_users_completed_at,created_at")
        .eq("status", "pending").order("created_at", { ascending: true }).limit(50),
      admin.supabase.from("it_tenant_communications_cleanup")
        .select("tenant_id,status,last_error,attempted_at,completed_at,requested_at")
        .eq("status", "pending").order("requested_at", { ascending: true }).limit(50)
    ]);
    if (primary.error || communications.error) {
      throw new Error(primary.error?.message ?? communications.error?.message ?? "tenant_cleanup_queue_unavailable");
    }
    const response = ok({
      pending: (primary.data ?? []).map((row) => ({
        tenant_id: row.tenant_id,
        file_count: Array.isArray(row.storage_objects) ? row.storage_objects.length : 0,
        auth_user_count: Array.isArray(row.auth_user_ids) ? row.auth_user_ids.length : 0,
        storage_completed: Boolean(row.storage_completed_at),
        auth_users_completed: Boolean(row.auth_users_completed_at),
        created_at: row.created_at
      })),
      communications_pending: (communications.data ?? []).map((row) => ({
        tenant_id: row.tenant_id,
        last_error: row.last_error,
        last_attempted_at: row.attempted_at,
        created_at: row.requested_at
      }))
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireItAdmin();
    assertItSupportAction(admin, "เฉพาะ IT Support เท่านั้นที่ยืนยันการล้างข้อมูลหลังลบร้านได้");
    const rate = await enforceRateLimit({
      namespace: "it_tenant_deletion_cleanup", key: admin.auth.userId,
      max: 10, windowMs: 60_000, failClosedOnBackendError: true
    });
    if (!rate.ok) return fail("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);

    const body = await readBoundedJson<{ tenant_id?: unknown; confirmation?: unknown }>(request, 4_096);
    if (!isUuid(body?.tenant_id)) return fail("invalid_tenant_id", "Tenant ID is required.", 422);
    if (body?.confirmation !== "RETRY_CLEANUP") {
      return fail("cleanup_confirmation_required", "IT must confirm RETRY_CLEANUP before removing remaining data.", 422);
    }
    const tenantId = body.tenant_id;

    // Cleanup is only for a tenant ALREADY deleted by an approved primary
    // transaction, never a shortcut for removing a merely suspended store.
    const [tenant, audit, primaryLookup, communicationsLookup] = await Promise.all([
      admin.supabase.from("tenants").select("id").eq("id", tenantId).maybeSingle(),
      admin.supabase.from("audit_logs").select("id").eq("target_id", tenantId)
        .eq("target_table", "tenants").eq("action", "tenant_permanently_deleted")
        .limit(1).maybeSingle(),
      admin.supabase.from("it_tenant_deletion_cleanup")
        .select("tenant_id,storage_objects,auth_user_ids,status,storage_completed_at,auth_users_completed_at")
        .eq("tenant_id", tenantId).maybeSingle<PrimaryJournal>(),
      admin.supabase.from("it_tenant_communications_cleanup")
        .select("tenant_id,status,last_error,attempted_at,completed_at")
        .eq("tenant_id", tenantId).maybeSingle<CommunicationsJournal>()
    ]);
    if (tenant.error || audit.error || primaryLookup.error || communicationsLookup.error) {
      throw new Error("tenant_deletion_cleanup_receipt_unavailable");
    }
    if (tenant.data) return fail("tenant_still_exists", "Store still exists. Cleanup is not allowed.", 409);
    if (!audit.data) return fail("tenant_deletion_unverified", "No verified primary deletion receipt exists.", 409);

    const journal = primaryLookup.data;
    const commJournal = communicationsLookup.data;
    if (!journal && !commJournal) return fail("cleanup_not_found", "No cleanup record found.", 404);
    if ((!journal || journal.status === "complete") && (!commJournal || commJournal.status === "complete")) {
      return ok({ completed: true, tenant_id: tenantId, already_completed: true });
    }

    let storageRemoved = 0;
    let authUsersDeleted = 0;
    let communicationsRemoved = 0;

    if (journal && journal.status === "pending") {
      const files = (Array.isArray(journal.storage_objects) ? journal.storage_objects : []) as
        Array<{ bucket?: string; path?: string }>;
      const authUserIds = (Array.isArray(journal.auth_user_ids) ? journal.auth_user_ids : [])
        .map((value: unknown) => String(value ?? "").trim()).filter(isUuid);

      if (!journal.storage_completed_at) {
        const byBucket = new Map<string, string[]>();
        for (const file of files) {
          if (!file.bucket || !file.path?.startsWith(tenantId + "/")) {
            return fail("cleanup_path_invalid", "Invalid tenant-scoped object path.", 409);
          }
          byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file.path]);
        }
        for (const [bucket, paths] of byBucket) {
          for (let offset = 0; offset < paths.length; offset += 100) {
            const chunk = paths.slice(offset, offset + 100);
            const { error } = await admin.supabase.storage.from(bucket).remove(chunk);
            if (error) {
              console.error("[tenant-deletion-cleanup] storage remove failed", { tenantId, bucket, error: error.message });
              return fail("storage_cleanup_retry_failed", "Storage deletion is incomplete. Please retry.", 503);
            }
            storageRemoved += chunk.length;
          }
        }
        const { error } = await admin.supabase.from("it_tenant_deletion_cleanup")
          .update({ storage_completed_at: new Date().toISOString() })
          .eq("tenant_id", tenantId).eq("status", "pending");
        if (error) throw error;
      }

      if (!journal.auth_users_completed_at) {
        for (const userId of authUserIds) {
          const result = await admin.supabase.auth.admin.deleteUser(userId);
          if (result.error && !/not found/i.test(String(result.error.message ?? ""))) {
            console.error("[tenant-deletion-cleanup] auth user delete failed", { tenantId, userId, error: result.error.message });
            return fail("auth_cleanup_retry_failed", "Auth user cleanup is incomplete. Please retry.", 503);
          }
          if (!result.error) authUsersDeleted++;
        }
        const { error } = await admin.supabase.from("it_tenant_deletion_cleanup")
          .update({ auth_users_completed_at: new Date().toISOString() })
          .eq("tenant_id", tenantId).eq("status", "pending");
        if (error) throw error;
      }

      const { error } = await admin.supabase.from("it_tenant_deletion_cleanup")
        .update({ status: "complete", completed_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("status", "pending");
      if (error) throw error;
    }

    if (commJournal?.status === "pending") {
      const outcome = await cleanupTenantCommunications(admin, tenantId, request);
      await recordTenantCommunicationsCleanup(admin, tenantId, outcome);
      communicationsRemoved = outcome.removed_files;
      if (!outcome.completed) {
        return fail("communications_cleanup_retry_failed",
          "Primary data cleanup completed; Communications cleanup remains pending. IT can retry safely.", 503);
      }
    }

    await appendAuditLog({
      actorUserId: admin.auth.userId,
      actorRole: admin.auth.platformRole,
      action: "tenant_deletion_cleanup_completed",
      targetTable: "it_tenant_deletion_cleanup",
      targetId: tenantId,
      module: "it_admin",
      metadata: {
        deleted_tenant_id: tenantId,
        storage_objects_removed: storageRemoved,
        auth_users_deleted: authUsersDeleted,
        communications_storage_removed: communicationsRemoved
      }
    });

    return ok({
      completed: true, tenant_id: tenantId,
      storage_objects_removed: storageRemoved,
      auth_users_deleted: authUsersDeleted,
      communications_storage_removed: communicationsRemoved
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}
