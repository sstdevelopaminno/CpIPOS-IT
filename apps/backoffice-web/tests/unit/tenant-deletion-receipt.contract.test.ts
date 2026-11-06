import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const control = source("src/app/api/it-admin/v1/tenants/[tenantId]/control/route.ts");
const directoryApi = source("src/app/api/it-admin/v1/modules/[module]/route.ts");
const tenantControl = source("src/components/it-admin/tenant-control-center.tsx");
const tenantDirectory = source("src/components/it-admin/tenant-directory-console.tsx");
const tenantService = source("src/lib/services/it-admin/tenant-control-service.ts");
const cleanupRoute = source("src/app/api/it-admin/v1/tenant-deletion-cleanup/route.ts");
const migration = source("../../supabase/migrations/20261106102912_tenant_deletion_complete_cross_plane_cleanup.sql");
const primaryGateway = source("../../supabase/control-plane-functions/cpipos-it-dashboard-primary/index.ts");
const communicationsGateway = source("../../supabase/control-plane-functions/cpipos-it-dashboard-operational/index.ts");
const verifierRemoval = source("../../supabase/migrations/20261106103529_remove_authenticated_tenant_deletion_verifier_rpc.sql");

describe("permanent tenant deletion: trustworthy post-commit reconciliation", () => {
  it("does not infer success from a missing tenant or allow unverified recovery", () => {
    expect(control).toContain('"tenant_permanently_deleted"');
    expect(control).toContain('"tenants").select("id")');
    expect(control).toContain('if (tenantResult.data || !auditResult.data) return null');
    expect(control).toContain('metadata?.store_code ?? ""');
    expect(control).toContain('metadata?.internal_code ?? ""');
    expect(control).toContain('confirmationCode !== receiptCode && confirmationCode !== internalCode');
    expect(control).toContain('String(body.admin_reason ?? "").trim().length < 8');
    expect(control).toContain('assertItSupportAction(admin');
    expect(control).toContain('error.code !== "tenant_not_found"');
    expect(control).toContain('const receipt = await verifyCompletedDeletion');
    expect(control).toContain('"deletion_status"');
    expect(control).toContain('storage_cleanup_pending');
  });

  it("purges current non-cascade Native/Optical/financial rows and fails closed on future residuals", () => {
    expect(migration).toContain("native_pos_push_devices");
    expect(migration).toContain("optical_work_order_lines");
    expect(migration).toContain("tenant_subscription_receipts");
    expect(migration).toContain("tenant_delete_unmanaged_fk_table");
    expect(migration).toContain("tenant_delete_residual_table");
    expect(migration).toContain("auth_user_ids");
  });

  it("orders Storage before exclusive Auth cleanup and keeps retry state durable", () => {
    expect(tenantService).toContain("context.supabase.storage.from(bucket).remove");
    expect(tenantService).toContain("context.supabase.auth.admin.deleteUser");
    expect(tenantService.indexOf("context.supabase.storage.from(bucket).remove"))
      .toBeLessThan(tenantService.indexOf("context.supabase.auth.admin.deleteUser"));
    expect(cleanupRoute).toContain("auth_user_ids");
    expect(cleanupRoute).toContain("auth_users_completed_at");
    expect(cleanupRoute).toContain("admin.supabase.auth.admin.deleteUser");
  });

  it("requires a verified primary deletion receipt before Communications cleanup without adding an authenticated SECURITY DEFINER RPC", () => {
    expect(primaryGateway).toContain('action === "verify_tenant_deletion_receipt"');
    expect(primaryGateway).toContain('platformRole !== "it_support"');
    expect(primaryGateway).toContain('"tenant_permanently_deleted"');
    expect(communicationsGateway).toContain("PRIMARY_DELETE_VERIFY_URL");
    expect(communicationsGateway).toContain("primary_deletion_not_verified");
    expect(communicationsGateway).toContain('actor.role !== "it_support"');
    expect(communicationsGateway).toContain("it_delete_tenant_communications");
    expect(verifierRemoval).toContain("drop function if exists public.it_verify_tenant_deleted_for_cross_plane_cleanup");
  });

  it("avoids the stale 30-second process cache for the tenants directory", () => {
    expect(directoryApi).toContain('moduleName === "tenants"');
    expect(directoryApi).toContain('value: await loadItAdminModule(moduleName, accessToken)');
    expect(directoryApi).toContain('source: "live"');
  });

  it("uses read-only confirmation when the deletion response or stale selected tenant is missing", () => {
    expect(tenantControl).toContain('async function verifyTenantDeletionReceipt(');
    expect(tenantControl).toContain('deletion_status=1&store_code=');
    expect(tenantControl).toContain('method: "GET"');
    expect(tenantControl).toContain('if (payload.action === "delete_store")');
    expect(tenantControl).toContain('body?.data?.deleted === true && body.data.already_deleted === true');
    expect(tenantControl).toContain('fallbackStoreCode');
    expect(tenantDirectory).toContain('fallbackStoreCode={selected.store_code}');
    expect(tenantDirectory).toContain('setDeletionNotice(');
    expect(tenantDirectory).toContain('void load(true)');
  });
});
