# CpIPOS IT ↔ POS Finance integration (2026-11-16)

## Canonical database contract
- Both repositories use `tenant_pos_menu_policies`, keyed by tenant ID and
  canonical menu key. `main.finance` is a new main-menu navigation policy key.
- IT shows effective Finance entitlement derived from latest tenant contract,
  subscription package code, and authoritative paid-grace runtime.
- Business and CUSTOM only. No IT toggle or internal QA mode may grant Finance
  to Starter or Growth. IT controls are navigation switches, not permissions.
- CUSTOM Finance is included in the tier without a new IT explicit-allow row,
  but a deliberate IT "off" blocks navigation. Normal CUSTOM children retain
  the prior explicit-allow behavior.

## Accountant role
- IT "ผู้ใช้งาน / สิทธิ์ POS" now offers an explicit Accountant branch role,
  numeric employee code and existing bcrypt PIN. The user can check "all active
  branches" to bulk-assign Accountant within exactly one tenant.
- The all-branch grant path refuses to overwrite existing Owner or Manager
  assignments for that user in the selected tenant. Use a separate accountant
  account instead; this is intentional least-privilege.
- It may replace Staff grants if the operator explicitly chooses Accountant +
  all branches. Every change is still made within authorized IT operations.
- Finance login on POS verifies Accountant role on **every active branch**
  belonging to this tenant. Newly added branches require a role update first.
- Personal finance routes use a separate signed Finance cookie, not a cashier
  session. No branch selection, POS device, or shift is required.

## Fixed Accountant navigation
- Main: Finance, More, Settings, Package Payment
- More: Sales Summary, Receipt History, Tax Invoices, Stock Management, Product Sales
- Settings: all POS settings except Users (`settings.users`).
- Never show Sales, Sales List, Kitchen, Shift, Users or other More entries.
- The IT tenant navigation lock may only narrow the Accountant allowlist.

## Current delivery / release gate
- **Navigation and role provisioning only.** Accountant's More/Settings/Package
  routes are protected scaffolds which explicitly state they are not yet
  connected to real accounting, tax, stock mutation, receipts, payments,
  or POS settings APIs.
- Never create a branch-scoped cashier session as a substitute to enable those
  screens. Next phase must add tenant-scoped, appropriately authorized API
  handlers for each requested action with audit logging and safe write rules.
- No production schema changes, tenant role writes, package modifications,
  IT settings modifications, deployment or merge performed in these draft PRs.
- Coordinate IT PR #211 and POS PR #477. Run both CI suites and verify
  Browser/Windows/Android UAT on dedicated test tenant before release.
