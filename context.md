# CpIPOS IT Admin / IT Control Plane — Current Handoff Context

Last updated: 2026-08-29 (ICT)

## Mandatory workflow

Before answering or changing code:
1. Read this `context.md` from `sstdevelopaminno/CpIPOS-IT` branch `main` first.
2. Verify live GitHub state for CpIPOS-IT.
3. Verify the existing Vercel project/deployment. Never create a replacement Vercel project.
4. Verify only the Supabase state needed for the task.
5. Continue from **Immediate next action** below.
6. Change only relevant files; no broad refactor.
7. Run Typecheck → Lint → Test → Production Build.
8. Require exact-head CI + Vercel Preview before merge.
9. After merge, verify Vercel Production on the exact merge commit.
10. Keep this file current.

If a task touches `sstdevelopaminno/CpIPOS` schema/runtime, read `docs/AI-GUARDRAILS-CPIPOS.md` and current CpIPOS context first, then verify live state. Do not use old-chat state when it conflicts with live sources.

## Deployment-efficiency rule

Vercel usage is cost-sensitive. Batch related UI/API work on one branch, validate as much as possible before moving the branch ref, and target roughly one final Preview + one Production deployment for a meaningful IT batch. This does not waive CI/build gates.

## Architecture boundaries

- `CpIPOS` = customer-facing POS/runtime/schema lane.
- `CpIPOS-IT` = company IT Control Plane / Backoffice.
- CpiPOS-001 `deejlitaivfnsbwqdugy` = Auth, tenant/store/branch/user/package/subscription/business authority.
- CpiPOS-002 `kawenyvpentwgugtzqec` = IT/MDM operational data: device registry/health/incidents/commands.
- Browser/device code never receives service-role credentials.
- Privileged IT operations stay server-side and important mutations require audit trail.
- Client code never chooses the Supabase project.
- Never reset FF0001, fabricate telemetry, or rewrite/delete customer order/payment/transaction history.
- Never mix IT feature development into a POS Production release.

## Existing Vercel project only

- Project: `cp-ipos-it-web`
- Project ID: `prj_9jNjDHyctinDjnvCZ2Ya1zBJs38h`
- Team ID: `team_ZKmv6uQSU9QUyP08mxAr2YDI`

Do not create another project. Vercel direct runtime-log API may return 403 while GitHub Vercel status checks still work.

## Current CpIPOS-IT main before this Dashboard batch

- main SHA before batch: `d6db9a304326e2cf2f52d26662a6b4c86563a84b`
- PR #18 merged: collapsible Sidebar, hidden scrollbar, larger navigation.
- Vercel Production for `d6db9a30...`: success.
- Authenticated Dashboard was still user-confirmed to show `Internal server error` after PR #18.

## Sidebar branding correction in current Dashboard batch

The expanded Sidebar must use the existing CpIPOS symbol asset:
- `/brand/cpipos-symbol-sidebar.png`

Do not use the SST iPOS wordmark in the IT Sidebar header. The symbol is centered above `IT Control Plane` and the company-backoffice subtitle. Collapsed mode continues to show the same symbol only.

## Phase 2 Store Provisioning

Store Provisioning P0 is on CpIPOS-IT main from PR #4. The CpiPOS-001 provisioning schema authority is installed. Do not create a real Production tenant merely to smoke test; final submit requires explicit approval because it creates persistent customer/control-plane records.

## Dashboard Control Plane batch

Goal: replace the fragile three-request Dashboard fan-out with one fail-soft IT endpoint and show real compact Control Plane metrics, with detail moved into modal dialogs instead of a long page.

### New server contract

`GET /api/it-admin/v1/dashboard`

- authenticates IT admin first;
- CpiPOS-001 queries always use the explicit Primary authority client, not tenant business-data routing;
- CpiPOS-002 uses the existing IT Control Plane client;
- each metric source is isolated/fail-soft, so one degraded plane does not turn the entire Dashboard into a generic 500;
- no secrets are returned;
- no customer business row contents are returned by database diagnostics.

### Dashboard main surface

Compact cards/panels show:
- total/open/closed/online stores;
- online devices;
- approximate total rows and table count;
- CpiPOS-001 used + remaining database capacity;
- CpiPOS-002 used + remaining database capacity;
- Control Plane API connectivity/response measurements;
- API errors in the recent 60-minute window;
- open/critical incidents and pending remote commands.

Details open in modal dialogs:
- store/online definition and latest device seen;
- row/table detail;
- database connection counts and largest tables by size;
- API error/top-route/degraded-source details.

### Real-data semantics

- Store open/closed = CpiPOS-001 `tenants.is_active`.
- Store online = at least one CpiPOS-002 `it_devices.last_seen_at` inside the configured 5-minute window.
- Never convert registry `active` into online/healthy without telemetry.
- Estimated rows come from PostgreSQL live statistics (`pg_stat_user_tables.n_live_tup`) to avoid expensive `COUNT(*)` across every Production table; UI must label this as approximate.
- Database used bytes come from `pg_database_size(current_database())`.
- Current Supabase organization was live-verified as Free plan during this batch. Runtime quota display uses the current Free database quota baseline of 500 MiB/project; if the plan changes, update the quota source rather than pretending the quota is dynamically discovered by SQL.

### Live baseline measured during this batch

At approximately 2026-08-29 01:xx ICT:
- Stores: total 4, open 3, closed 1.
- CpiPOS-002 devices: 8 total.
- Stores/devices seen inside 5 minutes at that measurement: 0 / 0; this is telemetry-derived, not a fabricated health state.
- CpiPOS-001: ~119,229,587 bytes (~114 MiB), ~67,809 estimated rows, 144 user tables.
- CpiPOS-002: ~16,632,979 bytes (~15.9 MiB), ~324 estimated rows, 82 user tables.
- Open CpiPOS-002 incidents: 0; critical: 0; pending commands: 0 at measurement time.

These are a handoff snapshot only; Dashboard must query live values rather than hard-code them.

## Database metrics schema support

CpIPOS PR #159: `feat(it-schema): expose read-only database metrics to IT Control Plane`

- exact schema head: `5ca223cac50c38ca5c2f9e6cc2fcd4dde8fca5d3`
- schema/platform merge commit: `0fd41e1c94191a25569d58968702c9591ecf90c1`
- base: `agent/fg-ff-platform-normalization`, not POS Production release.
- files:
  - `supabase/migrations/20260829011500_it_database_metrics_rpc.sql`
  - `supabase/trial-data-plane/migrations/20260829011501_it_database_metrics_rpc.sql`
- function on each plane: `public.get_it_database_metrics()`
- read-only metrics only; no customer row contents; no POS/order/payment/stock mutation.
- `anon` execute = false.
- `authenticated` execute = false.
- `service_role` execute = true.
- exact-head CI run `33199179981`: Typecheck/Lint/Test/Primary schema drift/CpiPOS-002 schema drift/Build = SUCCESS.
- migrations applied successfully to CpiPOS-001 and CpiPOS-002 and privilege read-back passed.

## Phase 3 — Devices / MDM

Existing PRs to reuse after Dashboard Production acceptance:
- PR #5 — Device Enrollment / MDM support console.
- PR #6 — telemetry / pairing / command ACK bridge.

Do not create a second MDM implementation. Real telemetry only.

## Immediate next action

When this file is present on `main`:
1. Verify exact live CpIPOS-IT main SHA and Vercel Production.
2. Authenticated smoke `/it-admin` and confirm the Dashboard no longer shows the generic `Internal server error` state.
3. Verify live cards for stores, online telemetry, CpiPOS-001/CpiPOS-002 storage, rows/tables, and API plane status.
4. Open each Dashboard detail modal; confirm no secret/token/raw service credential is displayed.
5. Confirm Sidebar expanded logo is `/brand/cpipos-symbol-sidebar.png` and collapsed mode uses the same symbol.
6. Do not create a store or synthetic telemetry for smoke testing.
7. If Dashboard Production smoke is green, proceed to Phase 3 by inspecting/refreshing existing PR #5 and PR #6 on top of current main, batching changes before the next Preview/Production cycle.
