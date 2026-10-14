import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isCurrentSubscriptionContract,
  summarizeContractIntegrity,
} from "../../src/lib/contract-integrity";

const now = Date.parse("2026-10-14T14:00:00.000Z");

describe("IT contract integrity preflight", () => {
  it("detects QA-style overlapping CUSTOM and Growth contracts without altering them", () => {
    const contracts = [
      { id: "custom-new", status: "active", ended_at: null },
      { id: "custom-old", status: "active", ended_at: null },
      { id: "growth", status: "active", ended_at: "2026-11-06T00:00:00.000Z" },
    ];
    const snapshot = contracts.map((contract) => ({ ...contract }));
    expect(summarizeContractIntegrity(contracts, now)).toEqual({
      effective_contract_count: 3,
      has_conflict: true,
    });
    expect(contracts).toEqual(snapshot);
  });

  it("does not treat terminated, cancelled, or suspended history as a live overlap", () => {
    expect(summarizeContractIntegrity([
      { id: "expired", status: "active", ended_at: "2026-10-10T00:00:00.000Z" },
      { id: "cancelled", status: "cancelled", ended_at: null },
      { id: "suspended", status: "suspended", ended_at: null },
      { id: "current", status: "trial", ended_at: "2026-10-20T00:00:00.000Z" },
    ], now)).toEqual({ effective_contract_count: 1, has_conflict: false });
  });

  it("fails safe when a live contract has a malformed expiry", () => {
    expect(isCurrentSubscriptionContract(
      { id: "bad-date", status: "active", ended_at: "not-a-date" }, now
    )).toBe(true);
  });

  it("blocks legacy QA package INSERT while a contract is effective and shows an IT warning", () => {
    const service = readFileSync(
      new URL("../../src/lib/services/it-admin/tenant-control-service.ts", import.meta.url), "utf8"
    );
    const ui = readFileSync(
      new URL("../../src/components/it-admin/tenant-control-center.tsx", import.meta.url), "utf8"
    );
    expect(service).toContain("async function loadContractIntegrity(");
    expect(service).toContain("contract_integrity: contractIntegrity");
    expect(service).toContain("if ((await loadContractIntegrity(context, tenantId)).has_conflict)");
    expect(service).toContain("if (contractIntegrity.effective_contract_count > 0)");
    expect(service).toContain('"qa_package_transition_required"');
    expect(ui).toContain("data?.contract_integrity?.has_conflict");
    expect(ui).toContain("ระงับการแก้รอบสัญญา");
    expect(ui).toContain("(data.contract_integrity?.effective_contract_count ?? 0) > 0");
  });

  it("scopes both IT GET and PATCH overlap checks to the requested tenant and blocks edits", () => {
    const route = readFileSync(
      new URL("../../src/app/api/it-admin/admin/tenants/[tenantId]/contract/route.ts", import.meta.url),
      "utf8"
    );
    expect(route.match(/\.select\(CONTRACT_INTEGRITY_SELECT\)/g)).toHaveLength(2);
    expect(route.match(/\.eq\("tenant_id", tenantId\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(route).toContain('.in("status", ["active", "trial"])');
    expect(route).toContain("contract_integrity: summarizeContractIntegrity(integrityRows ?? [])");
    expect(route).toContain('"contract_integrity_conflict"');
    expect(route).toContain("if (summarizeContractIntegrity(integrityRows ?? []).has_conflict)");
    expect(route).toContain("409");
  });
});
