import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const control = source("src/app/api/it-admin/v1/tenants/[tenantId]/control/route.ts");
const directoryApi = source("src/app/api/it-admin/v1/modules/[module]/route.ts");
const tenantControl = source("src/components/it-admin/tenant-control-center.tsx");
const tenantDirectory = source("src/components/it-admin/tenant-directory-console.tsx");

describe("permanent tenant deletion: trustworthy post-commit reconciliation", () => {
  it("does not infer success from a missing tenant or allow unverified recovery", () => {
    expect(control).toContain('"tenant_permanently_deleted"');
    expect(control).toContain('"tenants").select("id")');
    expect(control).toContain('if (tenantResult.data || !auditResult.data) return null');
    expect(control).toContain('metadata?.store_code ?? ""');
    expect(control).toContain('String(body.admin_reason ?? "").trim().length < 8');
    expect(control).toContain('assertItSupportAction(admin');
    expect(control).toContain('error.code !== "tenant_not_found"');
    expect(control).toContain('const receipt = await verifyCompletedDeletion');
    expect(control).toContain('"deletion_status"');
    expect(control).toContain('storage_cleanup_pending');
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
    expect(tenantControl).not.toContain('void mutate({ action: "delete_store"');
  });
});
