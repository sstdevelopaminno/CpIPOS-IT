# CpIPOS Gmail / Apps Script mail bridge

This bridge is the server-side Gmail boundary for **CpIPOS-IT**. It supports both:

- transactional customer email (store activation, payment confirmation, retention export); and
- the IT **Support Mail** console (Inbox, search, thread read, reply, new mail, mark-read, archive).

The canonical CpIPOS IT **Support Mail and transactional sender** is now:

`cuttingpointtech@gmail.com`

This cutover replaces the former `cuttingpointtech.support@gmail.com` sender. Historic messages in the old mailbox remain there; this change does not transfer or delete old Gmail messages. The actual sender is the Google account executing the Apps Script Web App, **not** a configurable From label.

## Mailbox cutover safeguards (2026-11-20)

- The IT web app checks `CPIPOS_SUPPORT_MAILBOX` for stale configuration, and the Apps Script rejects a legacy `CPIPOS_SUPPORT_MAILBOX` Script Property. Neither can silently authorize the previous account.
- Transactional email executes a read-only `status` request before sending, rejecting a bridge whose effective Gmail account is not **cuttingpointtech@gmail.com**. The response must also confirm the same mailbox.
- Do **not** attempt to authenticate an Apps Script still owned and deployed as the old Gmail account by merely editing the email address in its code.
- Update the **Production** Vercel project only after the new Web App deployment URL is known. A GitHub merge alone cannot migrate Apps Script ownership, change Script Properties or grant OAuth consent.
- Existing `customer_email_deliveries` history and prior Gmail Sent messages are preserved. Recheck failed messages only after the new preflight succeeds. Do not resend already-sent messages automatically.
- Changing `it_communication_settings.support_email` affects contact/reply-to information. The actual sender requires the Google Apps Script executor migration above.

## One-time setup / upgrade

1. Sign in to **cuttingpointtech@gmail.com** in Google.
2. The Web App must execute under this exact account. If the existing Apps Script is owned/deployed under `cuttingpointtech.support@gmail.com` and its executor cannot be transferred to the new owner, **make a copy in the new account** and deploy that copy as a new Web App. Do not assume switching the editor's signed-in Google account changes an existing Web App's execution identity. Keep the old Web App until the new status preflight passes.
3. Replace `Code.gs` with the current file from this folder.
4. In **Project Settings**, enable **Show "appsscript.json" manifest file**
   and use the `appsscript.json` file in this folder. It explicitly declares
   `userinfo.email`, `script.send_mail`, and `mail.google.com/` scopes.
   While signed into the **Support** Google account, run
   `authorizeSupportMailBridge` directly in the Apps Script editor and
   grant the scopes in the Google OAuth dialog. Confirm the returned mailbox
   is exactly `cuttingpointtech@gmail.com` before deploying.
5. In **Project Settings → Script Properties**, configure:
   - `CPIPOS_MAIL_BRIDGE_SECRET` = the same server secret configured in Vercel.
   - `CPIPOS_SUPPORT_MAILBOX` = `cuttingpointtech@gmail.com` (do not retain the former address).
6. Deploy as **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
7. For an Apps Script already owned by `cuttingpointtech@gmail.com`, edit the existing deployment and publish a new version so its URL stays unchanged. If moving from the old Support-owned Apps Script to a **new project**, deploy a new Web App and update the canonical Vercel URL to its newly issued `/exec` address.
8. In **CpIPOS IT Production** Vercel, use ONE mail bridge for transactional delivery and Gmail Sent verification:
   - `CPIPOS_MAIL_BRIDGE_URL` = the **new-account-owned** Apps Script Web App `/exec` URL
   - `CPIPOS_MAIL_BRIDGE_SECRET` = matching Script Property secret
   - optional `CPIPOS_SUPPORT_MAILBOX=cuttingpointtech@gmail.com`; remove/replace any old value or the IT app will fail closed
   - If older `CPIPOS_SUPPORT_MAIL_BRIDGE_URL` / `CPIPOS_SUPPORT_MAIL_BRIDGE_SECRET` variables exist, either remove them or ensure they match the canonical pair exactly. A mismatch is now reported as `support_mail_bridge_config_mismatch` rather than silently inspecting a different Gmail connection.

In **IT Admin → คำขอเปิดร้าน**, use **ตรวจสอบการเชื่อมต่อ Gmail** first: it is a read-only status probe that verifies the Support owner and Bridge version, does not send a message, and does not change a store's mail attempt counter. When healthy, retry a failed activation only once; the **ยืนยันใน Gmail Sent** action separately checks the Gmail Sent folder and shows the matching send time.

The browser never receives the shared secret or Gmail credentials.

## Incident recovery: missing `Session.getEffectiveUser` OAuth grant (2026-11-19)

Production delivery records confirm a missing `userinfo.email` authorization in
the **deployed Apps Script**, even though the version-controlled
`appsscript.json` already contains that scope. Editing GitHub, rerunning
Vercel or retrying the same email **cannot grant Google consent**.

The signed-in owner of the **new** `cuttingpointtech@gmail.com` sender must (after the account cutover):

1. Open the Apps Script Web App owned by the new sender (new project if copied from the old account).
2. Compare its `Code.gs` and `appsscript.json` with this folder; ensure
   `oauthScopes` includes `userinfo.email`, `script.send_mail`, and
   `mail.google.com/`.
3. From the editor, run `authorizeSupportMailBridge` interactively and grant
   all required permissions. Confirm it returns the expected Support address.
4. Go to **Deploy → Manage deployments → Edit** and choose **New version**
   for the new-account-owned project. Confirm **Execute as Me**. If using a copied project, use its **new URL** in Vercel.
5. Verify using the existing IT Support Mail status/health action without
   emailing a customer. Only after the bridge is healthy, press
   **ส่งอีเมลเปิดระบบ** on one affected activated registration.
6. Confirm `customer_email_deliveries.status = 'sent'` and the Gmail Sent
   message. Repeat individually for remaining failed records, respecting
   the service's cooldown and event-key duplicate protection.

Never replay store provisioning or create another Owner to fix email delivery.
A failed activation email does **not** mean store activation failed. Initial
Owner employee codes may be emailed, but PINs must be provided through a
separate authenticated channel; the mail bridge deliberately excludes them.

## OAuth-constrained Web App fallback (2026-11-19)

Some Web App execution contexts fail the live `Session.getEffectiveUser`
identity check despite having a correctly configured Support executor. Bridge
version `2026-11-19.3` retains that check when available and accepts a
**90-day owner-attested fallback** only when the check throws the known OAuth
scope error or returns no identity.

**Mandatory preflight before deploying this version:**

1. In the **new-account-owned** Apps Script project, open `cuttingpointtech@gmail.com`,
   compare and merge current `Code.gs` with the checked-in changes. Do not
   overwrite newer custom logic blindly.
2. Confirm `appsscript.json` contains `userinfo.email`,
   `script.send_mail`, and `mail.google.com/` scopes. In the editor, select
   `authorizeSupportMailBridge`, click Run and complete the Google OAuth
   consent. **Read the execution log** for the verified Support account.
3. That function writes `CPIPOS_VERIFIED_SUPPORT_MAILBOX` and
   `CPIPOS_VERIFIED_SUPPORT_MAILBOX_AT` to script properties only after
   it successfully checks the real executor, Gmail access and MailApp quota.
   **Never manually set or fake these attestation properties.**
4. Deploy the new-account-owned Web App with **Execute as Me**. Use its URL in
   Vercel (update it when moving to a copied project); keep the secret server-side.
5. Test a no-send Support Mail status request; then retry one failed activation
   with the existing IT idempotent send action. Confirm `sent` in the delivery
   ledger and the Support Gmail Sent folder before retrying any other stores.

If the preflight has never succeeded, is older than 90 days, or is for the
wrong account, the bridge fails closed with
`support_mailbox_authorization_required`. The browser/client cannot supply
an executor identity. To avoid repeated OAuth-related downtime, renew the
attestation before the 90-day expiry. No change is needed to customer records.

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
- `cuttingpointtech@gmail.com` is the **only** approved Support Mail executor; the former Support Gmail is rejected.

## LINE Support OTP production verification

The first-time LINE Support verification flow uses `sendSupportMail` and
requires a positive `sent:true` acknowledgement from this exact Support
mailbox. The operational prerequisites above are mandatory.

To verify safely, use a **designated test store/Owner and a fresh test LINE
identity**. Do not send an unsolicited OTP to a real customer.

1. In the authorized Support Apps Script editor run
   `authorizeSupportMailBridge` with the correct account; inspect remaining
   Gmail quota and grant any requested permissions.
2. Update the existing Web App **deployment version** to use the new code
   and manifest. Do not publish an alternative URL unless Vercel config is updated.
3. Confirm that IT Production's `CPIPOS_MAIL_BRIDGE_URL` and
   `CPIPOS_MAIL_BRIDGE_SECRET` point to the new-account-owned script. Remove
   obsolete Support-only URL/secret overrides, or set them to the identical pair.
4. From a fresh test LINE account request one OTP for the test Owner,
   check the actual Gmail From and whether the 6-digit code arrives.
5. Verify the code once, check that the chat appears in IT, and confirm
   reuse, expiry, and a changed Owner cannot bypass verification.
6. Do not include the plaintext OTP, hashed challenge or recipient email
   in logs or GitHub issues. If Google asks for consent, only the Google
   account owner can approve that permission.

A GitHub commit alone cannot grant Google OAuth consent, update a bound
Apps Script Web App deployment or prove that a real OTP was delivered.
