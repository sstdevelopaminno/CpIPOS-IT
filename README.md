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
