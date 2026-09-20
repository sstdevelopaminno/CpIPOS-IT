# CpIPOS Tablet 1.0.23 — seven-track MDM release gate

Date: 2026-09-20. Scope: company-owned / company-financed **Android 1.0.23 Web Production tablets only**. CpIPOS Native 2.0 and customer-owned/BYOD devices are excluded from Full MDM.

## Evidence from source and read-only CpiPOS-001 check

- The supplied 404 screenshot title reads **CpIPOS**, which matches the *customer POS Windows WebView runtime* (`CpIPOS/apps/windows-runtime-native/.../MainForm.cs`), whereas this repository's IT runtime window title reads **CpIPOS IT Admin**. Do not claim the screenshot is fixed until the installed EXE/shortcut and its effective URL are identified. The independent IT runtime misrouting below is still a real defect.\n- CpIPOS-IT Windows runtime v0.1.1 pointed to the customer POS host `https://cp-ipos-web.vercel.app/it-admin/login` even though IT Admin has been split to a different app. Runtime 0.1.2 changes its target to `https://cp-ipos-it-web.vercel.app/it-admin/login`. The separate IT deployment/route must be confirmed reachable before publishing an installer.
- `apps/backoffice-web/src/lib/mdm/eligibility.ts` already gates Full MDM to Android 1.0.23 Web Production, company ownership, Android Device Owner, and advertised capabilities.
- `apps/pos-android/app/src/main/java/com/cpipos/pos/FullMdmAgent.kt` implements `diagnostics_ping`, `sync_policy` and Device Owner `lock_device` only. Other executors return `full_mdm_command_not_implemented`. Do not equate a command type in the IT UI/database with a working device-side feature.
- **Read-only production inspection on 2026-09-20:** `mdm_devices`, `mdm_commands`, `mdm_command_audit` and `mdm_remote_support_sessions` each had **0 records** in CpiPOS-001. Legacy `branch_devices` or app-level heartbeats are not proof of Full MDM enrollment.
- Never move Android 1.0.23 signing, customers, or Web Production to an unverified build. Keep stable 1.0.12 devices and FG0003 on existing behavior and preserve printer assignments.

## Seven deliverables and objective completion criteria

| # | Track | Required verification before declaring complete |
|---|---|---|
| 1 | IT Windows 404 / deployment | Identify which EXE produced the screenshot and its effective URL; correct IT host and /it-admin/login independently; Windows CI passes, deployed route serves login, and rebuilt installer is tested on Windows. |
| 2 | Enrollment and ownership | Device code + install identity paired and IT-approved, Android Device Owner established by legitimate managed provisioning, financing/company ownership recorded with evidence, no BYOD/Native 2.0 Full MDM. |
| 3 | Heartbeat / health | 1.0.23 runtime reports fresh native health + app version + real capabilities, IT shows online/offline and health age accurately, snapshots and incidents reconcile with legacy heartbeats. |
| 4 | Lock / unlock / financing policy | Test physical screen lock separately from CpIPOS app/access lock. Device Owner lockNow is supported today; implement a documented unlock/release policy supported by Android APIs and verified contract authority. Add confirmation, audit, expiry and device ACK; never claim a software app can bypass a device PIN. |
| 5 | Device location | Report last known fix + timestamp + accuracy + permission status; use runtime location permission and disclosure/consent. Handle location-disabled, offline, stale, denied and unsupported cases; never invent coordinates. |
| 6 | Remote screen support | Time-limited, audited, visible screen-sharing session on managed devices. Follow Android MediaProjection user-approval and foreground-service requirements; company-owned Device Owner alone does not grant unlimited invisible screen recording. Provide stop/revoke, no sessions lingering after expiry. |
| 7 | Command delivery / audit / rollout | Every command has queue/pickup/ACK/failure/expiry visible, scope and authorization checked server-side, no cross-tenant commands, no secret payload persistence, tests and canary proof before broader rollout. |

## Current development status

- Track 1: code fix and CI added to branch `fix/it-runtime-mdm-hardening-20260920`; deployment and installer are **not yet verified**.
- Track 3 / 6 / 7: IT console fixes on the same branch distinguish eligible from online, send valid attended-remote-support and package-name payloads, guard TTL input and keep responses uncached. **This is not proof of end-to-end execution.**
- Tracks 2 / 4 / 5 / 6: device-enrollment, location, remote screen and release/unlock need dedicated managed-device development and physical tests. No production Full MDM device has been confirmed enrolled.

## Rollout and security gate

1. CI and production IT route verification.
2. Pair **one company-controlled test Android 1.0.23 terminal** and verify Device Owner (never force-reset a customer device without authorization).
3. Heartbeat and safe diagnostics ping / policy sync.
4. Lock and supported unlock/release tests with emergency recovery, location and attended screen support tests with disclosure.
5. Confirm ACK and audit logs for success, failure, timeout and device offline; check privacy and financing agreement.
6. Internal store `900001` only, then 1–2 canaries after explicit approval; do not auto-roll out to other stores.

References: Android Enterprise device control https://developer.android.com/work/dpc/device-management ; Android MediaProjection https://developer.android.com/reference/android/media/projection/MediaProjectionManager ; managed dedicated devices https://developer.android.com/work/dpc/dedicated-devices/ .
