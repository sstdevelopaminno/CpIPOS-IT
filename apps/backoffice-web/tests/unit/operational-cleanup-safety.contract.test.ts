import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("../../supabase/migrations/20261011104500_operational_cleanup_all_safeupdate_guard.sql");
const route = read("src/app/api/it-admin/v1/maintenance/cleanup/route.ts");

describe("operational cleanup safe-update guard", () => {
  it("does not use unqualified DELETE even with an explicit full-delete confirmation", () => {
    const fullCleanupTables = [
      "audit_logs",
      "pos_device_health_snapshots",
      "table_management_perf_events",
      "login_attempts",
      "printer_device_history",
      "pos_device_incidents",
      "it_manual_incidents"
    ];
    for (const table of fullCleanupTables) {
      expect(migration).toContain(`delete from public.${table} where id is not null;`);
    }
    expect(migration).not.toMatch(/delete from public\.[a-z_]+\s*;/i);
    expect(migration).toMatch(/create or replace function public\.it_run_operational_cleanup_7d/i);
  });

  it("preserves the 7-day window, active print jobs and the persistent cleanup ledger", () => {
    expect(migration).toContain("Asia/Bangkok");
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain("where created_at < v_cutoff");
    expect(migration).toContain("j.status::text not in ('printed','failed')");
    expect(migration).toContain("insert into public.it_data_cleanup_runs");
    expect(migration).not.toMatch(/delete from public\.it_data_cleanup_runs/i);
    expect(migration).not.toMatch(/delete from public\.pos_device_health_latest/i);
  });

  it("keeps delete confirmation and reports the SQL safety guard without retrying a write", () => {
    expect(route).toContain('confirmation !== "DELETE"');
    expect(route).toContain('confirmation !== "CLEANUP_7D"');
    expect(route).toContain("assertItSupportAction");
    expect(route).toContain("Mutating RPC: never retry automatically");
    expect(route).toContain('"cleanup_safety_migration_required"');
    expect(route).toContain('dbCode === "21000"');
    expect(route).toContain("Cleanup Ledger");
  });
});
