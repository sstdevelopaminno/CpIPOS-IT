# AI Guardrails For CpIPOS

Date: 2026-08-08

## Current Project

- Active local workspace: `E:\CpIPOS`
- Active GitHub repo: `https://github.com/sstdevelopaminno/CpIPOS.git`
- Active branch: `agent-docs-preflight-schema-drift`
- Active Vercel project: `cp-ipos-web`
- Active production URL: `https://cp-ipos-web.vercel.app`
- Primary/control-plane Supabase project: `CpiPOS-001`
- Primary/control-plane Supabase ref: `deejlitaivfnsbwqdugy`
- Trial Data Plane Supabase project: `CpiPOS-002`
- Trial Data Plane Supabase ref: `kawenyvpentwgugtzqec`
- Trial Data Plane URL: `https://kawenyvpentwgugtzqec.supabase.co`
- Latest handoff: `docs/CPIPOS-HANDOFF-2026-07-28.md`
- Tenant data lifecycle design: `docs/TENANT-DATA-LIFECYCLE-2026-08-08.md`
- Current collaboration preference: token-saving mode; wait for explicit user instructions before further development.

## Do Not Confuse With Old Project

- Do not develop new Web POS work from `E:\SSTiPOS`.
- Do not push new CpIPOS work to `sstdevelopaminno/SSTiPOS.git`.
- Do not create parallel worktrees or sibling copies unless the user explicitly requests it.
- Use `E:\CpIPOS` as the single source of truth for the new CpIPOS Web POS.

## Production Database Baseline

There is no real customer business data in the three current pre-launch tenants. Their roles are:

- legacy `NDL-TH-001` -> public code `900001` -> Sales/IT demo tenant
- legacy `BBQ-TH-002` -> public code `800001` -> internal trial/test tenant
- legacy `TEST-TH-003` -> public code `800002` -> internal trial/test tenant

Rules:

- The six-digit `tenant_access_codes.access_code` is the human-facing store identifier. It is allocated once and must never change during Trial -> Paid -> Archive lifecycle transitions.
- Real customer store codes use random values in `100000-799999` from the first trial/onboarding day and keep the same value after conversion to paid.
- `800000-899999` is reserved for internal/test tenants. `900000-999999` is reserved for Sales/IT demo tenants.
- Legacy `tenants.code` values remain internal compatibility identifiers. Do not rename them merely to improve the login UX.
- Store code is an identifier, not an authentication secret. Employee/PIN/staff-card, device, POS session, tenant/branch scope, rate limit, feature gate, and audit controls remain authoritative.
- `SOLO-TH-001` was removed from Production on 2026-08-07 and must not be re-seeded.
- Package code `solo` / `Solo Register` is a valid system package and is not a tenant/store code; keep the package catalog entry.
- The default `supabase/seed.sql` must remain tenant-neutral. Do not hard-code production/demo tenants, branches, devices, users, passwords, PINs, orders, products, or inventory into the default reset path.
- Temporary demo fixtures, if ever needed, must be explicit opt-in scripts and must not reuse production store codes or credentials.
- Do not rename live tables, columns, constraints, RPCs, or RLS policies merely for style. Use additive compatibility-safe migrations and verify runtime consumers first.
- CpiPOS-001 housekeeping/control-plane migrations `20260807152000`, `20260807154613`, `20260807155636`, `20260807155747`, `20260807155904`, `20260807164920`, `20260807181344`, `20260807182453`, and `20260807183126` are the current Production-safe baseline.
- CpiPOS-002 migrations are stored separately under `supabase/trial-data-plane/migrations/` and must never be moved into the CpiPOS-001 `supabase/migrations/` path.
- CpiPOS-002 currently has `20260807190055_trial_data_plane_foundation_v1` and `20260807190418_trial_data_plane_transactions_v1` applied.
- Privileged `public` `SECURITY DEFINER` RPCs used by POS/Web/Mobile server paths must remain non-executable by `anon` and `authenticated`; trusted server callers use `service_role`.
- Policies that call authenticated-only helper functions such as `app.has_branch_access`, `app.has_role`, or `app.is_it_admin` must not be restored to `TO public`; use an explicitly authenticated target unless a separately reviewed anonymous contract exists.
- `pos_user_approval_permissions_owner_manage` and `pos_user_approval_permissions_select` must remain targeted to `authenticated`, not `public`.
- Do not add RLS policies to server-only tables merely to silence `RLS Enabled No Policy` Advisor notices. RLS with no policy is intentionally deny-by-default unless a direct-client access contract is explicitly designed.
- Do not remove an index solely because Supabase marks it unused; require a meaningful Production observation window and workload evidence first.
- Supabase Auth `Leaked Password Protection` should be enabled in CpiPOS-001 Auth Settings before customer onboarding; it is a project-level Auth setting, not a SQL migration.

## Tenant Data Routing Rules

- `CpiPOS-001` remains the identity/control-plane authority for all tenants, including trials.
- `CpiPOS-002` is the connected Trial Data Plane for high-churn business data. It is not a backup database.
- CpiPOS-002 intentionally does not clone Supabase Auth, full tenants, user profiles, user-branch roles, device/login policy, or IT Admin authority from CpiPOS-001.
- CpiPOS-002 uses `trial_tenant_scopes`, `trial_branch_scopes`, and short-lived `trial_runtime_leases` as server-issued scope/runtime anchors.
- CpiPOS-002 business tables and transaction RPCs are server/service-role only: RLS is enabled, no client policies are defined, and `anon`/`authenticated` table/RPC access is revoked.
- `tenant_data_lifecycle.data_home` in CpiPOS-001 is the only authoritative current business-data location. `desired_data_home` is a migration target and must never route traffic by itself.
- `NDL` Sales/IT demo remains `primary` for reliable demonstrations.
- `BBQ` and `TEST` have a verified dry-run copy in CpiPOS-002, but both remain `data_home=primary`, `desired_data_home=trial`, `migration_status=verifying`, and `cutover_allowed=false` until runtime routing/lease synchronization and cutover smoke tests pass.
- Dry-run reconciliation for TEST verified matching row counts, order total, payment total, inventory total, UUIDs and canonical checksums across copied business tables. BBQ has an empty business-data set plus its branch/config scope snapshot.
- Never silently fallback a tenant whose authoritative `data_home=trial` to CpiPOS-001 when CpiPOS-002 is unavailable; fail closed to prevent split-brain writes.
- Trial -> Paid migration must preserve tenant UUIDs, store access code, business row UUIDs, and idempotency keys; verify row counts, financial totals, inventory reconciliation, and canonical checksums before cutover.
- Supabase Auth/JWT authority remains in CpiPOS-001. Do not move customer Auth merely because business data moves between Trial and Primary.
- Android, Windows, Web, Mobile, and IT Backoffice must keep calling CpIPOS APIs; client code must never choose a Supabase project or trusted `data_home` itself.
- Run both `pnpm schema:drift` and `pnpm schema:drift:trial` in CI. A change is not schema-safe if either database drift guard fails.

## Required Production Env

Vercel production must include these CpiPOS-001 server/runtime variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POS_SESSION_HANDOFF_SECRET`
- `TABLE_QR_SIGNING_SECRET`

`POS_SESSION_HANDOFF_SECRET` is required for valid store-code login because the server signs the pre-entry login-flow cookie after tenant and branch lookup.
`TABLE_QR_SIGNING_SECRET` must be separate from `SUPABASE_SERVICE_ROLE_KEY`; table QR tokens must not be signed with service-role credentials.

CpiPOS-002 routing variables are server-only:

- `TRIAL_DATA_ROUTING_ENABLED=false` until router integration, runtime-lease synchronization, API regression tests, and explicit cutover verification pass
- `TRIAL_SUPABASE_URL=https://kawenyvpentwgugtzqec.supabase.co`
- `TRIAL_SUPABASE_SERVICE_ROLE_KEY` must come from the CpiPOS-002 trusted server secret; a publishable key is not a substitute

Never expose CpiPOS-002 service credentials through `NEXT_PUBLIC_*` variables and never commit them to GitHub.

Production/serverless auth rate limiting should use the distributed Upstash backend (`RATE_LIMIT_BACKEND=upstash` with valid `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`). In-memory limiting is process-local and is only an acceptable local/degraded fallback.

## Transaction And API Reliability Rules

- Production order creation and payment completion are transaction-RPC first. Keep `POS_FORCE_DIRECT_CREATE_NON_DELIVERY=false` and `POS_FORCE_DIRECT_PAYMENT_COMPLETE=false` unless an explicitly reviewed emergency compatibility rollback requires otherwise.
- Keep `POS_SOFT_BYPASS_INSUFFICIENT_STOCK=false` by default. Negative-stock behavior must come from the branch-aware database policy, not a generic application bypass.
- P0 before customer cutover: `apps/backoffice-web/src/lib/services/pos-sales-service.ts` currently treats missing values for the three emergency flags above as enabled. Until the source default is corrected to explicit opt-in, Production must explicitly set all three values to `false`.
- Direct multi-request order/payment fallbacks are not atomic and must never become the silent default again.
- A timeout implemented around a Supabase promise does not prove the database mutation was cancelled. After a timeout, retry a mutation only with the same idempotency/request key so a late first attempt cannot duplicate an order or payment.
- Do not introduce internal HTTP calls from one Next.js route to another route in the same deployment when the canonical handler/service can be invoked in-process.
- External API calls must have a bounded timeout and must not retry money-changing operations automatically unless the provider contract and idempotency semantics explicitly make the retry safe.
- Provider-supplied outbound URLs must be validated before server-side fetch. For INET NOPS, dynamic payment URLs must use HTTPS and an approved provider hostname (configured endpoint host or explicit `INET_NOPS_ALLOWED_PAYMENT_HOSTS_*`).
- Do not expose service-role credentials, provider merchant keys, access tokens, or raw provider error bodies to browser responses or logs.

## Verified Login Store Codes

Human-facing pre-launch codes:

- `900001`: Sales/IT demo (`NDL-TH-001` internal)
- `800001`: internal trial (`BBQ-TH-002` internal)
- `800002`: internal trial (`TEST-TH-003` internal)

Legacy alpha-numeric codes remain temporarily accepted server-side for compatibility, but new onboarding and operator instructions should use the six-digit code.

## Production Smoke Expectations

- `/login/store`: `200`
- `/login/branches`: `200`
- `/login/employee`: `200`
- `/login/devices`: `200`
- `/manifest.webmanifest`: `200`
- `/preview/pos`: redirects to `/login/store` without a POS session
- `/preview/pos/settings`: redirects to `/login/store` without a POS session
- `/api/pos/session/current`: `401 missing_pos_session` without login
- `/api/pos/features`: `401 missing_pos_session` without login
- `/api/pos/sales`: `401 missing_pos_session` without login

## Security Rules

- Never commit `.vercel/`, `.env.local`, Vercel tokens, Supabase access tokens, database passwords, CpiPOS-001 service-role keys, CpiPOS-002 service-role keys, or generated local cache folders.
- Keep all Supabase service-role usage server-only.
- Never restore direct `anon`/`authenticated` EXECUTE on privileged POS transaction wrappers without a separately reviewed direct-client security design.
- If valid store-code login returns `500`, first check Vercel env for `POS_SESSION_HANDOFF_SECRET` before changing database schema.
- For local `localhost:3000` login slowness or API timeouts, read `docs/LOCAL-DEV-LOGIN-PERFORMANCE-2026-07-27.md` before debugging. Most local delays are first-route compile, missing `.env.local`, sandboxed network, or slow `.next/dev` filesystem cache.
