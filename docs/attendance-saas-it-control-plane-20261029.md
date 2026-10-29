# Cpi-Attendance SaaS — IT Control Plane contract (proposal, 2026-10-29)

**Cross-repo owner**: IT source of truth is `sstdevelopaminno/CpIPOS-IT`, Attendance application and tenant-isolated employee events belong in `sstdevelopaminno/Cpi-Attendance`.

## User-approved business design
IT is the **sole organization provisioning, subscription, contract, module entitlement, device and API quota issuer**. One Attendance service can be sold as full HR Web + Android HR reader + Kiosk + Employee PWA, POS add-on, or external-HR API-only with any customer-selected subset. Avoid forcing a paid CpiPOS POS subscription on standalone customers.

IT package UI and subscription components already exist; prefer a **new product family** over duplicating the system or reusing POS-only feature flags indiscriminately. No database or billing change is made by this proposal.

### New Attendance product capability keys
| Feature flag | Behavior |
| --- | --- |
| `ATT_HR_WEB` | Authorize own-tenant HR browser console |
| `ATT_HR_ANDROID` | HR staff using approved Android USB CCID readers for candidate/enrollment capture |
| `ATT_KIOSK` | Device-bound employee punch on separate Android kiosk |
| `ATT_EMPLOYEE_PWA` | Employee mobile QR + geofence + self-history/leave |
| `ATT_PAYROLL` | Restricted payroll/payslip module after legal/accounting gate |
| `ATT_EXTERNAL_API` | Scope-limited external HR/ERP API, webhook and quotas |
| `ATT_POS_ADDON` | Optional tenant/branch mapping and POS owner/manager entry point |

### Proposed presets (price/cap values are intentionally NOT supplied)
- `ATT_STANDARD`: HR Web + Android HR + Employee PWA; Kiosk and Payroll are separately configurable.
- `ATT_KIOSK_EXTERNAL`: Android HR + Android Kiosk + Employee PWA + external API; **HR Web disabled** (customer uses their own HR).
- `ATT_POS_ADDON`: grant Attendance modules to an existing CpiPOS tenant, with independent Attendance contract and access rights.
- `ATT_CUSTOM`: independently selectable components, device/employee/branch/API quota, support/retention and term.

### Control plane entity boundaries
- Product Family/Package/Version — IT only
- Entitlement contract — tenant/customer account, edition, start/end, trial/grace, package status, allowed feature flags, max organizations/branches/employees/kiosk devices/API calls, version, updated_at
- Device registry — device public key or managed identity, approved site, owner tenant, `HR_ENROLLMENT` vs `EMPLOYEE_KIOSK` mode, last heartbeat, revocation status
- External API integration client — per-org scopes, expiry, rotation, rate limit, audit and origin credential rotation
- Attendance maps IT tenant ID to private Attendance organization UUID. Do not reuse POS sales IDs as employee primary keys.

### Provision / activation / suspension flow
1. IT creates an Attendance organization/subscription and selects package features, API scopes, quotas and device count.
2. IT sends authenticated entitlement update (versioned, signed server-to-server event or other trusted control plane channel).
3. Attendance API validates and stores only necessary entitlement snapshot; HR Web and APK *display* allowed menus but server enforces restrictions on **every protected operation**.
4. HR Admin receives invitation to enroll users; HR can register/revoke devices only within IT quota and own tenant scope.
5. On expiry/suspend, Attendance server rejects new privileged writes according to contract. Ensure regulated retained records and lawful data export remain accessible by separately defined read-only policy; never silently delete employee data.
6. On renewal or custom order, IT publishes new entitlement version, audits approver, effective period and history. Audit discrepancies and reconcile periodically.

### Explicitly supported external-HR scenario
Customer buys Android HR capture and Employee PWA and uses a third-party HR dashboard, not Cpi-Attendance HR Web. IT enables `ATT_EXTERNAL_API` with org-scoped machine credentials. Customer HR uses its own internal employee/shift/payroll system while Attendance APIs manage authorized mobile capture and time-event processing. Employee payslips show **only when payroll data is supplied via authorized integration**, not automatically from card or time event data.

### Safety requirements
- Do not expose IT service keys, Supabase `service_role` or subscription editing endpoints in mobile/web clients.
- IT administrators do not automatically view HR employee PII, candidate photos, payroll or chip data.
- Attendant device photo/raw citizen ID must not flow to IT package database; Kiosk uses revocable opaque card binding only.
- Reject requests from suspended/revoked devices and wrong tenant or site; rotate credentials and prevent replay.
- Subscription/payment features must not be switched on before IT billing schema/CRM mapping review, security tests, and customer data consent.
- Preserve existing POS package and billing flows; add Attendance family via separate additive migration and guarded UI integration after approval.
- Changes to Vercel production, Attendance Communications schema or POS database are expressly out of scope.

**Implementation order after this contract approval:** IT entitlement design and isolated tests → backend entitlement verification → HR Web + Android HR/Kiosk authorization → custom external API and optional POS add-on.

**Tracking:** Cpi-Attendance [plan PR #9](https://github.com/sstdevelopaminno/Cpi-Attendance/pull/9) and `docs/attendance-saas-hr-android-contract-20261029.md`.
