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
- Historical project ID recorded by GitHub/Vercel integration: `prj_9jNjDHyctinDjnvCZ2Ya1zBJs38h`
- Team ID: `team_ZKmv6uQSU9QUyP08mxAr2YDI`

Do not create another project. The live Vercel connector currently does not enumerate `cp-ipos-it-web` and direct project/runtime-log requests can return 403/404, while GitHub's `Vercel` commit status continues to report Preview/Production successfully. Use exact-head GitHub Vercel status as the release gate until connector visibility is restored; never create a replacement project to work around this.

## Current CpIPOS-IT main before the Dashboard readability/live-bridge batch

- main SHA: `4ff81c82577910f7e19aa78827c43fd53aacaf30`.
- PR #19 merged: live Control Plane Dashboard foundation + corrected CpIPOS Sidebar symbol.
- GitHub Vercel Production status for `4ff81c82...`: success.
- User-authenticated Production screenshot after PR #19 showed the Dashboard UI rendering, but most live metric values were `—`, both database panels reported metric failures, and API/Control Plane showed `0/2`.
- The failure pattern was consistent with the Dashboard depending on privileged Vercel runtime service-role credentials even though IT login itself no longer depends on those credentials.

## Sidebar branding

The expanded Sidebar uses the existing CpIPOS symbol asset:
- `/brand/cpipos-symbol-sidebar.png`

Do not use the SST iPOS wordmark in the IT Sidebar header. The symbol is centered above `IT Control Plane` and the company-backoffice subtitle. Collapsed mode uses the same symbol only.

## Phase 2 Store Provisioning

Store Provisioning P0 is on CpIPOS-IT main from PR #4. The CpiPOS-001 provisioning schema authority is installed. Do not create a real Production tenant merely to smoke test; final submit requires explicit approval because it creates persistent customer/control-plane records.

## Dashboard Control Plane

Goal: one compact Dashboard that reads real Control Plane aggregates, remains fail-soft per data plane, uses readable Desktop/Tablet typography, and keeps deeper detail inside modal dialogs rather than creating a long page.

### Server contract

`GET /api/it-admin/v1/dashboard`

- authenticates the current CpiPOS-001 IT Admin session first;
- retrieves the current access token only inside the server route and never returns it to the browser;
- forwards the token to two read-only Supabase Edge Function bridges;
- each bridge independently validates the CpiPOS-001 user and requires `users_profiles.is_active=true` plus `platform_role=it_admin` before privileged aggregate reads;
- CpiPOS-001 bridge reads business/control aggregates only;
- CpiPOS-002 bridge reads IT/MDM operational aggregates only;
- service/secret keys stay inside each Supabase Edge Function runtime and are never moved into browser code or committed source;
- bridge calls use only public project URLs/publishable keys from the IT server plus the authenticated user bearer token;
- each plane remains fail-soft, so one degraded plane does not turn the whole Dashboard into a generic 500;
- no customer business row contents or secrets are returned.

### Supabase read-only Dashboard bridges

CpiPOS-001:
- Edge Function: `cpipos-it-dashboard-primary`
- live function ID: `3c058166-11d6-4045-965e-e14c9bc37612`
- live version at this handoff: `1`
- validates CpiPOS-001 bearer via `auth.getUser`, then checks active IT Admin profile with the project admin client.
- returns aggregate store counts, database metrics RPC output, and recent POS API-error aggregates.

CpiPOS-002:
- Edge Function: `cpipos-it-dashboard-operational`
- live function ID: `498c99d5-2edb-4602-b7dd-8a4e3eac321b`
- live version at this handoff: `2`
- validates the CpiPOS-001 bearer against CpiPOS-001 and always reads the caller's `users_profiles` row under authenticated RLS; app metadata alone is not sufficient.
- requires `is_active=true` and `platform_role=it_admin`, then uses the CpiPOS-002 built-in backend key for aggregate IT reads.
- returns device/online-store aggregates, incident/command counts, and database metrics RPC output.

Both functions currently use `verify_jwt=false` because CpiPOS-002 cannot natively verify the CpiPOS-001 JWT and the functions implement explicit custom authorization. Missing/invalid bearer returns unauthorized/forbidden before aggregate data is read. Function source is versioned under `supabase/control-plane-functions/` in the IT repo. No writes are performed.

### Dashboard UI readability/layout

- Remove the large bordered `ภาพรวมระบบ` hero/header card.
- Use a compact plain header directly above the metric cards.
- Title/subtitle stay on the left; live status/update time and actions stay on the right.
- Move `จัดการร้านค้า`, `Monitoring`, and `รีเฟรช` into the top header action row; remove the duplicate bottom quick-action strip.
- Increase primary metric labels/numbers/supporting text, panel headings/descriptions, storage labels, API status text, donut/legend labels, and modal typography.
- Preserve the compact overall page height; larger type should not become a long full-page report.

### Dashboard main surface

Compact cards/panels show:
- total/open/closed/online stores;
- online devices;
- approximate total rows and table count;
- CpiPOS-001 used + remaining database capacity;
- CpiPOS-002 used + remaining database capacity;
- Control Plane bridge connectivity/response measurements;
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
- Current Supabase organization was live-verified as Free plan. Runtime quota display uses the current Free database quota baseline of 500 MiB/project; if the plan changes, update the quota source rather than pretending the quota is dynamically discovered by SQL.

### Live baseline measured during the first Dashboard batch

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
1. Verify exact live CpIPOS-IT main SHA and GitHub Vercel Production status.
2. Authenticated smoke `/it-admin` and confirm real values populate instead of `—` for both Control Plane bridges.
3. Confirm current live store totals/open/closed, online telemetry, rows/tables, and CpiPOS-001/CpiPOS-002 storage are queried at runtime rather than copied from the baseline snapshot.
4. Confirm top Dashboard area is no longer a bordered hero card, typography is readable on Desktop/Tablet, and `จัดการร้านค้า / Monitoring / รีเฟรช` are in the compact top action row.
5. Open each detail modal; confirm no access token, service key, raw secret, or customer business row content is displayed.
6. Check CpiPOS-001/CpiPOS-002 Edge Function logs for authorization/query failures if either plane remains degraded.
7. Do not create a store or synthetic telemetry for smoke testing.
8. If Dashboard Production smoke is green, proceed to Phase 3 by inspecting/refreshing existing PR #5 and PR #6 on top of current main, batching changes before the next Preview/Production cycle.
