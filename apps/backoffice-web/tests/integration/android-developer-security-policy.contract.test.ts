import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT tenant Android developer security switch", () => {
  const api = source("src/app/api/it-admin/v1/tenants/[tenantId]/android-security/route.ts");
  const card = source("src/components/it-admin/tenant-android-security-policy.tsx");
  const control = source("src/components/it-admin/tenant-control-center.tsx");
  it("requires IT auth, tenant validation, audited writes and rate limit", () => {
    expect(api).toContain("await requireItAdmin()");
    expect(api).toContain("parseTenantParam");
    expect(api).toContain("assertTenantExists");
    expect(api).toContain('typeof body?.enforce_developer_options_off !== "boolean"');
    expect(api).toContain('namespace: "it_android_developer_policy"');
    expect(api).toContain("appendAuditLog");
    expect(api).toContain('onConflict: "tenant_id"');
  });
  it("adds one switch card in Tenants / Stores and uses no optimistic success", () => {
    expect(control).toContain('setTab("androidSecurity")');
    expect(control).toContain('<TenantAndroidSecurityPolicy tenantId={tenantId} />');
    expect(card).toContain('role="switch"');
    expect(card).toContain('method: "PATCH"');
    expect(card).toContain("setPolicy(body.data)");
  });
});
