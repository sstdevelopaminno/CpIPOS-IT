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
10. Update this file so the next chat can continue from live state.

If a task touches POS/schema/runtime in `sstdevelopaminno/CpIPOS`, first read `docs/AI-GUARDRAILS-CPIPOS.md` and the current CpIPOS handoff/context, then verify that repo's live GitHub/Vercel/Supabase state before changing anything.

Do not reconstruct current state from old chats when it conflicts with this file or live connected sources.

---

## System boundaries — keep these lanes separate

### `sstdevelopaminno/CpIPOS`
Customer-facing POS Production runtime and business transactions.

### `sstdevelopaminno/CpIPOS-IT`
Company IT Control Plane / Backoffice.

### CpiPOS-001
Project ref: `deejlitaivfnsbwqdugy`

Authority for:
- Supabase Auth
- tenant / store / branch / user
- package / subscription / business control-plane data
- POS business data and transactions

### CpiPOS-002
Project ref: `kawenyvpentwgugtzqec`

Operational IT/MDM data plane for:
- device registry
- device health / telemetry
- incidents
- remote commands and ACK/result
- IT operational state

### Non-negotiable architecture rules

- Browser code must never receive a service-role key.
- Privileged actions are server-side only.
- Important actions require an audit trail.
- Tenant / branch / device scope must remain correct.
- Client code must not choose which Supabase database to use.
- Orders, payments, products, stock and customer transaction history stay out of CpiPOS-002.
- IT work must not be mixed into a POS Production release.

---

# LIVE IT CONTROL PLANE STATE

## GitHub `CpIPOS-IT/main`

Latest verified `main` commit:

- SHA: `9a461295394553cd7c100789a3a3db760e1d60b3`
- Commit: `feat(it-ui): production-grade IT Admin shell and dashboard (#16)`
- PR #16: MERGED

PR #16 was an IT UI-only change. It did not modify POS sales/order/payment logic, database schema/RLS, secrets, FF0001 data, or backend contracts.

### Currently open IT PRs

- PR #4 — DRAFT — `feat(it): add Store Provisioning P0`
- PR #5 — DRAFT — `feat(it): add Device Enrollment and MDM support console`
- PR #6 — DRAFT — `MDM P0: bridge legacy telemetry, pairing, and command ACK`

Do not duplicate these features in parallel branches without first inspecting the existing PRs and their dependencies.

---

## Vercel

Live GitHub/Vercel integration now identifies the existing IT project as:

- Project: `cp-ipos-it-web`
- Project ID: `prj_9jNjDHyctinDjnvCZ2Ya1zBJs38h`
- Team ID: `team_ZKmv6uQSU9QUyP08mxAr2YDI`

The older handoff name `cp-ipos-it-backoffice-web` is stale and must not be used to justify creating another project.

Latest verified Production state for `main` SHA `9a461295...`:

- Vercel status: `success`
- Description: `Deployment has completed`
- Production deployment target is the existing `cp-ipos-it-web` project.

PR #16 exact-head Preview was also `Ready` / success before merge.

The connected Vercel API inventory has shown inconsistent project-list permissions/visibility for this project, while GitHub's Vercel integration reports the exact deployment status. Do not create a replacement project because of that connector visibility mismatch.

### Current server environment contract used by the IT health route

Names only — never paste secret values into chat/docs/source:

- `CPIPOS_SUPABASE_URL`
- `CPIPOS_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `IT_SUPABASE_URL`
- `IT_SUPABASE_SERVICE_ROLE_KEY`

---

## Supabase live state

Latest verified during the UI Phase 1 work:

- CpiPOS-001: `ACTIVE_HEALTHY`
- CpiPOS-002: `ACTIVE_HEALTHY`
- CpiPOS-001 required control-plane tables checked: `users_profiles`, `tenants`, `branches` exist.

### FF0001 safety + telemetry state

Devices in CpiPOS-002:

- `FF0001-POS-01` — registry status `active`
- `FF0001-POS-02` — registry status `active`

At the latest live read, both still had no usable row values in `it_device_health_latest` for:

- `last_seen_at`
- app version
- runtime version
- system health
- runtime health
- peripheral health
- offline-sale health
- last error

Therefore:

- Do **not** call FF0001 healthy merely because its registry row is active.
- Do **not** insert fake health/heartbeat rows to make MDM look complete.
- Do **not** reset FF0001.
- Do **not** alter customer order/payment/shift/transaction history for MDM testing.

---

# PHASE 1 — IT ADMIN UI/UX

Status: **App Shell + Dashboard + Navigation foundation merged to Production.**

## What is now on `main`

### Shared App Shell

Central component:
- `apps/backoffice-web/src/components/layout/app-shell.tsx`
- `apps/backoffice-web/src/components/layout/app-shell.module.css`

Now provides:
- CpIPOS-branded left Sidebar
- grouped navigation
- sticky Topbar
- Breadcrumb
- active route state
- responsive drawer for tablet/mobile
- existing language switcher reuse
- IT role indicator
- disabled state for modules not yet present on `main` rather than dead links

### Navigation structure now represented

- Dashboard
- Tenants / Stores
- Store Provisioning — currently disabled until its module lands
- Branches — currently disabled
- Users / Roles / Permissions
- Devices / MDM — currently disabled until its module lands
- Android App Rollout — currently disabled
- Printer / Print Agent — currently disabled
- Packages / Subscriptions
- Feature Entitlements — currently disabled
- Monitoring
- Incidents — currently disabled
- Audit Logs
- Settings / Security

Thai is primary and English remains supported.

### Dashboard

Files:
- `apps/backoffice-web/src/components/it-admin/it-admin-dashboard.tsx`
- `apps/backoffice-web/src/components/it-admin/it-admin-dashboard.module.css`
- `apps/backoffice-web/src/app/(it-admin)/it-admin/page.tsx`

Dashboard uses existing backend contracts only:

- `/api/it-admin/v1/health`
- `/api/it-admin/v1/tenants?limit=100`
- `/api/it-admin/v1/monitor?minutes=60`

It includes:
- Loading state
- Error + Retry state
- refresh/degraded state
- empty stores state
- live success state
- Control Plane reachability summary
- tenant/store summary
- monitoring/API-error summary
- recent stores
- quick operations links

Important: dashboard explicitly distinguishes Control Plane reachability from real device telemetry and does not fabricate device health.

## PR #16 validation evidence

Exact head before merge: `78fd23531b436b208c0aab24b259dce7b60b7633`

GitHub Actions run `33192566457` / `CI IT Admin Web`:
- Typecheck: SUCCESS
- Lint: SUCCESS
- Test: SUCCESS
- Production Build: SUCCESS
- Overall job: SUCCESS

Vercel Preview:
- Project `cp-ipos-it-web`
- Ready / success

Post-merge Production:
- `main` SHA `9a461295...`
- Vercel `success` / `Deployment has completed`

The authenticated `/it-admin` login/session gate was already user-confirmed working before the UI redesign. Tooling in this run could verify deployment/CI state but could not perform an authenticated browser smoke session on behalf of the IT user, so do not claim a post-redesign authenticated UI click-through unless it is actually tested.

---

# PHASE 2 — STORE PROVISIONING

Business target:

IT staff must be able to open a new SaaS customer entirely from IT Backoffice without manually editing source code, SQL, or building an APK per store.

Required flow:

Tenant
→ Store Code
→ Package / Trial
→ Main Branch
→ Owner account
→ Login policy
→ Device Enrollment
→ Ready to use

## Existing work to reuse

PR #4 already contains Store Provisioning P0 work. Do not build a second provisioning flow before inspecting it.

PR #4 says it depends on a schema-only CpIPOS change providing the existing provisioning authority/idempotency path. Because that dependency touches `CpIPOS` schema/runtime boundaries, **before changing or merging PR #4**:

1. Read `CpIPOS/docs/AI-GUARDRAILS-CPIPOS.md`.
2. Read current CpIPOS handoff/context.
3. Verify current CpIPOS GitHub state and the exact schema dependency.
4. Confirm it does not alter customer transaction/payment/order history.
5. Keep any schema-only dependency isolated from POS Production feature work.

---

# PHASE 3 — DEVICES / MDM

PR #5 and PR #6 contain existing work. They must be inspected and refreshed after Store Provisioning rather than reimplemented from scratch.

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

Real telemetry only. CPU/RAM/storage/printer values must remain unknown/not-reported until a real producer sends them.

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

Reuse existing modules/contracts where they already exist.

---

# SAFETY RULES — DO NOT VIOLATE

- Never create a new Vercel project to solve a deployment/linkage problem.
- Never guess env values or secrets.
- Never paste service-role keys into chat, docs, commits or screenshots.
- Never reset FF0001.
- Never delete or rewrite customer transaction/payment/order history.
- Never fabricate FF0001/device health data.
- Never expose a service-role key to browser/device code.
- Never let client code choose CpiPOS-001 vs CpiPOS-002.
- Never mix IT feature development into the POS Production release lane.
- Never broad-refactor the repository merely to redesign a UI.
- Never change backend contracts just because the UI is being redesigned.

---

# Immediate next action

Proceed with **PHASE 2 — Store Provisioning** using the work that already exists in PR #4.

Concrete next sequence:

1. Re-read this file from `main`.
2. Verify live `CpIPOS-IT/main`, PR #4, PR #5 and PR #6.
3. Inspect PR #4 diff/base/dependency and determine whether it needs to be rebased/refreshed on top of `main` SHA `9a461295...` and the new shared App Shell.
4. Because PR #4 has a CpIPOS schema dependency, read `CpIPOS/docs/AI-GUARDRAILS-CPIPOS.md` + current CpIPOS context and verify the exact live dependency before touching it.
5. Finish Store Provisioning as one production-grade flow using existing backend authority; do not require manual SQL/source edits for a new customer.
6. Add the full UI states required for provisioning: loading, validation, empty/error, success, and confirmation where an action is destructive or privileged.
7. Run Typecheck → Lint → Test → Production Build → exact-head CI → Vercel Preview.
8. Merge only when green, verify Production, then update this file again.

Do not start a new MDM implementation while PR #4 is the first unfinished module in the required business order.

---

## New-chat startup prompt

`ทำงานต่อระบบ IT Admin / IT Control Plane ของ CpIPOS โดยก่อนตอบหรือแก้โค้ดทุกครั้งให้อ่าน sstdevelopaminno/CpIPOS-IT context.md จาก main ก่อน แล้วตรวจสถานะสด GitHub/Vercel/Supabase จากนั้นทำต่อจาก Immediate next action ในไฟล์ ถ้าแตะ CpIPOS schema/runtime ต้องอ่าน docs/AI-GUARDRAILS-CPIPOS.md และ CpIPOS context ก่อน ห้ามสร้าง Vercel project ใหม่ ห้ามเดา env/secret ห้าม reset FF0001 ห้ามแก้ transaction/payment/order history ห้ามสร้าง health ปลอม และต้องแยก POS Production lane ออกจาก IT Control Plane เสมอ`
