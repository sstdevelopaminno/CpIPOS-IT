import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT role access controls", () => {
  const guard = src("src/lib/it-admin-guard.ts");
  const login = src("src/app/api/it-admin/auth/login/route.ts");
  const layout = src("src/app/(it-admin)/layout.tsx");
  const shell = src("src/components/layout/app-shell.tsx");
  const itUsers = src("src/app/api/it-admin/v1/it-users/route.ts");
  const itUsersPage = src("src/app/(it-admin)/it-admin/settings/users/page.tsx");

  it("allows IT Admin and IT Support into the control plane while keeping IT Support as full-access role", () => {
    expect(guard).toContain('auth.platformRole !== "it_admin" && auth.platformRole !== "it_support"');
    expect(guard).toContain("requireItSupport");
    expect(guard).toContain("assertItSupportAction");
    expect(login).toContain('profile.platform_role !== "it_admin" && profile.platform_role !== "it_support"');
  });

  it("allows IT Support through Supabase control-plane bridge functions", () => {
    for (const path of [
      "../../supabase/control-plane-functions/cpipos-it-dashboard-primary/index.ts",
      "../../supabase/control-plane-functions/cpipos-it-module-primary/index.ts",
      "../../supabase/control-plane-functions/cpipos-it-dashboard-operational/index.ts",
      "../../supabase/control-plane-functions/cpipos-it-module-operational/index.ts"
    ]) {
      const bridge = src(path);
      expect(bridge).toContain('"it_support"');
      expect(bridge).toContain('"it_admin"');
    }
  });

  it("shows IT Admin only the approved core menus and hides IT-user administration", () => {
    expect(layout).toContain('if (role === "it_admin")');
    for (const href of [
      "/it-admin/tenants",
      "/it-admin/store-registrations",
      "/it-admin/branches",
      "/it-admin/pos-users",
      "/it-admin/subscription-payments",
      "/it-admin/license-issuer",
      "/it-admin/settings/email-footer",
      "/it-admin/settings/language"
    ]) expect(layout).toContain(href);
    expect(layout).toContain('role === "it_support"');
    expect(layout).toContain('/it-admin/settings/users');
    expect(layout).not.toContain('href: "/it-admin/store-provisioning"');
    expect(src("src/components/it-admin/tenant-directory-console.tsx")).toContain("ConnectedStoreProvisioning");
    expect(layout).toContain('restrictToNavigation={auth.platformRole === "it_admin"}');
  });

  it("keeps IT user settings separate from POS/tenant users", () => {
    expect(itUsers).toContain('const IT_ROLES: ItRole[] = ["it_admin", "it_support"]');
    expect(itUsers).toContain("requireItSupport()");
    expect(itUsers).not.toContain("tenant_user");
    expect(itUsers).not.toContain("user_branch_roles");
    expect(itUsers).not.toContain("pos_user_profiles");
    expect(itUsers).not.toContain("pos_sessions");
    expect(itUsersPage).toContain('auth.platformRole !== "it_support"');
    expect(itUsersPage).toContain("ItSystemUsersConsole");
  });

  it("supports collapsible Settings / Security submenus", () => {
    expect(shell).toContain("expandedTrees");
    expect(shell).toContain("aria-expanded={treeOpen}");
    expect(shell).toContain("navTreeToggle");
    expect(shell).toContain("navCaretOpen");
  });

  it("reserves destructive actions for IT Support", () => {
    for (const path of [
      "src/app/api/it-admin/v1/tenants/[tenantId]/route.ts",
      "src/app/api/it-admin/v1/tenants/[tenantId]/control/route.ts",
      "src/app/api/it-admin/v1/tenants/[tenantId]/cashier-devices/route.ts",
      "src/app/api/it-admin/v1/tenant-deletion-cleanup/route.ts",
      "src/app/api/it-admin/v1/store-registrations/route.ts",
      "src/app/api/it-admin/v1/subscription-payments/records/[kind]/[recordId]/route.ts"
    ]) {
      expect(src(path)).toContain("assertItSupportAction");
    }

    for (const path of [
      "src/components/it-admin/store-registrations-console.tsx",
      "src/components/it-admin/subscription-payment-history.tsx",
      "src/components/it-admin/tenant-control-center.tsx",
      "src/components/it-admin/tenant-directory-console.tsx",
      "src/components/it-admin/tenant-cashier-devices.tsx"
    ]) {
      expect(src(path)).toContain("useItAccess");
    }
  });
});
