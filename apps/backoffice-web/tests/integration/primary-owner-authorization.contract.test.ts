import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../../../../supabase/migrations/20260925045231_cpipos_protect_primary_owner_and_self_role_escalation.sql");
const rolesMigration = read("../../../../supabase/migrations/20260925045630_cpipos_guard_direct_owner_role_mutations.sql");
const provisioning = read("../../src/lib/services/it-admin/store-provisioning-service.ts");
const primaryOwner = read("../../src/app/api/it-admin/v1/tenants/[tenantId]/primary-owner/route.ts");
const adminRole = read("../../src/app/api/it-admin/admin/tenants/[tenantId]/users/route.ts");

describe("first Owner and IT role hardening", () => {
  it("does not allow JWT clients to promote themselves into IT or disable users", () => {
    expect(migration).toContain("revoke update, insert, delete on table public.users_profiles from anon, authenticated");
    expect(migration).toContain("grant update (full_name, email, updated_at)");
    expect(migration).toContain("old.platform_role is distinct from new.platform_role");
    expect(migration).toContain("old.is_active is distinct from new.is_active");
    expect(migration).toContain("revoke truncate, trigger, references on all tables in schema public");
  });
  it("records an explicit first Owner and does not silently replace it on provisioning retry", () => {
    expect(migration).toContain("primary_owner_user_id");
    expect(migration).toContain("where ubr.role='owner'");
    expect(provisioning).toContain("primary_owner_conflict");
    expect(provisioning).toContain(".is(\"primary_owner_user_id\", null)");
    expect(primaryOwner).toContain("canonicalId");
    expect(primaryOwner).toContain("primary_owner_assignment_missing");
    expect(adminRole).toContain("primary_owner_protection_failed");
  });
  it("protects first Owner and owner-role assignments at the DB boundary", () => {
    expect(migration).toContain("cpipos_protect_primary_owner_profile");
    expect(migration).toContain("cpipos_protect_primary_owner_assignment");
    expect(migration).toContain("cpipos_protect_primary_owner_reference");
    expect(rolesMigration).toContain("owner_role_assignment_requires_it");
    expect(rolesMigration).toContain("owner_role_removal_requires_it");
  });
});
