# Development Control Center — Phase 2

## Objective

Phase 2 adds an isolated Build/Run workspace to the IT Support control plane while keeping source editing, Git operations, build execution, deployment, and audit trails centralized.

The browser never receives GitHub or Vercel credentials.

## User flow

1. IT Support selects a repository and file.
2. Source can be edited in the main page or opened in a detached editor window.
3. Source writes require the logged-in IT Support user's Security PIN.
4. Changes are committed only to an `it-support/*` branch.
5. IT Support can create and merge a Pull Request.
6. Build / Verify / Test can be dispatched to an isolated ephemeral workspace.
7. Workspace state and job steps are viewed manually from the Development Center.
8. Preview / Production deploy remains a separate Vercel action.
9. Every write, workspace dispatch/cancel, merge, and deploy is written to Audit Log.

## Isolated workspace architecture

The Phase 2 runner uses a GitHub-hosted ephemeral Ubuntu runner:

- fixed tasks only: `verify`, `build`, `test`;
- no user-supplied shell command;
- 25 minute job timeout;
- workflow permission is `contents: read`;
- checkout credentials are not persisted;
- production and Vercel secrets are not injected into target code;
- Node.js and Rust repositories are detected and validated;
- no automatic browser polling.

This keeps build CPU outside the CpIPOS Vercel application and avoids turning a Vercel Function into a long-running build worker.

## Security controls

- Page and APIs: IT Support only.
- Mutation: Security PIN required.
- PIN attempts: limited by the shared server rate limiter.
- Workspace dispatch: 4 runs / 15 minutes per IT Support user + IP.
- Source write: 12 / 5 minutes.
- Vercel deployment: 4 / 10 minutes.
- Production deploy: 2 / hour.
- Direct writes to the default branch remain blocked.
- Secret-like source paths remain blocked.
- No automatic status polling.
- Audit events include actor, action, repository/ref, request/run id, IP, and user agent.

## Required server configuration

The web application needs a server-only GitHub credential with the minimum repository permissions needed for:

- repository contents read/write for approved repositories;
- pull requests read/write;
- Actions read/write on `CpIPOS-IT`.

The same credential may be stored as the GitHub Actions repository secret `CPIPOS_GITHUB_TOKEN` when private target repositories must be checked out by the isolated runner.

Vercel deployment continues to use the existing server-only Vercel credential.

Never expose either credential with a `NEXT_PUBLIC_` prefix.

## UI changes

The Development page is intentionally compact:

- System status is hidden behind **สถานะ**.
- Quota/guard information is hidden behind **Quota**.
- Workspace history and controls are hidden behind **Build / Run**.
- Vercel deployment history is hidden behind **Deployments**.
- The detached source editor opens at `/it-admin/development-editor`.
- Main-page explanatory paragraphs and always-visible status cards were removed.

## Phase 2 file map

### Added

- `.github/workflows/development-workspace.yml`
- `apps/backoffice-web/src/app/api/it-admin/v1/development/workspace/route.ts`
- `apps/backoffice-web/src/app/it-admin/development-editor/page.tsx`
- `apps/backoffice-web/src/components/it-admin/development-editor-window.tsx`
- `apps/backoffice-web/tests/integration/development-center-phase2.contract.test.ts`
- `docs/DEVELOPMENT-CENTER-PHASE2.md`

### Modified

- `apps/backoffice-web/src/lib/development-control.ts`
- `apps/backoffice-web/src/app/api/it-admin/v1/development/overview/route.ts`
- `apps/backoffice-web/src/components/it-admin/development-center-console.tsx`

## Next hardening steps

Phase 2 intentionally does not accept arbitrary terminal commands. A future Phase 3 can add controlled project profiles, signed workspace policies, dedicated self-hosted runners for Windows/Android builds, artifact retention policies, and stronger outbound network restrictions.
