import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const ownerRoute = source("../../src/app/api/it-admin/v1/tenants/[tenantId]/primary-owner/route.ts");
const ownerCard = source("../../src/components/it-admin/tenant-primary-owner-card.tsx");
const preEntryAuth = source("../../src/lib/server/pre-entry-auth.ts");
const authVerification = source("../../src/lib/server/auth-verification.ts");

describe("Owner POS login identity contract", () => {
  it("keeps employee identity and Owner PIN as two explicit connected stages", () => {
    expect(ownerRoute).toContain('from("pos_user_profiles")');
    expect(ownerRoute).toContain("employee_code");
    expect(ownerRoute).toContain("pos_profile_configured");
    expect(ownerRoute).toContain("login_ready");
    expect(ownerRoute).toContain('permission_role: "owner"');
    expect(ownerRoute).toContain('onConflict: "tenant_id,user_id"');
    expect(ownerRoute).toContain("owner_employee_code_conflict");
    expect(ownerRoute).toContain("bcrypt.hash(ownerPin");
  });

  it("shows the POS employee code in IT Admin instead of implying PIN is the employee code", () => {
    expect(ownerCard).toContain("POS LOGIN IDENTITY");
    expect(ownerCard).toContain("รหัสพนักงาน POS");
    expect(ownerCard).toContain("รหัสนี้ไม่ใช่รหัส Owner/PIN");
    expect(ownerCard).toContain("รหัสพนักงาน POS → รหัส Owner/PIN");
    expect(ownerCard).toContain("login_ready");
  });

  it("resolves the employee first and verifies the PIN independently", () => {
    expect(preEntryAuth).toContain("resolveEmployeeByProfileCode");
    expect(preEntryAuth).toContain('from("pos_user_profiles")');
    expect(preEntryAuth).toContain("resolveEmployeeByCode");
    expect(authVerification).toContain("bcrypt.compare");
    expect(authVerification).toContain("pin_hash");
  });
});
