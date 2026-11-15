# CpIPOS IT — separate sender accounts and verify Inbox delivery

## Mailbox ownership and event routing (release gate)

Use two **different Apps Script Web App deployments** owned by their respective Google accounts:

| Mail category | Event types | Sending Google account |
|---|---|---|
| Billing / company | `payment_confirmation`, `subscription_due_reminder`, `trial_expiry_reminder`, `tenant_deletion_warning` | `cuttingpointtech@gmail.com` |
| Support / product operation | `store_activation`, `sales_retention_export`, `daily_sales_summary`, `daily_sales_summary_test` | `cuttingpointtech.support@gmail.com` |
| Marketing / campaigns | NOT supported by `deliverCustomerEmail` | Use a separate opt-in campaign workflow and sender/provider; do not reuse either transactional Web App |

The display name and Reply-To are **not** proof of the Google account that sent the email. The actual account is the Apps Script **Execute as Me** deployer. A no-send authenticated `status` preflight validates the effective Google account before a transactional send.

### Staged, safe configuration

The change is opt-in. `CPIPOS_STRICT_MAIL_ROUTING` defaults to false, preserving the existing legacy `CPIPOS_MAIL_BRIDGE_URL` / `CPIPOS_MAIL_BRIDGE_SECRET` behavior. **Do not enable strict routing until both distinct deploys are authorized and verified**. No changes to running tenants, database records or customer deliveries are required.

1. **Main company / billing sender**: in Google Apps Script under `cuttingpointtech@gmail.com`, install `tools/billing-mail-bridge/Code.gs` and `appsscript.json`. Set Script Property `CPIPOS_BILLING_MAIL_BRIDGE_SECRET` to a strong secret (do not commit it). Run `authorizeBillingMailBridge` and approve the minimal `userinfo.email` + `script.send_mail` scopes. Deploy as Web App, **Execute as Me**, **Anyone**; the shared secret authenticates all POST requests. Publish a new version on future changes. This bridge intentionally contains no `GmailApp` and no inbox actions.
2. **Support sender**: in Apps Script under `cuttingpointtech.support@gmail.com`, apply `tools/customer-mail-bridge/Code.gs` and `appsscript.json`, set `CPIPOS_SUPPORT_MAILBOX=cuttingpointtech.support@gmail.com` and its existing Script Property `CPIPOS_MAIL_BRIDGE_SECRET`. Run `authorizeMailBridge` and grant Google permissions. Update the *existing* Web App deployment to the latest version without changing its URL. Keep Support Mail inbox permissions limited to this account.
3. In the real CpIPOS IT production deployment configure **server-only** env vars:
   - `CPIPOS_BILLING_MAIL_BRIDGE_URL`: main-account billing-only Web App /exec
   - `CPIPOS_BILLING_MAIL_BRIDGE_SECRET`: same value as main-account Script Property
   - `CPIPOS_SUPPORT_MAIL_BRIDGE_URL`: support-account Web App /exec
   - `CPIPOS_SUPPORT_MAIL_BRIDGE_SECRET`: same value as support account's `CPIPOS_MAIL_BRIDGE_SECRET`
   - `CPIPOS_STRICT_MAIL_ROUTING=true`: **last**, after both authenticated status checks and a reviewed deployment
4. Confirm `it_communication_settings.billing_email` and `support_email` match the respective Google accounts. Do not edit them just to work around an OAuth problem. The router blocks missing credentials, identical endpoint URLs, mismatched mailbox identities and unknown/marketing event types. It never silently reroutes failed billing mail to Support or vice versa.
5. Keep the existing customer-email ledger, 5-minute retry cooldown and automatic send budget. If strict routing produces configuration errors, disable it temporarily to return to the legacy route **only if that original route is still operational**; it is not a substitute for fixing Google OAuth.

### Delivery evidence — distinguish accepted vs received vs Inbox

- **App/audit**: `support_mail_sent` means Apps Script acknowledged the send; `customer_email_deliveries.status=sent` means the transactional provider accepted it.
- **Sent mailbox**: independently confirm From, recipient and timestamp, but SENT alone does not prove that a recipient received an email.
- **Recipient Inbox or Spam**: needs access to the intended recipient mailbox or the recipient's confirmation. Never infer this status from a sender's `SENT` label or successful SPF/DKIM/DMARC.
- **Headers**: check SPF, DKIM, DMARC, Reply-To and From. Authentication passing does **not** guarantee placement in Inbox.
- **Marketing**: use an explicit consent/opt-out-aware separate workflow. Do not send campaigns through billing or Support, and do not use customer-activation, reminder or payment notice templates as advertisements.

### Verified account-to-account checks (2026-11-15, Asia/Bangkok)

| Direction | Evidence | Limit |
|---|---|---|
| Support → Main | Support Mail UI test with subject `ทดสอบ`, 21:24; audit `support_mail_sent`; main Gmail contains the message and its headers report SPF/DKIM/DMARC PASS. Recipient status later became INBOX. | Cannot guarantee future customer Inbox placement |
| Main → Support | One non-customer test at the user's request: subject `CpiPOS \\| ทดสอบอีเมลองค์กรไปยัง Support \\| 15 พ.ย. 2569`; Gmail API returned message ID `1a1dfa78f8ef74e9`, label SENT. | Support Gmail is not connected for a recipient-side Inbox/Spam check |
| Old activated stores | Two store activation notifications remain failed with `Session.getEffectiveUser` OAuth error in `customer_email_deliveries` as of the latest read-only check. | Do not mass-resend or re-activate stores to test |

For a real end-to-end transactional check **after production cutover**, first run read-only status checks against the authenticated bridge for each account. Then, with the recipient's authorization, retry at most one existing failed activation using the IT UI after the cooldown. Verify that one ledger row updates to `sent` and ask the actual recipient to confirm Inbox vs Spam. Do not bulk-send, reset the ledger, replay trial reminders, or send PINs in email.

### Security considerations

- Never place Apps Script secrets in `NEXT_PUBLIC_` variables or source control.
- Keep the company and support Google accounts distinct; do not grant Support Mail inbox access to the billing bridge.
- Ensure billing email templates contain no marketing material. Sensitive access PINs must never be included in emails.
- For domain-branded mail at scale, separately evaluate a dedicated transactional email provider with verified sending domain; Gmail's authentication and deliverability can vary with recipient reputation and message characteristics.
