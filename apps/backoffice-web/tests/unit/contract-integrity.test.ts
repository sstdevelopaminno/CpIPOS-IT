import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCurrentSubscriptionContract, summarizeContractIntegrity } from "../../src/lib/contract-integrity";

const now = Date.parse("2026-10-21T12:00:00.000Z");

describe("safe IT contract overlap preflight", () => {
  it("detects the verified three-contract CUSTOM×2 + Growth pattern", () => {
    const rows = [
      { id: "custom-1", status: "active", started_at: "2026-10-14T10:18:30Z", ended_at: null },
      { id: "custom-2", status: "active", started_at: "2026-10-18T17:04:28Z", ended_at: null },
      { id: "growth", status: "active", started_at: "2026-10-18T17:05:01Z", ended_at: null }
    ];
    expect(summarizeContractIntegrity(rows, now)).toEqual({
      effective_contract_count: 3, has_conflict: true, has_invalid_dates: false
    });
  });

  it("ignores cancelled, expired and future-start contracts but never silently drops malformed dates", () => {
    const rows = [
      { id: "cancelled", status: "cancelled", started_at: null, ended_at: null },
      { id: "expired", status: "active", started_at: null, ended_at: "2026-10-20T00:00:00Z" },
      { id: "future", status: "trial", started_at: "2026-10-22T00:00:00Z", ended_at: null },
      { id: "live", status: "active", started_at: "2026-10-01T00:00:00Z", ended_at: null }
    ];
    expect(summarizeContractIntegrity(rows, now)).toEqual({
      effective_contract_count: 1, has_conflict: false, has_invalid_dates: false
    });
    expect(isCurrentSubscriptionContract(
      { id: "bad", status: "active", started_at: "invalid-date", ended_at: null }, now)).toBe(true);
    expect(summarizeContractIntegrity([
      { id: "bad", status: "active", started_at: "invalid-date", ended_at: null }
    ], now).has_invalid_dates).toBe(true);
  });

  it("scopes both GET and PATCH checks to tenant ID and rejects ambiguous writes", () => {
    const src = readFileSync(
      new URL("../../src/app/api/it-admin/admin/tenants/[tenantId]/contract/route.ts", import.meta.url), "utf8");
    expect(src.match(/\.select\(CONTRACT_INTEGRITY_SELECT\)/g)?.length).toBe(2);
    expect(src).toContain('.in("status", ["active", "trial"])');
    expect(src).toContain("contract_integrity: summarizeContractIntegrity(integrityRows ?? [])");
    expect(src).toContain("integrity.has_conflict || integrity.has_invalid_dates");
    expect(src).toContain('"contract_transition_requires_review"');
    expect(src).toContain('row.id !== latestContract?.id');
    expect(src).toContain('"contract_integrity_conflict"');
  });
});
