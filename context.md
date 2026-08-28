# CpIPOS IT Admin / IT Control Plane — Current Handoff Context

Last updated: 2026-08-29 (ICT)

## Mandatory workflow for every new session

Before answering or changing code:

1. Read this `context.md` from `sstdevelopaminno/CpIPOS-IT` branch `main` first.
2. Verify current GitHub state for `CpIPOS-IT`.
3. Verify the existing Vercel deployment state. **Never create a new Vercel project.**
4. Verify only the Supabase state needed for the task.
5. Continue from **Immediate next action** below.
6. Change only relevant files; do not broad-refactor or invent a second architecture when the existing one supports the task.
7. Run Typecheck → Lint → Test → Production Build.
8. Require exact-head GitHub CI and Vercel Preview before merge.
9. After merge, verify Vercel Production on the merged `main` commit.
10. Keep this file current so a new chat can continue without reconstructing state from old messages.

If a task touches POS/schema/runtime in `sstdevelopaminno/CpIPOS`, first read `docs/AI-GUARDRAILS-CPIPOS.md` and the current CpIPOS context/handoff, then verify that repo's live GitHub/Vercel/Supabase state before changing anything.

Do not use old-chat state when it conflicts with this file or live connected sources.

---

# Deployment-efficiency rule

Vercel usage is currently cost-sensitive. During development:

- batch related UI/API changes on one branch instead of pushing every file edit;
- validate as much as possible before moving the branch ref;
- target roughly one final Preview and one Production deployment for a large work batch;
- do not create deploys merely to inspect a small visual change;
- do not create a replacement Vercel project to solve connector visibility problems.

This is an efficiency rule, not permission to skip Typecheck/Lint/Test/Build or exact-head acceptance.

---

# Architecture boundaries

## `sstdevelopaminno/CpIPOS`
Customer-facing POS runtime, schema authority and business transactions.

## `sstdevelopaminno/CpIPOS-IT`
Company IT Control Plane / Backoffice.

## CpiPOS-001
Project ref: `deejlitaivfnsbwqdugy`

Authority for:
- Supabase Auth
- tenant / Store Code / branch / user
- package / subscription / business control-plane state
- POS business data and transactions

## CpiPOS-002
Project ref: `kawenyvpentwgugtzqec`

Operational IT/MDM plane for:
- device registry
- device health / telemetry
- incidents
- remote commands / delivered / ACK / result
- IT operational state

## Non-negotiable rules

- Browser/device code must never receive a service-role key.
- Privileged actions are server-side only.
- Important IT actions require an audit trail.
- Tenant / branch / device scope must remain correct.
- Client code must not choose CpiPOS-001 vs CpiPOS-002.
- Orders, payments, products, stock and customer transaction history stay out of CpiPOS-002.
- Never reset FF0001.
- Never fabricate device health.
- Never mix IT feature work into a POS Production release.

---

# Vercel IT project — existing project only

Existing IT project identified by GitHub/Vercel integration:

- Project: `cp-ipos-it-web`
- Project ID: `prj_9jNjDHyctinDjnvCZ2Ya1zBJs38h`
- Team ID: `team_ZKmv6uQSU9QUyP08mxAr2YDI`

The older name `cp-ipos-it-backoffice-web` is stale. Do not create another project.

The connected Vercel project/log APIs may return 403/404 even while GitHub's Vercel integration reports exact deployment status successfully. Treat this as connector visibility mismatch, not proof the project is missing.

Server environment contract names only — never expose values:

- `CPIPOS_SUPABASE_URL`
- `CPIPOS_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `IT_SUPABASE_URL`
- `IT_SUPABASE_SERVICE_ROLE_KEY`

---

# PHASE 1 — IT ADMIN UI/UX

Status: **merged previously and Production foundation established.**

Shared shell:
- `apps/backoffice-web/src/components/layout/app-shell.tsx`
- `apps/backoffice-web/src/components/layout/app-shell.module.css`

Provides:
- CpIPOS branded Sidebar
- grouped navigation
- Topbar
- Breadcrumb
- responsive tablet/mobile drawer
- Thai-first UI with English support
- existing language switcher
- IT role indicator

## Sidebar visual polish batch

When this section is present on `main`, the shared IT Sidebar also includes:
- SST iPOS logo reused from the POS brand asset `/brand/sst-ipos-logo.svg`
- logo and `IT Control Plane` / company-backoffice subtitle centered in the expanded Sidebar
- native Sidebar scrollbar hidden while wheel/touch scrolling remains available
- desktop collapse/expand control with the preference kept in browser local storage
- collapsed mode shows navigation icons only; labels remain available through accessible labels/tooltips
- compact CpIPOS symbol shown when collapsed
- larger primary navigation icons and labels for improved readability
- mobile drawer remains full-width navigation even if desktop was previously collapsed

Dashboard:
- `apps/backoffice-web/src/components/it-admin/it-admin-dashboard.tsx`
- `apps/backoffice-web/src/components/it-admin/it-admin-dashboard.module.css`
- `apps/backoffice-web/src/app/(it-admin)/it-admin/page.tsx`

Dashboard uses existing contracts:
- `/api/it-admin/v1/health`
- `/api/it-admin/v1/tenants?limit=100`
- `/api/it-admin/v1/monitor?minutes=60`

---

# PHASE 2 — STORE PROVISIONING

Status: **PR #4 merged to `main` at `14da383fac4c9265e9a4f82f5fad7430daa39e52`; Vercel status for that merge commit is success. Production functional acceptance is not complete because authenticated Dashboard smoke still fails.**

Business flow:

Tenant
→ Store Code
→ Package / Trial
→ Main Branch
→ Owner account
→ Login policy
→ Device Enrollment
→ Ready for next onboarding step

## CpIPOS schema authority

CpIPOS PR #156 `feat(it-schema): add Store Provisioning P0 control-plane RPC` was merged into its schema/platform base, not into a POS Production release.

- PR #156 exact head validated: `c6dfc3c3ce9dcf1556c52e7ab2bcb1ffaa0c68d6`
- merged source commit: `35d31e7639e7c14f1941ea7ea57feae5857e244a`
- one migration file only: `supabase/migrations/20260828123000_it_store_provisioning_p0.sql`
- no POS UI/runtime/order/payment/stock change
- no FF0001 mutation

Exact-head validation branch/run evidence:
- branch: `hotfix/ci-it-store-provisioning-schema-p0-20260828`
- GitHub Actions run: `33193549967`
- Typecheck: SUCCESS
- Lint: SUCCESS
- Test: SUCCESS
- Primary schema drift: SUCCESS
- CpiPOS-002 schema drift: SUCCESS
- Build: SUCCESS

## CpiPOS-001 Production schema state

The exact provisioning migration was applied to CpiPOS-001 as:

- migration history version: `20260828174600`
- name: `it_store_provisioning_p0`

Read-back after apply:
- `public.it_store_provisioning_requests` exists
- RLS enabled
- ledger row count = 0 immediately after migration
- `anon` table SELECT = denied
- `authenticated` table SELECT = denied
- `service_role` table SELECT = allowed
- `anon` RPC EXECUTE = denied
- `authenticated` RPC EXECUTE = denied
- `service_role` RPC EXECUTE = allowed

`RLS Enabled No Policy` advisor info for this ledger is intentional: it is a server-only/service-role table and no client RLS policy should be added merely to silence the advisor.

No Production tenant/store was created to test this migration.

## Current package catalog constraints

Latest live CpiPOS-001 package read during Phase 2:
- Starter: 350 THB/month, yearly price currently 0, Standard
- Growth: 550 THB/month, yearly price currently 0, Standard
- Custom: manual/custom package, not eligible for Fast Provisioning

Therefore Fast Provisioning currently offers only priced Standard intervals; yearly remains unavailable until a real yearly price exists.

Paid activation is not part of Fast Provisioning. New Store Provisioning starts as Trial only; paid activation continues through the existing IT approval flow.

## CpIPOS-IT Store Provisioning implementation

Primary files:
- `apps/backoffice-web/src/app/(it-admin)/it-admin/store-provisioning/page.tsx`
- `apps/backoffice-web/src/app/(it-admin)/it-admin/store-provisioning/page.module.css`
- `apps/backoffice-web/src/components/it-admin/store-provisioning-console.tsx`
- `apps/backoffice-web/src/components/it-admin/store-provisioning-console.module.css`
- `apps/backoffice-web/src/lib/services/it-admin/store-provisioning-service.ts`
- `apps/backoffice-web/src/app/api/it-admin/v1/store-provisioning/route.ts`

Behavior:
- dedicated Store Provisioning page
- Tenants / Stores directory is separate from the provisioning workflow
- package catalog loads from CpiPOS-001
- Standard + priced interval filtering
- Trial-only enforced both UI and server-side
- confirmation/review before privileged submit
- PIN is not shown in confirmation and is never sent to the core DB RPC
- PIN is bcrypt hashed by trusted server code
- Owner Auth + `users_profiles` + `pos_user_profiles` + owner `user_branch_roles`
- stable `request_id` supports retry/recovery
- important actions are audited
- onboarding ends at Device Enrollment; it does not fake an enrolled device

## Dashboard `Internal server error` Production smoke status

Phase 2 included lazy privileged Supabase clients and safe health diagnostics, and merge commit `14da383f...` deployed successfully.

However, on 2026-08-29 the authenticated Production `/it-admin` screenshot still showed:
- `โหลด Dashboard ไม่สำเร็จ`
- `Internal server error.`

This is current user-observed Production evidence. Therefore:
- do not claim Dashboard Production acceptance yet;
- do not start Phase 3 MDM until this error is diagnosed and resolved;
- do not guess which env/secret is missing;
- use the health route/runtime evidence when available and keep fixes server-side without exposing secret values.

---

# PHASE 3 — DEVICES / MDM

Existing work to reuse only after Dashboard Production smoke is green:

- PR #5 — Device Enrollment and MDM support console
- PR #6 — legacy telemetry / pairing / command ACK compatibility bridge

Do not create a second MDM implementation. Inspect and refresh the existing PRs on top of current `main`.

Operational target:

Device Enrollment
→ Pairing token
→ IT approval
→ Android / Print Agent binding
→ CPU / RAM / Storage
→ Network / Battery
→ POS/App version
→ Printer / Print Agent health
→ Last print/error
→ Incidents
→ Remote Command
→ Delivered / ACK / Result

Real telemetry only.

## FF0001 telemetry safety

Known devices in CpiPOS-002:
- `FF0001-POS-01`
- `FF0001-POS-02`

Latest verified handoff still does not establish trustworthy current device-health values for these terminals. Do not call them healthy solely from registry state and do not insert synthetic rows.

---

# PHASE 4 — OPERATIONS

After provisioning + MDM foundations:
- Packages / Subscriptions
- Feature Entitlements
- Monitoring
- Incident Management
- Audit
- Remote Operations
- Security / Change Password
- IT staff role separation

Reuse existing contracts/components where available.

---

# SAFETY RULES — DO NOT VIOLATE

- Never create a new Vercel project to solve deployment/linkage problems.
- Never guess env values or secrets.
- Never paste service-role keys into chat, docs, commits or screenshots.
- Never reset FF0001.
- Never delete/rewrite customer transaction/payment/order history.
- Never fabricate device health.
- Never expose service-role credentials to browser/device code.
- Never let client code choose the Supabase project.
- Never broad-refactor simply to redesign UI.
- Never change backend contracts solely for visual redesign.
- Never turn a Production customer into test data without explicit approval.

---

# Immediate next action

When this file is on `main`, do these in order:

1. Verify exact live `CpIPOS-IT/main` and Vercel Production for the Sidebar polish merge commit.
2. Smoke the Sidebar without mutating data:
   - SST iPOS logo is centered and readable in expanded mode;
   - `IT Control Plane` and company-backoffice subtitle are centered;
   - no visible Sidebar scrollbar while wheel/touch scrolling still works;
   - desktop collapse shows icons only and can expand again;
   - menu labels/icons are visibly larger;
   - mobile navigation remains full-width and usable.
3. Diagnose and resolve the authenticated `/it-admin` Dashboard `Internal server error` using safe health/runtime evidence. Do not guess secrets or expose their values.
4. Re-run authenticated Dashboard/Tenants/Store Provisioning smoke without pressing the final provisioning submit.
5. Only after Production smoke is green, start **PHASE 3** by refreshing/reusing PR #5 and PR #6.
6. Keep deployment batching: complete a meaningful batch before the next Preview/Production cycle.

---

## New-chat startup prompt

`ทำงานต่อระบบ IT Admin / IT Control Plane ของ CpIPOS โดยก่อนตอบหรือแก้โค้ดทุกครั้งให้อ่าน sstdevelopaminno/CpIPOS-IT context.md จาก main ก่อน แล้วตรวจสถานะสด GitHub/Vercel/Supabase จากนั้นทำต่อจาก Immediate next action ในไฟล์ ถ้าแตะ CpIPOS schema/runtime ต้องอ่าน docs/AI-GUARDRAILS-CPIPOS.md และ CpIPOS context ก่อน ห้ามสร้าง Vercel project ใหม่ ห้ามเดา env/secret ห้าม reset FF0001 ห้ามแก้ transaction/payment/order history ห้ามสร้าง health ปลอม และต้องแยก POS Production lane ออกจาก IT Control Plane เสมอ`
