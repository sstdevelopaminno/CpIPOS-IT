# CpIPOS-IT

Separated IT Admin workspace for CpIPOS platform operations.

## Scope

- IT Admin web surface: `apps/backoffice-web/src/app/(it-admin)` and `apps/backoffice-web/src/app/it-admin`
- IT Admin APIs: `apps/backoffice-web/src/app/api/it-admin`
- IT Admin services and guards: `apps/backoffice-web/src/lib/services/it-admin`, `apps/backoffice-web/src/lib/it-admin-guard.ts`
- IT Admin Windows runtime: `apps/windows-runtime-it-admin`
- IT Admin runtime download/release workflow: `.github/workflows/build-it-admin-runtime.yml`

This repository was split from `sstdevelopaminno/CpIPOS` so IT/backoffice work can evolve separately from the customer POS/mobile runtime.

## Commands

```powershell
corepack pnpm install
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web build
```
