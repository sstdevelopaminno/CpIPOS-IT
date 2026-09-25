# CpIPOS Phase 1 — A: Implementation contract / B: Subscription UI

Date: 2026-09-25. Scope: `sstdevelopaminno/CpIPOS-IT` + `sstdevelopaminno/CpIPOS`; distinct repositories and Vercel deployments. Shared billing authority: existing Supabase CpiPOS-001 (`deejlitaivfnsbwqdugy`). Do not create projects or reuse cashier sales transactions for subscription revenue.

## A — Architecture, data ownership and endpoints

| Area | Primary owner | Existing structures |
|---|---|---|
| Store and entitlement | IT + CpiPOS-001 | `tenants`, `subscription_packages`, `tenant_subscription_contracts`, `tenant_data_lifecycle` |
| Subscription intent/notice | POS owner -> IT review | `tenant_subscription_payment_requests` |
| Auditing | IT and POS server | `tenant_subscription_approval_events`, `audit_logs` |
| Billing cycle (not cashier shift) | IT billing | `tenant_billing_cycles` |
| Company receiving account | IT | `it_communication_settings`, never `tenant_payment_accounts` |
| Uploaded customer slip | POS writes, IT reads | Private storage bucket `subscription-payment-evidence` |

The customer `POS` screen /preview/pos/payments is an *application subscription payment center*, **not** the /api/pos/payments cashier endpoint, `orders`, `payments`, or `shifts`.

POS endpoints:
- `GET /api/pos/billing/overview`: authenticated store owner/manager, tenant ID derived solely from verified POS session; read-only current contract, lifecycle, allowed packages, issuer receiving account, historical requests and billing cycles.
- `POST /api/pos/billing/requests`: verified owner only, multipart form. `renewal_intent` creates a pending intention without claimed payment. `payment_notice` requires reported transfer amount and private evidence (up to 4 MB for hosting limits); neither creates a paid record or changes service access.
- The client generates one UUID per intended request, persists it for retries, and the server reads by ID before write. Unique partial index permits only one pending/under_review request per store (guard against double-submitting).
- Unsupported annual prices remain unselectable; never convert a monthly amount into a guessed yearly amount.

IT endpoints:
- `GET /api/it-admin/v1/subscription-payments`: tenant billing overview.
- `GET /api/it-admin/v1/subscription-payments/history/[tenantId]`: secure history plus short-lived signed slip URL, never exposes storage paths directly.
- `POST /api/it-admin/v1/subscription-payments/review/[requestId]`: administrative under_review or reject, CAS on previous status; reject requires note and creates approval-event and audit record.
- `GET/PATCH /api/it-admin/v1/subscription-payments/business`: editable company identity and bank account, VAT status cannot be toggled in customer-facing route.
- Existing IT contract control remains authoritative for manual admin changes and suspension; **do not** call legacy `app.approve_paid_subscription` for yearly/invoice settlements without a new atomic settlement flow: old routine always grants 30 days and can be invoked again.

## Billing state machine and guardrails

`pending` -> `under_review` -> `rejected` or, in future, verified/approved settlement. Supabase currently constrains the request status to `pending`, `under_review`, `approved`, `rejected`, `cancelled`; UI labels must map to these actual DB values, not invent `pending_review`.

Uploaded slip, parsed OCR, transfer reference, customer-reported amount, and bank alert mail are **not proof of funds**. No automatic unlock, extension, billing-cycle paid amount, or receipt from these alone.

Next gate for activation: independently trusted bank transaction/statement verification; reconcile recipient, amount, currency, unique bank transaction reference, window/time, and expected package snapshot; reject duplicates; require an immutable one-per-settlement ledger and atomic contract+life-cycle extension. Renew from max(current expiry, now), preserve true monthly/yearly term, use the same transaction to update billing cycle and contract, and fail closed if trial migration to primary is not complete. The existing 30-day manual approval RPC must be evaluated/replaced for this stage; currently **not invoked** by the new code.

## Documents and VAT

`quotation`: offer before payment, not evidence of receipt. `receipt`: issued immutable snapshot *after confirmed money received*, numbered and linked to transaction/billing cycle. Store legal issuer identity at issuance so later editing in IT does not alter old documents. Use temporary registered name บริษัท คัตติ้งพอยท์ เทค จำกัด / CUTTING POINT TECH CO., LTD.; company VAT registration is currently false: do not issue VAT tax invoices. Await the user's PDF reference to finalize the separate quotation/receipt templates and bank authorization before dispatching mail.

Changing billing_email/support_email changes contact/reply-to metadata, not an authorized Gmail sender. Real email dispatch needs an authenticated mail provider and dispatch audit/idempotency.

## B — POS UX based on screenshot

On /preview/pos/payments:
1. White top bar, blue brand accent: “แพ็กเกจและการชำระเงิน”, store identity and refresh.
2. Gradient navy/blue package hero with status, start, expiry, monthly/yearly interval; indicator for internal demo.
3. Compact 3 tiles: real days left, commercial cycle price, entitled branches/devices/users. Internal CUSTOM 999999 is shown as “ไม่จำกัด”; internal demo is not advertised as a zero-baht customer package.
4. Main tabs: ภาพรวม / ต่ออายุ / แจ้งชำระเงิน / ประวัติ / เอกสาร. Default overview with clear renewal and notice actions.
5. Left of payment notice: server-price proposal, transfer amount/date/name/reference, private slip attachment and notes; explicit pending verification notice.
6. Right rail: configurable COMPANY receiving bank account (not store cashier account), Support email/tel, collapsed LINE QR labelled “contact only”, not a payment QR.
7. Document tab: empty/disabled until immutable actual documents exist (no false receipt download).

Do not hide locked subscriptions behind a sales feature gate on the payment-center page; owner needs access to renewal.

## Acceptance / regression

- Owner can view only own store and submit a renewal intention; manager read-only; staff denied; IT-admin role checked fresh on IT routes.
- One open subscription request per tenant even under concurrent POST; repeated UUID does not double-charge or duplicate request. No service/unlock change from submitted slip.
- Slip stored in private bucket; only verified IT session can obtain 5-minute signed URL, not public product-media URL.
- Status/source/amount shown separately; never present a customer-reported amount as received bank money.
- No fake `฿0.00` price for Custom/internal demo, no `999999` cap displayed.
- Existing POS /api/pos/payments, orders, payments, receipts, shifts, shift reports and close-shift totals untouched.
- Typecheck, lint, unit/integration tests and production build pass for **both repos** before merge/deployment.
- Do not merge or deploy until run is green and the Vercel IT project/target environment has been positively identified.
