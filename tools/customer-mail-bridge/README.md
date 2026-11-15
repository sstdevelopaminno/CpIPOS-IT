# CpIPOS Gmail / Apps Script mail bridge

This bridge is the server-side Gmail boundary for **CpIPOS-IT**. It supports both:

- transactional customer email (store activation, payment confirmation, retention export); and
- the IT **Support Mail** console (Inbox, search, thread read, reply, new mail, mark-read, archive).

The Support Mailbox must be:

`cuttingpointtech.support@gmail.com`

`cuttingpointtech@gmail.com` remains the company/organization mailbox and must not be connected to the Support Mail console.

## One-time setup / upgrade

1. Sign in to **cuttingpointtech.support@gmail.com**.
2. Open the existing Google Apps Script project used by CpIPOS transactional mail.
3. Replace `Code.gs` with the current file from this folder.
4. In **Project Settings**, enable **Show "appsscript.json" manifest file in editor**. In the Apps Script editor, replace the manifest with this folder's [`appsscript.json`](./appsscript.json), or merge its `oauthScopes` into the existing manifest without deleting other required scopes. The bridge requires:
   - `https://www.googleapis.com/auth/userinfo.email` for `Session.getEffectiveUser()` and sender identity validation.
   - `https://www.googleapis.com/auth/script.send_mail` for `MailApp` transactional email.
   - `https://mail.google.com/` for `GmailApp` Support Mail.
5. In **Project Settings → Script Properties**, confirm these existing settings (never paste secrets into the repo):
   - `CPIPOS_MAIL_BRIDGE_SECRET` = the same server secret configured in Vercel.
   - `CPIPOS_SUPPORT_MAILBOX` = `cuttingpointtech.support@gmail.com`.
6. **Before publishing**, select and run `authorizeMailBridge` in the Apps Script editor while signed in as the mailbox above. Approve the Google OAuth consent for all required scopes. This function checks identity and mail permissions **without sending any email**. It must report authorization OK and a nonnegative remaining quota; if it fails, do not redeploy.
7. Deploy as **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (requests still require the shared secret).
8. Edit the **existing Production Web App deployment**, create a new version, and publish it so the URL stays unchanged. Save-only is not sufficient: Apps Script Web App deployments are pinned to a version.
9. In Vercel keep:
   - `CPIPOS_MAIL_BRIDGE_URL`
   - `CPIPOS_MAIL_BRIDGE_SECRET`
   - optional `CPIPOS_SUPPORT_MAILBOX=cuttingpointtech.support@gmail.com`

The browser never receives the shared secret or Gmail credentials.

## Support Mail actions

The bridge accepts server-authenticated actions:

- `list_threads`
- `get_thread`
- `send_new`
- `reply`
- `mark_read`
- `archive`

The IT UI uses plain-text Gmail bodies only. It does not render arbitrary Gmail HTML in the browser.

## Mailbox safety

The Apps Script checks its effective Google account against `CPIPOS_SUPPORT_MAILBOX`.
The CpIPOS-IT server independently verifies the mailbox returned by the bridge.
If the script is accidentally deployed under another Gmail account, Support Mail fails closed with a mailbox mismatch.

## Transactional email compatibility

The original transactional payload remains supported as `send_transactional`.
Existing database idempotency and the six-hour Apps Script cache still suppress fast duplicate sends.

## Duplicate protection

The database keeps one unique `event_key` per transactional business event. Failed/blocked attempts retain the existing retry cooldown. Support Mail replies and new manual messages are explicit IT actions and are rate-limited by the IT API.

## Safety

- PINs are never included in activation emails.
- Known mistyped recipient domains remain blocked by CpIPOS-IT.
- Gmail credentials are not stored in Supabase.
- `cuttingpointtech@gmail.com` is intentionally excluded from the Support Mail console.

## Recovery from 2026-11-15 `Session.getEffectiveUser` authorization failures

An already deployed Web App without the `userinfo.email` scope fails **before** `MailApp.sendEmail`; the Supabase ledger records `failed` despite successful store provisioning. Updating GitHub or Vercel **does not** update the Apps Script Web App or grant OAuth consent. The deployment owner must complete steps 4–8 above.

After reauthorization and new Web App version:
1. Verify the bridge version through the authenticated Support Mail status check: `2026-11-15.1` or later. Do not use a browser URL without the shared secret as a health check.
2. Retry **one known failed store activation** from IT → Store Registrations → **ส่งอีเมลเปิดระบบ** (after the 5-minute retry cooldown). Confirm the existing `customer_email_deliveries` row transitions `failed` → `sent` and appears once in the sender's Sent folder.
3. Only then retry other failed items individually. **Do not create a new registration, toggle activation, bulk resend, or reset delivery rows**. The ledger's `event_key` prevents duplicates.
4. Subscription reminders and daily sales summaries use the same bridge; check their latest delivery results after the fix. Do not replay old periodic messages indiscriminately.

Do not disable the effective-mailbox check to hide a permission error: it prevents using the wrong Google account for customer mail.
