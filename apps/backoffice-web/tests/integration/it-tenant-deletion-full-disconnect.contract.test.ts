import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const gate = read("../../supabase/migrations/20261114160000_it_tenant_delete_review_gate_and_command_fence.sql");
const commMigration = read("../../supabase/migrations/20261114161000_it_tenant_communications_cleanup_journal.sql");
const service = read("src/lib/services/it-admin/tenant-control-service.ts");
const deletionRoute = read("src/app/api/it-admin/v1/deletion-reviews/route.ts");
const directControl = read("src/app/api/it-admin/v1/tenants/[tenantId]/control/route.ts");
const controlCenter = read("src/components/it-admin/tenant-control-center.tsx");
const cleanupRoute = read("src/app/api/it-admin/v1/tenant-deletion-cleanup/route.ts");
const commService = read("src/lib/services/it-admin/tenant-communications-cleanup.ts");
const cleanupUI = read("src/components/it-admin/tenant-deletion-cleanup-console.tsx");
const reviewPage = read("src/app/(it-admin)/it-admin/deletion-reviews/page.tsx");

describe("IT Support-controlled offboarding and complete tenant disconnect", () => {
  it("never deletes on suspension, deactivation or during the paid grace window", () => {
    expect(service).toContain('action === "deactivate_store"');
    expect(service).toContain('action === "suspend_package"');
    expect(service).toContain('if (action === "delete_store")');
    expect(service).toContain('review.review_status !== "ready_to_delete"');
    expect(service).toContain("tenant_delete_retention_active");
    expect(gate).toContain("review.access_grace_until <= now()");
    expect(gate).toContain("review.deletion_review_at <= now()");
    expect(gate).toContain("lifecycle.lock_reason = 'tenant_deletion_confirmed'");
  });

  it("enforces IT Support + approved lifecycle + MDM release on both server and database", () => {
    expect(service).toContain('context.auth.platformRole !== "it_support"');
    expect(service).toContain("tenant_delete_review_required");
    expect(service).toContain("tenant_delete_mdm_release_required");
    expect(service).toContain("tenant_delete_lifecycle_changed");
    expect(service).toContain('rpc("it_delete_tenant_cascade"');
    expect(gate).toContain("v_tenant.is_active");
    expect(gate).toContain("review.review_status = 'ready_to_delete'");
    expect(gate).toContain("review.confirmed_at is not null");
    expect(gate).toContain("review.confirmed_by is not null");
    expect(gate).toContain("review.mdm_release_completed_at is not null");
    expect(gate).toContain("tenant_delete_review_required");
    expect(gate).toContain("platform_role = 'it_support'");
    expect(directControl).toContain("assertItSupportAction(admin");
  });

  it("IT UI sends all permanent-delete requests to the confirmation queue", () => {
    expect(controlCenter).toContain('href="/it-admin/deletion-reviews"');
    expect(controlCenter).toContain("ห้ามลบข้อมูลทันทีเพียงเพราะร้านถูกระงับ");
    expect(controlCenter).not.toContain('onClick={() => void mutate({ action: "delete_store"');
    expect(deletionRoute).toContain('action === "delete" || action === "finalize"');
    expect(deletionRoute).toContain('"invalid_store_confirmation"');
    expect(deletionRoute).toContain('"deletion_retention_active"');
  });

  it("revokes sessions and pending commands, preserving only Device Owner release transport", () => {
    expect(gate).toContain("public.pos_sessions");
    expect(gate).toContain("public.device_commands");
    expect(gate).toContain("public.mdm_commands");
    expect(gate).toContain("public.mdm_remote_support_sessions");
    expect(gate).toContain("status = 'revoked'");
    expect(gate).toContain("status = 'expired'");
    expect(gate).toContain("status = 'cancelled'");
    expect(gate).toContain("status = 'ended'");
    expect(gate).toContain("command_type <> 'release_device_owner'");
    expect(gate).toContain("new.command_type = 'release_device_owner'");
    expect(gate).toContain("raise exception 'tenant_offboarding_commands_blocked'");
  });

  it("journals Communications cleanup in the same database transaction as deletion", () => {
    expect(commMigration).toContain("after delete on public.tenants");
    expect(commMigration).toContain("it_tenant_communications_cleanup");
    expect(commMigration).toContain("status = 'pending'");
    expect(commMigration).toContain("from public, anon, authenticated");
    expect(deletionRoute).toContain("await recordTenantCommunicationsCleanup(admin, tenantId, communications)");
    expect(commService).toContain("CPIPOS_COMMUNICATIONS_EDGE_URL");
    expect(commService).toContain("delete_tenant_communications");
    expect(commService).toContain("AbortSignal.timeout(20_000)");
  });

  it("only retries after a confirmed Primary deletion audit receipt and IT approval", () => {
    expect(cleanupRoute).toContain("assertItSupportAction(admin");
    expect(cleanupRoute).toContain('body?.confirmation !== "RETRY_CLEANUP"');
    expect(cleanupRoute).toContain('action", "tenant_permanently_deleted"');
    expect(cleanupRoute).toContain('if (tenant.data) return fail("tenant_still_exists"');
    expect(cleanupRoute).toContain('if (!audit.data) return fail("tenant_deletion_unverified"');
    expect(cleanupRoute).toContain("await recordTenantCommunicationsCleanup(admin, tenantId, outcome)");
    expect(cleanupRoute).toContain("auth_users_completed_at");
    expect(cleanupRoute).toContain('from("it_tenant_communications_cleanup")');
    expect(cleanupUI).toContain("RETRY_CLEANUP");
    expect(cleanupUI).toContain("canDelete");
    expect(reviewPage).toContain("<TenantDeletionCleanupConsole />");
  });
});
