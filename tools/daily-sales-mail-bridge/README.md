# Daily Sales Email — Company Mail Sender (CpiPOS IT)

This is a **send-only** Google Apps Script bridge for automatic Daily Sales Email per store.
It cannot read, search, modify or delete Gmail messages. Keep the existing Support
Mail bridge separate. An email's display name or Reply-To is NOT its sender address.

## Sender setup

1. Choose and confirm the actual company-owned Google email account authorized for sending.
   In CpiPOS IT → communication settings, `billing_email` must be the **same address**.
   Do not assume that changing the display name changes the sender.
2. Sign into Apps Script using that specific account. Create a separate project and paste
   `Code.gs`. Enable the manifest editor under **Project Settings → Show "appsscript.json"**,
   then replace its contents with the adjacent `appsscript.json`.
3. In **Project Settings → Script Properties** set:
   - `CPIPOS_MAIL_BRIDGE_SECRET` — new long random secret (keep server-side only).
   - `CPIPOS_COMPANY_SENDER_EMAIL` — the confirmed Google sender email.
   - optionally `CPIPOS_MAIL_MIN_REMAINING_QUOTA` (default 30).
4. Run `authorizeCompanyMailBridge` manually in the editor and approve the
   requested `userinfo.email` and `script.send_mail` OAuth scopes.
   The function MUST report the expected company account.
5. Deploy as a **Web App**, **Execute as Me**, **Who has access: Anyone**.
   The endpoint accepts only a shared secret and `status`/`send_transactional` actions.
6. In the **CpIPOS-IT Vercel project Production environment**, configure:
   - `CPIPOS_DAILY_SALES_MAIL_BRIDGE_URL` — corporate Web App /exec URL.
   - `CPIPOS_DAILY_SALES_MAIL_BRIDGE_SECRET` — secret from step 3.
   Then deploy the tested IT release once; do not change the existing Support bridge URL.
7. Confirm the IT **Daily Sales Email Operations** displays the chosen sender
   and a configured bridge. Preview a store and date with **at least one completed sale**.
   Send an IT-only test to the configured support test recipient before allowing automated sends.
   Never send a trial email to customers directly.

## Runtime safeguards

- Daily Sales Email and Daily Sales Email Test exclusively use the company bridge.
  The app rejects sends if these environment values are unset. **No Support fallback**.
- The bridge checks its authenticated effective user, its configured sender and the
  explicit expected sender from the IT server **before** calling MailApp.sendEmail.
- Recipient email comes from the current store's primary Owner, not other stores.
  Stores with email disabled, inactive owner, or no completed sales are excluded.
- The server keeps database idempotency keys, retry cooldown, automatic send budget
  and a provider quota reserve. Never replay a successful send when troubleshooting.
- The company sender setting is an operational mailbox address, **not a statement
  about legal registration, tax or VAT status**.
