import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const monitorPage = source("../../src/app/(it-admin)/it-admin/monitoring/page.tsx");
const monitorRoute = source("../../src/app/api/it-admin/v1/monitor/route.ts");
const healthRoute = source("../../src/app/api/it-admin/v1/health/route.ts");
const deviceHealthRoute = source("../../src/app/api/it-admin/v1/devices/[deviceId]/health/route.ts");
const itAdminLayout = source("../../src/app/(it-admin)/layout.tsx");
const loginPage = source("../../src/app/it-admin/login/page.tsx");
const loginRoute = source("../../src/app/api/it-admin/auth/login/route.ts");
const rootPage = source("../../src/app/page.tsx");
const nextConfig = source("../../next.config.ts");
const envModule = source("../../src/lib/env.ts");
const authContext = source("../../src/lib/auth-context.ts");
const itAdminGuard = source("../../src/lib/it-admin-guard.ts");
const deviceCommands = source("../../src/lib/device-commands.ts");
const supabaseServer = source("../../src/lib/supabase-server.ts");

describe("IT Admin <-> POS split-control-plane contract", () => {
  it("keeps business monitoring on the IT Admin API namespace", () => {
    expect(monitorPage).toContain("/api/it-admin/v1/monitor");
    expect(monitorPage).not.toContain("/api/admin/pos/monitor");
    expect(monitorRoute).toContain("requireItAdmin()");
  });

  it("checks both Supabase planes without requiring POS runtime secrets", () => {
    expect(healthRoute).toContain('"it_device_health_latest"');
    expect(healthRoute).toContain('"it_device_commands"');
    expect(healthRoute).toContain('mode: "split_supabase"');
    expect(healthRoute).toContain('auth_business_plane: "CpiPOS-001"');
    expect(healthRoute).toContain('it_operational_plane: "CpiPOS-002"');
    expect(healthRoute).not.toContain('"POS_SESSION_HANDOFF_SECRET"');
    expect(healthRoute).not.toContain('"TABLE_QR_SIGNING_SECRET"');
  });

  it("fails closed if any device-health source query fails", () => {
    expect(deviceHealthRoute).toContain("device_health_query_failed");
    expect(deviceHealthRoute).toContain("device_incidents_query_failed");
    expect(deviceHealthRoute).toContain("device_commands_query_failed");
    expect(deviceHealthRoute).toContain('from("it_device_health_latest")');
    expect(deviceHealthRoute).toContain('from("it_device_incidents")');
    expect(deviceHealthRoute).toContain('from("it_device_commands")');
  });

  it("guards every IT Admin page at the shared server layout", () => {
    expect(itAdminLayout).toContain("getAuthContext({ requireBranchScope: false })");
    expect(itAdminLayout).toContain('auth.platformRole !== "it_admin"');
    expect(itAdminLayout).toContain('redirect("/it-admin/login")');
    expect(rootPage).toContain('redirect("/it-admin")');
  });

  it("keeps IT login credentials inside the IT server boundary", () => {
    expect(loginPage).toContain('fetch("/api/it-admin/auth/login"');
    expect(loginPage).not.toContain("getSupabaseBrowserClient");
    expect(loginRoute).toContain("signInWithPassword");
    expect(loginRoute).toContain('.from("users_profiles")');
    expect(loginRoute).toContain('.eq("id", data.user.id)');
    expect(loginRoute).toContain('!profile?.is_active');
    expect(loginRoute).toContain('profile.platform_role !== "it_admin"');
    expect(loginRoute).not.toContain("getPrimarySupabaseServiceClient");
    expect(loginRoute).toContain("signOut()");
    expect(supabaseServer).toContain('"CPIPOS_SUPABASE_URL"');
    expect(supabaseServer).toContain('"CPIPOS_SUPABASE_PUBLISHABLE_KEY"');
  });

  it("keeps IT admin auth session independent from POS branch membership", () => {
    expect(authContext).toContain('.from("users_profiles")');
    expect(authContext).toContain('.eq("id", context.userId)');
    expect(authContext).toContain('context.platformRole !== "it_admin"');
    expect(authContext).toContain("requireBranchScope ||");
    expect(authContext).not.toContain("async function loadPlatformRole");
  });

  it("keeps non-secret routing defaults in source and validates privileged credentials at runtime", () => {
    expect(envModule).toContain('CPIPOS_SUPABASE_URL: "https://deejlitaivfnsbwqdugy.supabase.co"');
    expect(envModule).toContain('CPIPOS_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_');
    expect(envModule).toContain('IT_SUPABASE_URL: "https://kawenyvpentwgugtzqec.supabase.co"');

    expect(nextConfig).not.toContain('process.env.VERCEL === "1"');
    expect(nextConfig).not.toContain('"SUPABASE_SERVICE_ROLE_KEY"');
    expect(nextConfig).not.toContain('"IT_SUPABASE_SERVICE_ROLE_KEY"');
    expect(nextConfig).not.toContain("Missing required CpIPOS IT Admin Vercel environment variables");

    for (const envName of [
      "CPIPOS_SUPABASE_URL",
      "CPIPOS_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "IT_SUPABASE_URL",
      "IT_SUPABASE_SERVICE_ROLE_KEY"
    ]) {
      expect(healthRoute).toContain(`"${envName}"`);
    }
  });

  it("keeps IT device commands aligned with the live POS production command surface", () => {
    for (const command of [
      "request_diagnostics_bundle",
      "reload_ui",
      "clear_print_queue",
      "restart_local_bridge",
      "refresh_config",
      "disable_device",
      "enable_device",
      "test_printer"
    ]) {
      expect(deviceCommands).toContain(`"${command}"`);
    }

    for (const removedCommand of ["request_diagnostics", "restart_app", "test_network", "restart_print_service", "check_update"]) {
      expect(deviceCommands).not.toContain(`"${removedCommand}"`);
    }
  });

  it("does not return raw internal database errors to API callers", () => {
    expect(itAdminGuard).toContain('fail("it_admin_internal_error", "Internal server error.", 500)');
    expect(itAdminGuard).not.toContain('error instanceof Error ? error.message : "Internal server error."');
  });
});