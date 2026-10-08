import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../../supabase/migrations/20261009093000_settlement_reuse_canonical_open_billing_cycle.sql"),
  "utf8"
);
const settleApi = readFileSync(
  resolve(process.cwd(), "src/app/api/it-admin/v1/subscription-payments/settle/[requestId]/route.ts"),
  "utf8"
);

describe("subscription settlement must reuse the canonical open billing cycle", () => {
  it("recognizes an existing open-cycle request without a billing_cycle_id in metadata", () => {
    expect(migration).toContain("select public.subscription_billing_due_state(v_req.tenant_id) into v_canonical_due");
    expect(migration).toContain("v_canonical_due->>'open_request_id' = v_req.id::text");
    expect(migration).toContain("id=(v_canonical_due->>'billing_cycle_id')::uuid");
    expect(migration).toContain("and tenant_id=v_req.tenant_id");
    expect(migration).toContain("and package_id=v_package.id");
    expect(migration).toContain("and status='open'");
    expect(migration).toContain("and period_start=(v_canonical_due->>'next_period_start')::date");
    expect(migration).toContain("and period_end=(v_canonical_due->>'next_period_end')::date");
    expect(migration).toContain("for update;");
    expect(migration).toContain("raise exception 'billing_cycle_not_payable'");
  });

  it("preserves bank-amount verification, single-cycle update and settlement idempotency", () => {
    expect(migration).toContain("if found then");
    expect(migration).toContain("'already_settled', true");
    expect(migration).toContain("if round(p_amount_received::numeric,2) <> round(v_expected::numeric,2)");
    expect(migration).toContain("if v_requested_cycle.id is not null then");
    expect(migration).toContain("update public.tenant_billing_cycles");
    expect(migration).toContain("where id=v_requested_cycle.id");
    expect(migration).toContain("if coalesce(v_req.metadata->>'kind','') <> 'payment_notice' then");
    expect(migration).toContain("insert into public.tenant_subscription_receipts");
  });

  it("reports non-payable and mismatched cycles as actionable conflicts", () => {
    expect(settleApi).toContain("billing_cycle_not_payable:");
    expect(settleApi).toContain("billing_cycle_not_found:");
    expect(settleApi).toContain("billing_cycle_package_mismatch:");
    expect(settleApi).toContain("billing_cycle_already_paid:");
    expect(settleApi).toContain('confirmed_bank_receipt !== true');
  });
});
