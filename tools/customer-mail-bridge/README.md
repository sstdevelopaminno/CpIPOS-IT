# CpIPOS IT — two Gmail roles and Apps Script bridges

Two **independent Gmail accounts** are required. Do not use one Google Apps Script Web App for both identities.

| Role | Gmail executor | Messages and purpose |
| --- | --- | --- |
| Company / transactional | `cuttingpointtech@gmail.com` | Store activation code and owner login information (never PIN); daily sales summaries; customer billing and other customer-facing system emails |
| IT Support / operations | `cuttingpointtech.support@gmail.com` | Support Mail inbox/replies in IT Control Plane; IT/LINE Support verification OTP; internal new-store-registration alerts |

`cuttingpointtech@gmail.Support.com` is **not** an email address. The correct original Support account is `cuttingpointtech.support@gmail.com`.

## Deployment checklist

This folder contains one `Code.gs` and one `appsscript.json`. Deploy the **same code version `2026-11-20.4`** in two separate Google Apps Script **projects**, with different Google executors and Script Properties.

**1. Company Web App**

- Sign into Google as `cuttingpointtech@gmail.com`.
- Open the existing company-owned `CpIPOS Mail Bridge` project, update `Code.gs` and `appsscript.json`.
- Script Properties: `CPIPOS_SUPPORT_MAILBOX=cuttingpointtech@gmail.com` and a private `CPIPOS_MAIL_BRIDGE_SECRET`.
- Run `authorizeSupportMailBridge` interactively in the Apps Script editor. Confirm that the execution log shows exactly `cuttingpointtech@gmail.com`.
- Deploy as Web App: **Execute as Me**, **Who has access: Anyone**; retain its existing `/exec` URL when updating an existing deployment.
- Vercel Production: `CPIPOS_MAIL_BRIDGE_URL` = this company's `/exec` URL, `CPIPOS_MAIL_BRIDGE_SECRET` = this project's Script Property secret.

**2. Dedicated Support Web App**

- Sign into Google as `cuttingpointtech.support@gmail.com`.
- Open or create a **different** Apps Script project owned/executed by the Support Google account. Copy in the matching latest `Code.gs` and `appsscript.json`.
- Script Properties: `CPIPOS_SUPPORT_MAILBOX=cuttingpointtech.support@gmail.com` and its **own** private `CPIPOS_MAIL_BRIDGE_SECRET` (use a different secret from the company script).
- Run `authorizeSupportMailBridge` interactively and confirm the execution log shows `cuttingpointtech.support@gmail.com`.
- Deploy as Web App: **Execute as Me**, **Who has access: Anyone**; use its distinct `/exec` URL.
- Vercel Production: `CPIPOS_SUPPORT_MAIL_BRIDGE_URL` = the Support `/exec` URL, `CPIPOS_SUPPORT_MAIL_BRIDGE_SECRET` = the Support Script Property secret. If `CPIPOS_SUPPORT_MAILBOX` is set in Vercel, it must equal `cuttingpointtech.support@gmail.com`.

Never paste either secret into GitHub, the browser, logs or a customer email. A server-side secret is mandatory for both scripts even if the Web App access is `Anyone`.

## Production routing and verification

- Customer-facing delivery uses the company bridge exclusively through `deliverCustomerEmail`. Before sending, the server makes a **no-send status check**, which must prove `cuttingpointtech@gmail.com`.
- The **คำขอเปิดร้าน → ตรวจสอบการเชื่อมต่อ Gmail** button checks the **company** bridge without sending. **ยืนยันใน Gmail Sent** reads the **company's** actual Sent folder, not the IT Support console.
- Daily sales test preview/recipient uses the billing/company address in `it_communication_settings.billing_email`. Regular daily sales emails go to the configured stores' owners through the company bridge.
- Internal new-store alerts use `sendSupportMail` to the dedicated **Support address only** and are tracked in `store_registration_alert_deliveries`.
- Support Mail console uses only the Support bridge for inbox, sent, thread actions, replies and manual messages. IT/LINE Support OTP that calls `sendSupportMail` uses this same bridge.
- The Support status endpoint `/api/it-admin/v1/support-mail?health=1` verifies **Support** OAuth; the company read-only health endpoint `/api/it-admin/v1/customer-emails/verify-sent?health=1` verifies **company** OAuth. Both require IT authentication.
- The server fails closed if the two `/exec` URLs are the same, either mailbox identity is wrong, or required bridge configuration is missing.

## Database contact settings

In CpiPOS-001 `it_communication_settings`, `billing_email` must be `cuttingpointtech@gmail.com`, while `support_email` must be `cuttingpointtech.support@gmail.com`. These are **contact/reply-to defaults**; the actual Gmail sender is determined by the Google Web App executor.

## Cutover safety

- **Do not** create stores again, re-provision owners or send PINs by email merely to repair delivery.
- Never auto-replay previously sent/failed activation notices. First verify the relevant no-send health check, then retry **one** failed activation individually, and inspect its Gmail Sent evidence.
- Keep each original mailbox's historic messages in its own Gmail account; changing a bridge does not migrate Sent history.
- Publishing GitHub code does **not** grant OAuth, deploy either Apps Script project, or update private Vercel environment variables. Configure both Google-owned Web Apps and the corresponding Production environment variables separately.
- When changing the Apps Script executor, do not assume changing the browser's signed-in account changes an old Web App's ownership. Create a new project under the right Google account if necessary.

## API surface and LINE verification

The bridge supports `status`, `list_threads`, `get_thread`, `send_new`, `reply`, `mark_read`, `archive`, `trash`, `trash_many`, plus backward-compatible `send_transactional`. Only server-side verified calls may use it. IT APIs require IT authorization and rate limiting. PINs and OTP contents must not be logged.

For LINE Support OTP, test only with a designated test store/owner and an authorized test identity. Confirm that a positive `sent:true` response came from **the Support mailbox**, verify code expiry and single-use semantics, and check that the Support chat opens only for the authorized customer.
