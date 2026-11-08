# Store applications → IT approval → CpIPOS POS tenant

- Public form: `/register-store` (CpIPOS-IT web deployment), server API `/api/store-registration`.
- IT navigation: **คำขอเปิดร้าน**, `/it-admin/store-registrations`, authorized by `requireItAdmin`.
- Authority: CpiPOS-001 `public.store_registration_requests` (migration `20260920194500_store_registration_requests.sql`). This **does not** reuse the `it_store_provisioning_requests` ledger for pre-approval customer leads.
- Data written before approval: store name/type, owner name/phone/email, desired package, selected POS modes, consent timestamp, and status `pending`. No password, PIN, store code, tenant or branch created on website submission.
- IT can edit unprocessed requests, soft delete pending/failed requests with no provisioning ledger, or manually activate using six-digit POS Owner employee code and six-digit PIN. API refuses duplicate processing/activation.
- Activate calls **existing** `provisionStore` with immutable `provision_request_key` (request idempotency). Its CpiPOS-001 RPC creates tenant/store code, trial subscription contract, 7-day lifecycle, branch `001 / สาขาหลัก`, PIN login policy and Owner identity. The request does **not** activate paid subscription.
- Selected `takeaway`, `dine_in`, `general_sale` persisted to contract `metadata.sales_modes`; other modes disabled. User can adjust modes in tenant control center later.
- The POS terminal name `เครื่องขาย 1 (รอจับคู่)` is a *display-only onboarding description*, **not** a fabricated active device. Existing `branch_devices` and enrollment/security policies require a physical install identity plus proper pairing/activation. Creating a fake `branch_devices` row as an active terminal risks exhausting package quota and breaking real enrollment.
- Never place `service_role` in a browser or NEXT_PUBLIC_ variable. Both APIs use the existing server-only primary Supabase client. The registration table enables RLS and revokes anon/authenticated direct data access.
- The public entrypoint currently belongs to the separate IT web host and is not yet linked from the external company website; confirm the actual customer marketing domain and create a link after preview review.
- For production abuse resistance configure the existing RATE_LIMIT_BACKEND=upstash with UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, rather than relying solely on per-instance memory limits. Add bot protection before large public promotion.

## Review / verification

1. Check migration exists and is RLS-enabled. No test/customer application inserted by development.
2. Validate PR CI: TypeScript, lint, tests, production build; confirm Vercel Preview and public form response in browser.
3. Submit one authorized non-customer test application through public form. Check it appears in IT queue without a Tenant.
4. Approve only on explicit operator action. Confirm one tenant, one branch, Owner hash, Store Code, trial expiry 7 days, mode metadata; repeat activation must be blocked.
5. Pair an actual test POS device using existing device onboarding; only then label it Online/Active.

## Recovery notes

- If the provisioning core succeeds but Owner/mode/finalize step fails, keep the same `provision_request_key` and re-enter the **same** PIN/Owner code to retry without creating a second tenant.
- A failed request whose `it_store_provisioning_requests` ledger exists may not be edited or deleted through the ordinary request UI. Recover it through an audited IT-admin process; never delete a real partial tenant automatically.
- Public application table soft-delete only; stores already activated remain controlled by Tenants / Stores.


## New application alerts / Support escalation (2026-11-08)

- Source: a successful public \`POST /api/store-registration\` inserts one row into \`store_registration_requests\`. DB trigger queues **exactly one** service-only delivery receipt in \`store_registration_alert_deliveries\` using the registration UUID. Existing customer rows are **not** backfilled or mailed again.
- IT Admin and IT Support each get a dedicated badge beside **คำขอเปิดร้าน**. The count is \`pending + failed\` (not payment requests), from authenticated \`GET /api/it-admin/v1/store-registrations/alert-summary\`. Poll every 15 seconds while the page is visible, refresh on focus, and show a clickable popup on unseen records. Browser/OS notifications use the existing opt-in IT Web Push subscription; without permission the in-app popup still works.
- The public form schedules both IT Web Push and email **after the database write** using Next.js \`after()\`, so SMTP/Google Script delays do not turn a saved customer request into a failed form response. Push uses \`audience: it\`, \`kind: request\`, and \`/it-admin/store-registrations\`, independent of payment alerts.
- Support notification email is sent to **cuttingpointtech@gmail.com** and a copy to the configured **CpIPOS Support mailbox** (\`cuttingpointtech.support@gmail.com\` by default) via the existing server-only Support Mail Bridge, with **[IT Support]** in the subject; Support can also open it under **อีเมล Support**. It does not send to the applicant or activate their store.
- Delivery receipt is claimed with a status + attempt-count compare-and-set. A transient failure is recorded and may be retried by an authenticated IT session (immediately on load and every 2 minutes), with cooldown and recovery of stale \`sending\` claims. Delivery is **at least once**, not mathematically exactly once: a gateway crash after sending but before marking the receipt may generate one duplicate on recovery.
- Production preflight: first apply migration \`20261108005638_store_registration_support_alerts_20261108\` to existing \`CpiPOS-001\`; verify service-only access, trigger and empty outbox. Ensure \`CPIPOS_SUPPORT_MAIL_BRIDGE_SECRET\` (or \`CPIPOS_MAIL_BRIDGE_SECRET\`) and the existing Google Apps Script Support Mail deployment are configured; never expose their values. Confirm recipient mailbox with \`CPIPOS_SUPPORT_MAILBOX\` if overridden. Do not create replacement Supabase or Vercel projects.
- Acceptance: submit one **authorized test application** with a fresh submission UUID; confirm a single outbox receipt, badge count and popup, IT Web Push on an enrolled device, a single alert email to management and Support inbox, and that duplicate submission does not send a second message. Then approve/delete only that test request via normal audited IT workflow.
