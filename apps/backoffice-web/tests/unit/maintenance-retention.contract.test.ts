import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("operational retention controls", () => {
  const route = src("src/app/api/it-admin/v1/maintenance/cleanup/route.ts");
  const controls = src("src/components/it-admin/it-data-cleanup-controls.tsx");
  const monitor = src("src/components/it-admin/it-admin-monitoring-console.tsx");
  const incidents = src("src/components/it-admin/it-admin-incidents-console.tsx");
  const audit = src("src/components/it-admin/it-admin-audit-console.tsx");
  const printer = src("src/components/it-admin/it-admin-printer-console.tsx");
  const migration = src("../../supabase/migrations/20261003092534_retention_v2_bangkok_and_operational_cleanup.sql");
  const printSafety = src("../../supabase/migrations/20261003093413_operational_cleanup_preserve_active_print_attempts.sql");
  const overviewRoute = src("src/app/api/it-admin/v1/maintenance/overview/route.ts");
  const maintenanceConsole = src("src/components/it-admin/it-maintenance-console.tsx");
  const layout = src("src/app/(it-admin)/layout.tsx");
  const overviewMigration = src("../../supabase/migrations/20261003102908_it_retention_maintenance_overview.sql");

  it("requires IT Support and explicit destructive confirmation", () => {
    expect(route).toContain("assertItSupportAction");
    expect(route).toContain('confirmation !== "DELETE"');
    expect(route).toContain('confirmation !== "CLEANUP_7D"');
    expect(route).toContain("it_run_operational_cleanup_7d");
  });

  it("keeps four independent cleanup scopes in the connected IT screens", () => {
    expect(monitor).toContain('scope="monitoring"');
    expect(incidents).toContain('scope="incidents"');
    expect(audit).toContain('scope="audit"');
    expect(printer).toContain('scope="print_history"');
    expect(controls).toContain('mode: "expired" | "all"');
  });

  it("runs the policy on Bangkok time and never deletes current device state", () => {
    expect(migration).toContain("Asia/Bangkok");
    expect(migration).toContain("'0 17 * * *'");
    expect(migration).toContain("'10 17 * * *'");
    expect(migration).not.toContain("delete from public.pos_device_health_latest");
  });

  it("preserves active/retrying print jobs and attempts", () => {
    expect(printSafety).toContain("status::text not in ('printed','failed')");
    expect(printSafety).toContain("status::text in ('printed','failed')");
  });

  it("does not call cleanup when there are zero expired rows and retries transient timeouts", () => {
    expect(controls).toContain("total === 0");
    expect(controls).toContain("nothingExpired");
    expect(route).toContain("runRpcWithRetry");
    expect(route).toContain("cleanup_database_temporarily_unavailable");
  });

  it("provides one central maintenance view for cron, packages, sales retention and cleanup history", () => {
    expect(layout).toContain("/it-admin/maintenance");
    expect(maintenanceConsole).toContain("Operational Retention");
    expect(maintenanceConsole).toContain("Sales Retention");
    expect(overviewRoute).toContain("it_retention_maintenance_overview");
    expect(overviewRoute).toContain("it_invoke_sales_retention_worker");
    expect(overviewMigration).toContain("cpipos_sales_retention_daily");
    expect(overviewMigration).toContain("cpipos_operational_retention_7d");
  });
});
