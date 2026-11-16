# IT Package / Contract review — 2026-11-16

## Verified problem
The primary Store Control Center's `change_package` command is gated by
`getItQaMode`, and intentionally issues a zero-value simulated contract only
for internal IT test stores. Ordinary customers in `trial` cannot use it.

The main `prepare_paid_package` action is payment-evidence and settlement
driven. That guard is required for paid activation and must never be relaxed.
The legacy contract API allowed a dangerous alternative: changing the plan
while simultaneously downgrading a paid `active` contract to `trial`.
It now rejects such requests.

## Live CpiPOS-001 read-only audit
As of 2026-11-16, latest contracts: 5 Trial, 4 Active;
22 contract history rows across 9 tenants. Contract-package pointers matched
in all 9. No live customers were changed by the review.

## New unpaid trial workflow
IT Store Control Center → แพ็กเกจและสิทธิ์ →
**เปลี่ยนแพ็กเกจระหว่างทดลองใช้**

- Available to verified IT Admin/Support under existing privileged endpoint.
- Ordinary Trial plans may be revised repeatedly, without creating a new
  competing active contract or modifying trial start/end dates.
- Requires selecting a different active package and entering a reason (Audit).
- Blocks concurrent plan modification, multiple effective contracts, prepaid
  plans waiting for activation, unsettled payment requests and receipts that
  were issued during the current Trial period.
- Preserves paid transaction evidence, status `trial`, trial dates, lifecycle
  and subscription payment history; recalculates package quotations and quotas.
- Clears old package-specific sales mode overrides so old settings do not
  accidentally elevate access in the new plan.
- CUSTOM requires prior IT-approved custom terms and compatible yearly pricing.
- Updates `tenant_subscription_contracts` and `tenants.package_id` with
  optimistic checks and an attempted compensating contract restore if the second
  write fails. A failed rollback triggers an urgent reconciliation error.
  A future database-transaction RPC should replace this two-write flow.

## Contract edit access
- Non-prepaid Trial and paid Active/Expired contract **service dates** remain
  editable via the audited contract-period workflow.
- Prepaid trial awaiting activation remains intentionally protected: changing
  its dates could incorrectly rewrite already-purchased service entitlement.
- Cancelled contracts cannot be mutated as active grants; use authorized
  reactivation/new payment flow instead of altering historical paid evidence.
- Existing first-paid or upgrade activation remains guarded by confirmed bank
  settlement; a mere plan selector cannot create an official receipt.

## Release
- Change is in GitHub branch/PR only until CI and authorized UAT complete.
- Do not run ad hoc tenant SQL updates or alter customer financial records.
- Do not deploy IT without confirming project/permissions and coordinating POS
  package-entitlement behavior.
