# CpIPOS-IT

Separated IT Admin workspace for CpIPOS platform operations.

## Source of truth

This repository is the source of truth for CpIPOS IT Admin and IT/backoffice runtime work.

- IT Admin source repository: `sstdevelopaminno/CpIPOS-IT`
- Customer POS/mobile source repository: `sstdevelopaminno/CpIPOS`
- Do not connect the IT Admin Vercel project to `sstdevelopaminno/CpIPOS`.
- POS feature development, including restaurant and grocery sales modes, belongs in `sstdevelopaminno/CpIPOS`.

## Scope

- IT Admin web surface: `apps/backoffice-web/src/app/(it-admin)` and `apps/backoffice-web/src/app/it-admin`
- IT Admin APIs: `apps/backoffice-web/src/app/api/it-admin`
- IT Admin services and guards: `apps/backoffice-web/src/lib/services/it-admin`, `apps/backoffice-web/src/lib/it-admin-guard.ts`
- IT Admin Windows runtime: `apps/windows-runtime-it-admin`
- IT Admin runtime download/release workflow: `.github/workflows/build-it-admin-runtime.yml`
- IT Admin web CI: `.github/workflows/ci-it-admin-web.yml`

This repository was split from `sstdevelopaminno/CpIPOS` so IT/backoffice work can evolve separately from the customer POS/mobile runtime.

## POS control-plane integration

`CpIPOS-IT` and the customer POS runtime do not use a privileged browser-to-browser or server-to-server API as the primary trust bridge. The authoritative integration is the shared Supabase control plane.

- Customer POS writes device telemetry through `/api/pos/device-heartbeat` into `pos_device_health_latest`, `pos_device_health_snapshots`, and `pos_device_incidents`.
- IT Admin reads device health from those shared tables through `/api/it-admin/v1/devices/[deviceId]/health`.
- IT Admin writes remote actions to `device_commands` through `/api/it-admin/v1/device-commands`.
- Customer POS receives pending commands during heartbeat and acknowledges execution through its existing POS command acknowledgement endpoint.
- IT Monitoring reads shared operational tables through `/api/it-admin/v1/monitor`; IT pages must not call `/api/admin/pos/*` from the customer POS repository.
- Tenant/branch/device scope remains authoritative in Supabase. IT Admin endpoints require the platform `it_admin` role and use the service client only after the guard succeeds.

The optional `CPIPOS_PRODUCTION_URL` variable identifies the customer POS production surface for metadata/navigation. It is not a privileged authentication channel.

## Vercel deployment contract

For the CpIPOS IT Admin web project in Vercel:

- Git repository: `sstdevelopaminno/CpIPOS-IT`
- Root Directory: `apps/backoffice-web`
- Framework Preset: `Next.js`
- Install/build commands: use the committed `apps/backoffice-web/vercel.json`
- Never use `apps/it-admin-web`; that directory does not exist in this repository.

Before removing or replacing an existing IT Admin Vercel project, first prove the replacement deployment reaches `Ready` and the IT Admin login surface loads successfully.

## Validation

Pull requests into `main` run the IT Admin web validation contract:

1. dependency install with the locked pnpm workspace
2. TypeScript typecheck
3. ESLint
4. tests
5. production Next.js build

## Commands

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```
