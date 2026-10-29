# Cpi-Attendance SaaS — IT Subscription & Support contract (subscriber-operated HR, 2026-10-29)

**Cross-repo owner**: IT source of truth is `sstdevelopaminno/CpIPOS-IT`, Attendance application and tenant-isolated employee events belong in `sstdevelopaminno/Cpi-Attendance`.

## User-approved business design
IT is the **commercial subscription/package and technical support authority only**. It controls the catalog, subscription term/status and purchased quotas, but **NOT** an individual tenant's HR operations, people, device registration, hardware approvals, Android mode permissions or operational API credentials. The paying subscriber's Owner/HR Admin self-manages all of those without IT permission. One Attendance service can be sold as full HR Web + Android HR reader + Kiosk + Employee PWA, POS add-on, or external-HR API-only with any customer-selected subset. Avoid forcing a paid CpiPOS POS subscription on standalone customers.

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
- Device registry — **belongs in the Attendance tenant HR backend**, not CpIPOS-IT. Subscriber Owner/HR Admin alone pairs/revokes devices, chooses sites and selects `HR_ENROLLMENT` vs `EMPLOYEE_KIOSK` modes within purchased quotas. IT has no approve-device workflow.
- External API integration clients — **subscriber-managed** scoped credentials, expiry, rotation and webhook settings in its HR/integration area; IT determines only whether the contract includes API access and any commercial quotas.
- Attendance maps IT tenant ID to private Attendance organization UUID. Do not reuse POS sales IDs as employee primary keys.

### Provision / activation / suspension flow
1. IT opens the paid Attendance service/subscription, assigning purchased features and limits (e.g., available HR/Kiosk module and maximum device count) only. Subscriber Owner/HR Admin completes the organization profile and all operational settings.
2. IT sends authenticated entitlement update (versioned, signed server-to-server event or other trusted control plane channel).
3. Attendance API validates and stores only necessary entitlement snapshot; HR Web and APK *display* allowed menus but server enforces restrictions on **every protected operation**.
4. Subscriber Owner/HR Admin creates/invites HR users and self-registers, assigns, changes and revokes devices **immediately within quota**; no IT operator approval. The subscriber configures distinct Android HR and Kiosk mode access and optional mode credentials.
5. On expiry/suspend, Attendance server rejects new privileged writes according to contract. Ensure regulated retained records and lawful data export remain accessible by separately defined read-only policy; never silently delete employee data.
6. On renewal or custom order, IT publishes new entitlement version, audits approver, effective period and history. Audit discrepancies and reconcile periodically.

### Explicitly supported external-HR scenario
Customer buys Android HR capture and Employee PWA and uses a third-party HR dashboard, not Cpi-Attendance HR Web. IT enables the contractual `ATT_EXTERNAL_API` feature only; the subscriber independently creates, rotates and revokes its own org-scoped API credentials in HR settings. Customer HR uses its own internal employee/shift/payroll system, manages its Attendance API credentials and devices directly, while Attendance APIs handle authorized mobile capture and time events. Employee payslips show **only when payroll data is supplied via authorized integration**, not automatically from card or time event data.

### Safety requirements
- Do not expose IT service keys, Supabase `service_role` or subscription editing endpoints in mobile/web clients.
- IT administrators do not automatically view HR employee PII, candidate photos, payroll or chip data.
- Attendant device photo/raw citizen ID must not flow to IT package database; Kiosk uses revocable opaque card binding only.
- Attendance API rejects requests from subscriber-revoked devices and wrong tenants/sites; subscriber HR can revoke/rotate device credentials without contacting IT. Independently reject suspended commercial subscriptions based on package status.
- Subscription/payment features must not be switched on before IT billing schema/CRM mapping review, security tests, and customer data consent.
- Preserve existing POS package and billing flows; add Attendance family via separate additive migration and guarded UI integration after approval.
- Changes to Vercel production, Attendance Communications schema or POS database are expressly out of scope.

**Implementation order after this contract approval:** define package-only IT entitlement contract → backend checks purchased features/quotas → tenant Owner/HR Admin self-service device and mode settings → HR Web + Android HR/Kiosk + optional external integration and POS add-on.

**Tracking:** Cpi-Attendance [plan PR #9](https://github.com/sstdevelopaminno/Cpi-Attendance/pull/9) and `docs/attendance-saas-hr-android-contract-20261029.md`.

## Binding product-owner correction — 2026-10-29

No `IT device approval`, `IT device pairing`, `IT kiosk mode password`, `IT HR employee provisioning` or `IT API client management` workflows may be added for Cpi-Attendance. These operations are the paying organization's responsibility and are performed by its own Owner/HR Admin in the HR application. IT may sell module availability and set quotas (e.g., max registered Android devices) and provide support, **not** configure those devices. The limit check is automatic, not an IT approval gate. Support access to tenant HR data/devices must be specifically consented to by that subscriber and audited, with no implicit IT access.

**Separate duties:** CpIPOS-IT = package catalog, subscription activate/suspend/renew, purchased limits, billing and support. Cpi-Attendance tenant Owner/HR Admin = add/edit/revoke devices and Android modes, create mode access controls, staff roles, branches, attendance rules, card associations and optional integration keys. This follows CpiPOS's commercial/tenant separation and does not alter existing POS behavior.
