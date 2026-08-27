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

## POS platform integration contract

IT Admin connects to customer POS deployments through explicit server-side contracts. It must not copy POS feature code back into this repository and must not accept arbitrary target URLs from the browser.

The first integration slice is read-only:

- POS Web target: `CPIPOS_POS_WEB_BASE_URL`
- POS Backoffice target: `CPIPOS_BACKOFFICE_WEB_BASE_URL`
- Fixed version endpoint: `/api/system/version`
- Protected IT Admin status API: `/api/it-admin/v1/platform-status`
- Monitoring UI: `/it-admin/monitoring`
- Requests are server-side, `no-store`, HTTPS-only for remote hosts, timeout-protected, and fail independently per target.
- POS Web defaults to the verified canonical runtime `https://cp-ipos-web.vercel.app`.
- POS Backoffice must be configured with its public runtime URL. Do not use a `vercel.com/.../projects/...` dashboard URL as an application target.
- This slice does not create sales, mutate tenant data, requeue print jobs, or alter POS configuration.

Future write-capable IT operations must use separately authenticated, audited contracts and must not weaken the read-only monitoring boundary.

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
