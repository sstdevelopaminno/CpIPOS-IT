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

Vercel usage is cost-sensitive. Batch related UI/API work on one branch and move the branch ref only when the batch is ready for CI/Preview. Target roughly one final Preview + one Production deployment for a meaningful batch.

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
- Historical project ID: `prj_9jNjDHyctinDjnvCZ2Ya1zBJs38h`
- Team ID: `team_ZKmv6uQSU9QUyP08mxAr2YDI`
- Direct Vercel connector visibility may return 403/404; GitHub `Vercel` exact-commit status remains the release gate.
- Never create another Vercel project as a workaround.

## Current Production before PR #21

- CpIPOS-IT main: `35c418788ac901a24986f8a603aa6d45243954f4`.
- PR #20 is the current Production Dashboard bridge/readability release.
- GitHub Vercel status for `35c41878...` is success.
- CpiPOS-001 and CpiPOS-002 were live-verified `ACTIVE_HEALTHY` on 2026-08-29.

## PR #21 — all-menu Control Plane foundation

Branch: `feature/all-it-modules-connected-20260829`.

Purpose:
- every Sidebar menu has a real route;
- read-heavy pages use authenticated read-only Control Plane bridges rather than page-level Vercel service-role clients;
- module failures render inline retry/degraded UI instead of taking down the entire portal;
- Store Provisioning keeps its existing privileged mutation authority/audit flow;
- Devices/MDM remains read-only in this foundation and mutation-rich behavior must reuse PR #5/#6.

Shared module API:
- `GET /api/it-admin/v1/modules/[module]`
- authenticates current CpiPOS-001 IT Admin session;
- obtains the user access token server-side only;
- selects the correct data plane server-side;
- forwards the user bearer to the proper Supabase Edge Function;
- returns curated rows/summaries only;
- no service key, access token, PIN hash, raw Android metadata, or audit before/after payload is returned.

Primary bridge:
- CpiPOS-001 Edge Function `cpipos-it-module-primary`
- function ID `2131ca5c-5075-4c12-9a01-df1bf866e173`
- current live version before tenant-detail enrichment: 2

Operational bridge:
- CpiPOS-002 Edge Function `cpipos-it-module-operational`
- function ID `8ef11659-0aa4-4c09-97f8-7813865314b9`
- current live version: 1

Connected menu routes:
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

## POS login route separation

`/login/store` is not an IT Control Plane route. A user screenshot on `cp-ipos-it-web.vercel.app/login/store` correctly produced 404 because the IT Vercel app does not own the POS store-login route.

Rules:
- do not create a duplicate POS login flow inside CpIPOS-IT;
- do not guess a POS domain;
- no IT menu/button should point to `/login/store` on the IT domain;
- if a future Tenant action needs “Open POS”, resolve the existing POS URL from an approved server-side config/contract only.

Repository search on 2026-08-29 found no `/login/store` reference in CpIPOS-IT.

## Tenants / Stores — first detail pass

This is the first menu being polished after the all-menu foundation.

The dedicated `TenantDirectoryConsole` replaces the generic module table for `/it-admin/tenants` and must remain read-only until an explicit mutation contract is designed.

UI requirements implemented in this pass:
- larger Production-grade Desktop/Tablet typography;
- header with `เปิดร้านใหม่` and refresh actions;
- summary cards for total/active/inactive stores, branches, and registered devices;
- search by store name, Store Code, internal code, or package;
- active/inactive filter;
- responsive table;
- detail modal for Store Code, internal code, package, branch count, device registry count, store status, and last update;
- links from the detail modal to Branches and Devices/MDM menus;
- explicit note that registry state is not Online/Health telemetry;
- loading, empty, error, retry, and refresh states;
- no `/login/store` link in the IT Tenant UI.

Current Tenant data is served by the authenticated CpiPOS-001 module bridge and is real Production control-plane data, not hard-coded test numbers.

Existing CpiPOS-001 authority discovered and preferred for later Tenant enrichment:
- `public.it_admin_tenant_summary_v` already exists with `security_invoker=true` and exposes tenant/package/contract/branch/device/session/shift summary fields.
- Do not create a replacement tenant-summary schema/view unless the existing authority cannot satisfy a documented requirement.
- Live read-only verification on 2026-08-29 showed 4 tenants: 3 active and 1 inactive. This is a diagnostic snapshot only; UI must query runtime values.

Future Tenant detail enrichment should reuse existing authority to add package/contract and quota/runtime details rather than invent new tables.

## Dashboard Control Plane

Dashboard uses authenticated read-only bridges:
- CpiPOS-001 `cpipos-it-dashboard-primary`, function ID `3c058166-11d6-4045-965e-e14c9bc37612`.
- CpiPOS-002 `cpipos-it-dashboard-operational`, function ID `498c99d5-2edb-4602-b7dd-8a4e3eac321b`.

Real-data semantics:
- store open/closed = CpiPOS-001 `tenants.is_active`;
- store online = CpiPOS-002 `it_devices.last_seen_at` within the configured window;
- registry Active must never be presented as Online/Healthy without telemetry;
- database row totals may be approximate PostgreSQL live statistics and must be labelled accordingly.

## Store Provisioning

Store Provisioning P0 is installed and remains the only approved create-store mutation path.
- opening/smoke-testing the page must never create a Production tenant;
- final submit creates persistent control-plane records and requires explicit user approval;
- mutation stays server-side, service-role protected, and audited.

## Phase 3 — Devices / MDM

Reuse existing PRs after the read-only navigation/Tenants foundation is accepted:
- PR #5 — Device Enrollment / MDM support console.
- PR #6 — telemetry / pairing / command ACK bridge.

Do not create a second MDM implementation. Real telemetry only.

## Immediate next action

1. Verify exact PR #21 head before moving it; do not overwrite concurrent work.
2. Validate the Tenants detail pass with Typecheck → Lint → Test → Production Build and exact-head Vercel Preview.
3. Authenticated-smoke `/it-admin/tenants`: real data, search, status filter, detail modal, refresh/error handling, and no full-page server crash.
4. Confirm `/login/store` remains outside the IT app and no Tenant action points to the IT-domain `/login/store` path.
5. Keep Tenant mutations read-only in this pass; do not reset/modify FF0001 or other Production tenants for smoke testing.
6. PR #21 is still Draft due a GitHub connector Ready-for-review bug. Do not bypass the Draft gate with force/direct-main changes. When Ready is available, merge only the exact validated head.
7. After the Tenants menu is accepted, polish the next menu: Branches, reusing the existing CpiPOS-001 branch authority and module bridge.
