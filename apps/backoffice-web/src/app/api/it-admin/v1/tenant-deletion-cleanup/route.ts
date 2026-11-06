import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { assertItSupportAction, guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);

export async function GET() {
  try {
    const admin = await requireItAdmin();
    const { data, error } = await admin.supabase
      .from("it_tenant_deletion_cleanup")
      .select("tenant_id,storage_objects,auth_user_ids,storage_completed_at,auth_users_completed_at,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    const response = ok({
      pending: (data ?? []).map((row) => ({
        tenant_id: row.tenant_id,
        file_count: Array.isArray(row.storage_objects) ? row.storage_objects.length : 0,
        auth_user_count: Array.isArray(row.auth_user_ids) ? row.auth_user_ids.length : 0,
        storage_completed: Boolean(row.storage_completed_at),
        auth_users_completed: Boolean(row.auth_users_completed_at),
        created_at: row.created_at
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
    assertItSupportAction(admin, "IT Admin ไม่มีสิทธิ์ล้างข้อมูลค้างหลังลบร้าน; ใช้ IT Support สำหรับรายการนี้");
    const rate = await enforceRateLimit({
      namespace: "it_tenant_deletion_cleanup", key: admin.auth.userId,
      max: 10, windowMs: 60_000
    });
    if (!rate.ok) return fail("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);

    const body = await request.json().catch(() => null) as { tenant_id?: unknown } | null;
    if (!isUuid(body?.tenant_id)) return fail("invalid_tenant_id", "Tenant ID is required.", 422);
    const tenantId = body.tenant_id;

    const tenant = await admin.supabase.from("tenants")
      .select("id").eq("id", tenantId).maybeSingle();
    if (tenant.error) throw tenant.error;
    if (tenant.data) return fail("tenant_still_exists", "Store still exists. Cleanup is not allowed.", 409);

    const { data: journal, error: lookupError } = await admin.supabase
      .from("it_tenant_deletion_cleanup")
      .select("tenant_id,storage_objects,auth_user_ids,status,storage_completed_at,auth_users_completed_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!journal) return fail("cleanup_not_found", "No cleanup record found.", 404);
    if (journal.status === "complete") return ok({ completed: true, tenant_id: tenantId });

    const files = (Array.isArray(journal.storage_objects) ? journal.storage_objects : []) as
      Array<{ bucket?: string; path?: string }>;
    const authUserIds = (Array.isArray(journal.auth_user_ids) ? journal.auth_user_ids : [])
      .map((value: unknown) => String(value ?? "").trim())
      .filter(isUuid);

    let storageRemoved = 0;
    let authUsersDeleted = 0;

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
            console.error("[tenant-deletion-cleanup] storage remove failed", {
              tenantId, bucket, error: error.message
            });
            return fail("storage_cleanup_retry_failed", "Storage deletion is incomplete. Please retry.", 503);
          }
          storageRemoved += chunk.length;
        }
      }

      const { error: storageSavedError } = await admin.supabase
        .from("it_tenant_deletion_cleanup")
        .update({ storage_completed_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("status", "pending");
      if (storageSavedError) throw storageSavedError;
    }

    if (!journal.auth_users_completed_at) {
      for (const userId of authUserIds) {
        const result = await admin.supabase.auth.admin.deleteUser(userId);
        if (result.error && !/not found/i.test(String(result.error.message ?? ""))) {
          console.error("[tenant-deletion-cleanup] auth user delete failed", {
            tenantId, userId, error: result.error.message
          });
          return fail("auth_cleanup_retry_failed", "Auth user cleanup is incomplete. Please retry.", 503);
        }
        if (!result.error) authUsersDeleted += 1;
      }

      const { error: authSavedError } = await admin.supabase
        .from("it_tenant_deletion_cleanup")
        .update({ auth_users_completed_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("status", "pending");
      if (authSavedError) throw authSavedError;
    }

    const completedAt = new Date().toISOString();
    const { error: savedError } = await admin.supabase
      .from("it_tenant_deletion_cleanup")
      .update({ status: "complete", completed_at: completedAt })
      .eq("tenant_id", tenantId)
      .eq("status", "pending");
    if (savedError) throw savedError;

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
        auth_users_deleted: authUsersDeleted
      }
    });

    return ok({
      completed: true,
      tenant_id: tenantId,
      storage_objects_removed: storageRemoved,
      auth_users_deleted: authUsersDeleted
    });
  } catch (error) {
    return guardItAdminError(error);
  }
}
