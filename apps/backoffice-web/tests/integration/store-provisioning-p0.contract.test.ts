import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const route = source("../../src/app/api/it-admin/v1/store-provisioning/route.ts");
const moduleRoute = source("../../src/app/api/it-admin/v1/modules/[module]/route.ts");
const service = source("../../src/lib/services/it-admin/store-provisioning-service.ts");
const provisioningPage = source("../../src/app/(it-admin)/it-admin/store-provisioning/page.tsx");
const tenantsPage = source("../../src/app/(it-admin)/it-admin/tenants/page.tsx");
const moduleConsole = source("../../src/components/it-admin/it-admin-module-console.tsx");
const connectedProvisioning = source("../../src/components/it-admin/connected-store-provisioning.tsx");
const consoleUi = source("../../src/components/it-admin/store-provisioning-console.tsx");
const layout = source("../../src/app/(it-admin)/layout.tsx");
const primaryModuleBridge = source("../../../../supabase/control-plane-functions/cpipos-it-module-primary/index.ts");

describe("IT Store Provisioning P0", () => {
  it("keeps Store Provisioning behind shared IT Admin guards", () => {
    expect(route).toContain("requireItAdmin()");
    expect(moduleRoute).toContain("requireItAdmin()");
    expect(route).toContain("x-provisioning-request-id");
    expect(layout).toContain("getAuthContext({ requireBranchScope: false })");
    expect(layout).toContain('auth.platformRole !== "it_admin"');
    expect(layout).toContain('href: "/it-admin/store-provisioning"');
  });

  it("separates the Store directory from the privileged provisioning workflow", () => {
    expect(tenantsPage).toContain('module="tenants"');
    expect(tenantsPage).not.toContain("StoreProvisioningConsole");
    expect(moduleConsole).toContain('href: "/it-admin/store-provisioning"');
    expect(provisioningPage).toContain("ConnectedStoreProvisioning");
    expect(connectedProvisioning).toContain("StoreProvisioningConsole");
    expect(connectedProvisioning).toContain("language={language}");
  });

  it("writes business provisioning through CpiPOS-001 while package reads use the authenticated read-only bridge", () => {
    expect(service).toContain('context.supabase.rpc("provision_it_store_core"');
    expect(service).not.toContain("itSupabase");
    expect(primaryModuleBridge).toContain('.from("subscription_packages")');
    expect(primaryModuleBridge).toContain('module === "packages" || module === "provisioning"');
    expect(provisioningPage).not.toContain("context.supabase");
  });

  it("uses Auth as Owner identity source and binds POS profile plus owner branch role", () => {
    expect(service).toContain("supabase.auth.admin.createUser");
    expect(service).toContain('.from("users_profiles")');
    expect(service).toContain('.from("pos_user_profiles")');
    expect(service).toContain('.from("user_branch_roles")');
    expect(service).toContain('role: "owner"');
    expect(service).toContain('is_default: true');
  });

  it("hashes the Owner PIN and does not send it to the core RPC", () => {
    expect(service).toContain("bcrypt.hash(input.pin, 12)");
    expect(service).toContain("bcrypt.compare(input.pin, profile.pin_hash)");
    expect(service).not.toContain("p_pin:");
    expect(service).toContain("owner_pin_conflict_existing_identity");
    expect(consoleUi).toContain("pinHidden");
  });

  it("enforces Trial-only provisioning and priced standard-package intervals", () => {
    expect(service).toContain('contractStatus !== "trial"');
    expect(service).toContain("paid_activation_requires_approval");
    expect(service).toContain('p_contract_status: "trial"');
    expect(consoleUi).toContain('item.quota_mode === "standard"');
    expect(consoleUi).toContain("item.monthly_price > 0");
    expect(consoleUi).toContain("item.yearly_price > 0");
    expect(consoleUi).toContain('status: "trial"');
  });

  it("keeps retry identity stable and ends onboarding at Device Enrollment", () => {
    expect(consoleUi).toContain("request_id: requestId");
    expect(consoleUi).toContain("Request ID เดิม");
    expect(service).toContain('status: "ready_for_device_enrollment"');
    expect(service).toContain('next_step: "register_device"');
    expect(consoleUi).toContain("Device Enrollment / Android / Print Agent");
  });
});
