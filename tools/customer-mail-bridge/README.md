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
4. In **Project Settings → Script Properties**, configure:
   - `CPIPOS_MAIL_BRIDGE_SECRET` = the same server secret configured in Vercel.
   - `CPIPOS_SUPPORT_MAILBOX` = `cuttingpointtech.support@gmail.com`.
5. Deploy as **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
6. If an existing deployment is already used by Production, edit that deployment and publish a new version so the Web App URL remains unchanged.
7. In Vercel keep:
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
