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

Do not create another project. The live Vercel connector may not enumerate `cp-ipos-it-web` and direct project/runtime-log requests can return 403/404, while GitHub's `Vercel` commit status continues to report Preview/Production successfully. Use exact-head GitHub Vercel status as the release gate until connector visibility is restored.

## Current main before the all-menu Control Plane batch

- main SHA: `35c418788ac901a24986f8a603aa6d45243954f4`.
- PR #20 merged: Dashboard readability + authenticated read-only Control Plane metric bridges.
- GitHub Vercel Production status for `35c41878...`: success.
- User-authenticated screenshot after PR #20 showed a Next/server-render failure when navigating/clicking into another IT page: `This page couldn't load · A server error occurred`.
- Live source inspection found two distinct causes:
  1. several Sidebar items were still `disabled: true` placeholders;
  2. high-traffic pages such as `Tenants / Stores` and `Store Provisioning` constructed `context.supabase` during server rendering. That getter constructs the privileged CpiPOS-001 Vercel service client, so a missing/unavailable Vercel service credential can crash the entire page before any fail-soft client UI appears.
- Existing Monitoring was client-rendered and therefore did not blank the whole page, but its API still depended directly on the same Vercel privileged CpiPOS-001 client.

## Sidebar branding

The expanded Sidebar uses the existing CpIPOS symbol asset:
- `/brand/cpipos-symbol-sidebar.png`

Do not use the SST iPOS wordmark in the IT Sidebar header. The symbol is centered above `IT Control Plane` and the company-backoffice subtitle. Collapsed mode uses the same symbol only.

## Phase 2 Store Provisioning

Store Provisioning P0 is on CpIPOS-IT main from PR #4. The CpiPOS-001 provisioning schema authority is installed. Do not create a real Production tenant merely to smoke test; final submit requires explicit approval because it creates persistent customer/control-plane records.

The Store Provisioning page may read the package catalog through the read-only Module Control Plane bridge, but actual provisioning mutations must continue through the existing provisioning authority/audit flow. Opening or smoke-testing the page must never create a store.

## Dashboard Control Plane

`GET /api/it-admin/v1/dashboard` authenticates the current CpiPOS-001 IT Admin session, obtains the access token server-side, and forwards it to two read-only Supabase Edge Function bridges. The token is never returned to the browser.

Dashboard bridges:
- CpiPOS-001 `cpipos-it-dashboard-primary`, function ID `3c058166-11d6-4045-965e-e14c9bc37612`, version 1.
- CpiPOS-002 `cpipos-it-dashboard-operational`, function ID `498c99d5-2edb-4602-b7dd-8a4e3eac321b`, version 2.

Both functions implement explicit authorization before privileged aggregate reads. CpiPOS-002 cannot natively verify a CpiPOS-001 user JWT, so its function validates the bearer against CpiPOS-001 and checks the caller's active IT Admin profile. `verify_jwt=false` on these cross-project functions is intentional only because custom authorization is implemented in function code.

Dashboard real-data semantics:
- Store open/closed = CpiPOS-001 `tenants.is_active`.
- Store online = at least one CpiPOS-002 `it_devices.last_seen_at` inside the configured 5-minute window.
- Never convert registry `active` into online/healthy without telemetry.
- Estimated rows come from PostgreSQL live statistics, not expensive full-table counts.
- Database used bytes come from `pg_database_size(current_database())`.
- Database quota UI currently uses the verified Supabase Free 500 MiB/project baseline; update the source if the plan changes.

Live reference snapshot measured during the initial Dashboard batch only; never hard-code these values:
- Stores: 4 total, 3 active, 1 inactive.
- CpiPOS-002 devices: 8 registry rows.
- CpiPOS-001 roughly 114 MiB / 67k estimated rows / 144 user tables at that measurement.
- CpiPOS-002 roughly 15.9 MiB / 324 estimated rows / 82 user tables at that measurement.

## All-menu Module Control Plane batch

Goal: every Sidebar menu opens a real IT UI instead of a disabled placeholder or server-render crash. Read-heavy menu pages use authenticated read-only Control Plane bridges and fail inside the page rather than taking down the whole portal.

### Shared IT module API

`GET /api/it-admin/v1/modules/[module]`

- requires current IT Admin authentication;
- obtains the current Supabase access token server-side only;
- verifies the session user matches the IT auth context;
- selects the correct data plane server-side;
- calls a read-only Supabase Edge Function with the user bearer + public project publishable key;
- performs one retry only for safe read-only network/502/503/504 failures;
- returns a safe 503 `it_admin_module_unavailable` instead of allowing a page-level server-render crash;
- never returns service-role/secret credentials.

Primary modules:
- `tenants`
- `branches`
- `users`
- `android`
- `printer`
- `packages`
- `entitlements`
- `monitoring`
- `audit`
- `provisioning` package-catalog read

Operational modules:
- `devices`
- `incidents`

### CpiPOS-001 Module bridge

- Edge Function: `cpipos-it-module-primary`
- live function ID: `2131ca5c-5075-4c12-9a01-df1bf866e173`
- live version at this handoff: `2`
- project: CpiPOS-001
- validates the user bearer with CpiPOS-001 Auth and requires `users_profiles.is_active=true` + `platform_role=it_admin`.
- uses the project built-in backend credential only inside the Edge Function runtime.
- returns curated read-only rows and summaries for tenants, branches, users, package catalog, feature entitlements, Android rollout compatibility fields, printer/agent state, monitoring aggregates, recent audit summaries, and the provisioning package catalog.
- never returns PIN hashes, credentials, raw Android metadata, audit before/after payloads, or raw sensitive metadata.
- Monitoring uses a 60-minute read-only view of queued/stale orders, print queue, dead letters, and API errors by active branch. It does not fabricate health.

### CpiPOS-002 Module bridge

- Edge Function: `cpipos-it-module-operational`
- live function ID: `8ef11659-0aa4-4c09-97f8-7813865314b9`
- live version at this handoff: `1`
- project: CpiPOS-002
- validates the CpiPOS-001 user bearer and active IT Admin profile before reading CpiPOS-002.
- returns curated `it_devices` registry + optional `it_device_health_latest` and recent `it_device_incidents`.
- Current live CpiPOS-002 baseline has 8 `it_devices`, but `it_device_health_latest` and `it_device_incidents` are currently empty. The UI must show `Not reported` / empty state and must not convert registry state into fake health.

Function source is versioned under:
- `supabase/control-plane-functions/cpipos-it-module-primary/index.ts`
- `supabase/control-plane-functions/cpipos-it-module-operational/index.ts`

### Connected UI / navigation contract

Sidebar routes are real hrefs, not disabled placeholders:
- `/it-admin`
- `/it-admin/tenants`
- `/it-admin/store-provisioning`
- `/it-admin/branches`
- `/it-admin/platform-users`
- `/it-admin/devices`
- `/it-admin/android`
- `/it-admin/printer`
- `/it-admin/packages`
- `/it-admin/entitlements`
- `/it-admin/monitoring`
- `/it-admin/incidents`
- `/it-admin/audit`
- `/it-admin/settings/language`

Read-only module pages use a shared `ItAdminModuleConsole`:
- readable Desktop/Tablet typography;
- source/connection line;
- summary cards;
- responsive data table;
- explicit empty state;
- inline retry/error state;
- 60-second refresh without full-page reload.

`Tenants / Stores`, `Platform Users`, `Packages`, and `Monitoring` use the shared client module surface. `Store Provisioning` loads its package catalog through the module bridge before rendering the existing provisioning form.

Add `(it-admin)/error.tsx` as a final route-segment recovery boundary. If an unrelated server component still throws, the user sees an in-app CpIPOS recovery UI + error reference + retry button instead of the generic blank `This page couldn't load` surface.

## Phase 3 — Devices / MDM

Existing PRs must be reused for mutation-rich MDM behavior after the read-only navigation batch is accepted:
- PR #5 — Device Enrollment / MDM support console.
- PR #6 — legacy telemetry / pairing / remote command ACK bridge.

Do not create a second MDM pairing/command implementation. The new `/it-admin/devices` page in the all-menu batch is intentionally a read-only operational view. Rebase/refresh PR #5/#6 onto current main for enrollment, pairing, health detail, and remote commands after this navigation foundation is green.

## Database metrics schema support

CpIPOS PR #159 exposed read-only `public.get_it_database_metrics()` on both planes.
- CpiPOS-001 and CpiPOS-002 migrations were applied and privilege read-back passed.
- `anon` execute = false.
- `authenticated` execute = false.
- trusted backend/service execution only.
- no customer row contents and no POS/order/payment/stock mutation.

## Immediate next action

When this file is present on `main` after the all-menu batch:
1. Verify exact CpIPOS-IT main SHA and GitHub Vercel Production status.
2. Authenticated-smoke every Sidebar route listed in **Connected UI / navigation contract**.
3. Confirm clicking menu items no longer produces the generic `This page couldn't load` / server-render error screen.
4. Confirm real data appears for Tenants, Branches, Users, Packages, Entitlements, Monitoring, Android, Printer, Devices, Incidents, and Audit; empty CpiPOS-002 health/incident tables must render legitimate empty/`Not reported` states.
5. Confirm Store Provisioning loads the real active package catalog, but do not submit/create a Production store for smoke testing.
6. Confirm no page/API response exposes access tokens, service keys, PIN hashes, raw Android metadata, or audit before/after payloads.
7. If a module is degraded, inspect `cpipos-it-module-primary` or `cpipos-it-module-operational` Edge Function logs and fix only that module; do not reintroduce page-level Vercel service-role reads.
8. If all-menu Production smoke is green, rebase/refresh existing PR #5 and PR #6 on current main and continue Phase 3 MDM from those implementations rather than creating a replacement.
