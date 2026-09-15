# Security Audit 2026-09-15

Scope: documentation and code review for the CpIPOS-IT admin/control-plane workspace, focused on privileged IT Admin API routes, Supabase usage, MDM command queueing, and repository security posture.

## Reviewed

- `README.md`
- `context.md`
- `docs/AI-GUARDRAILS-CPIPOS.md`
- `apps/backoffice-web/.env.example`
- `apps/backoffice-web/src/lib/it-admin-guard.ts`
- `apps/backoffice-web/src/lib/auth-context.ts`
- `apps/backoffice-web/src/lib/supabase-admin.ts`
- `apps/backoffice-web/src/lib/supabase-server.ts`
- `apps/backoffice-web/src/lib/it-control-plane.ts`
- `apps/backoffice-web/src/lib/mdm/commandPolicy.ts`
- `apps/backoffice-web/src/app/api/it-admin/v1/mdm/commands/route.ts`
- `apps/backoffice-web/src/app/api/it-admin/v1/device-commands/route.ts`
- `apps/backoffice-web/src/app/api/it-admin/v1/devices/[deviceId]/health/route.ts`
- `apps/backoffice-web/src/app/api/it-admin/v1/modules/[module]/route.ts`
- `supabase/control-plane-functions/*/index.ts`

## Findings

### Fixed: unbounded and unsanitized MDM command payloads

`POST /api/it-admin/v1/mdm/commands` accepted arbitrary request payload objects and persisted the same object into `mdm_commands.payload` and `mdm_command_audit.metadata.payload`.

Risk:

- secret-like values such as tokens, passwords, cookies, API keys, PINs, or hashes could be retained in command/audit records;
- large or deeply nested JSON could create avoidable queue/audit bloat;
- prototype pollution keys could be forwarded to downstream executors.

Fix:

- added MDM payload sanitization in `src/lib/mdm/commandPolicy.ts`;
- rejects payloads containing sensitive field names, unsupported values, excessive depth, too many keys, too many array items, overly long strings, or oversized serialized JSON;
- redacts sensitive values in the audit-event copy;
- changed the MDM route to persist only `validation.auditEvent.payload`;
- added a request `content-length` guard for the MDM command endpoint;
- added unit tests for sensitive-field rejection, redaction, and size/complexity limits.

### Verified: IT Admin authorization source

`requireItAdmin()` resolves auth through `getAuthContext()` and requires `platformRole === "it_admin"` before returning service clients. Role resolution uses Supabase `app_metadata` and falls back to `users_profiles.platform_role`; it does not authorize from user-editable `user_metadata`.

### Verified: service-role client boundary

Service clients are imported through server-only modules and are not exposed as `NEXT_PUBLIC_*` values. `.env.example` leaves privileged keys blank and labels them as server-side credentials.

## Follow-Up Hardening

1. Extend request body size checks to other privileged mutation routes that call `req.json()`.
2. Add a shared audit metadata sanitizer for all `appendAuditLog` and `appendItAuditLog` callers so historical and future metadata is safe by default.
3. Review Supabase RLS/grants and Edge Function access with live advisors before any production schema migration.
4. Consider moving legacy `SUPABASE_SERVICE_ROLE_KEY` naming toward Supabase secret keys when the deployment environment is ready.

## Verification

- `corepack pnpm --filter backoffice-web exec vitest run tests/unit/mdm/eligibility.test.ts`