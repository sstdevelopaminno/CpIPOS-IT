import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const route = source("../../src/app/api/it-admin/v1/store-provisioning/route.ts");
const service = source("../../src/lib/services/it-admin/store-provisioning-service.ts");
const page = source("../../src/app/(it-admin)/it-admin/tenants/page.tsx");
const consoleUi = source("../../src/components/it-admin/store-provisioning-console.tsx");

describe("IT Store Provisioning P0", () => {
  it("keeps Store Provisioning behind the IT Admin guard", () => {
    expect(route).toContain("requireItAdmin()");
    expect(page).toContain("requireItAdmin()");
    expect(route).toContain('x-provisioning-request-id');
  });

  it("writes business provisioning through CpiPOS-001 context and never through the IT MDM client", () => {
    expect(service).toContain('context.supabase.rpc("provision_it_store_core"');
    expect(service).not.toContain("itSupabase");
    expect(page).toContain('context.supabase.from("subscription_packages")');
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
  });

  it("keeps retry identity stable through request_id and blocks non-standard package fast provisioning", () => {
    expect(consoleUi).toContain("request_id: requestId");
    expect(consoleUi).toContain("Request ID เดิม");
    expect(consoleUi).toContain('item.quota_mode === "standard"');
    expect(consoleUi).toContain("Custom package ไม่เปิดผ่าน Fast Provisioning");
  });

  it("ends onboarding at Device Enrollment without creating a parallel MDM path", () => {
    expect(service).toContain('status: "ready_for_device_enrollment"');
    expect(service).toContain('next_step: "register_device"');
    expect(consoleUi).toContain("Register Device / Android / Print Agent");
  });
});
