# CpIPOS Subscription Payments — IT Phase 1

## Source of truth
Existing CpiPOS-001 tables: `tenants`, `tenant_subscription_contracts`,
`subscription_packages`, `tenant_billing_cycles`,
`tenant_subscription_payment_requests`, `tenant_subscription_approval_events`,
`tenant_data_lifecycle`. The current existing subscription lock scheduler stays in place.
The POS business-sales `payments` table is **not** subscription-billing evidence.

## Delivered first slice
IT menu **ตารางชำระแพ็กเกจ** under Packages & Access:
- one row per tenant, latest contract, package, monthly/yearly interval, service status,
  start/end dates, days left, current amount/currency, latest cycle and payment request;
- IT admin only, no-store GET and server-side joining through the primary Supabase;
- email draft action for the canonical primary owner's email; clearly labelled draft,
  never claims actual dispatch, and never includes a false paid receipt;
- configurable billing and support contact addresses + sender display names with
  IT-only audited update (no credentials in the database).

The snapshot can display zero payment requests or billing cycles accurately.
A complete receipt cannot be produced just because a contract is active.

## Receipt/quotation visual reference
Provided `QT-25690804-001` file is **Quotation**, not a receipt. Reuse its
clean blue/white single-page layout: company logo and registered legal identity,
customer pane, document number/dates, service line table, subtotal/VAT where
applicable, paid total, remarks and sign-off. A payment receipt must instead
include receipt number, date received, actual verified transaction reference,
payment method, paid period, invoice reference, and legal issuer information.
Never use quotation status `แบบร่าง` on a paid receipt. Do not invent VAT treatment.
Confirm currently registered legal company name and VAT/e-Tax status before
enabling financial/tax document issuance; company marketing name can differ
from legal document issuer.

## Email architecture (enable only after sender authorization)
Consumer Gmail + Google Apps Script MailApp is an optional pilot (quota applies).
An Apps Script must be **owned/authorized by the sending Gmail account**, not
a script that impersonates any arbitrary contact address. Changing the billing
and Support emails in IT modifies contact/reply-to values only; switching actual
senders additionally requires authorizing the new Gmail identity.
Suggested path: IT server creates queued message with idempotency key;
server-to-server authenticated bridge or OAuth Gmail API dispatches it,
returns message id; record sent/error/retry. Never expose bridge URL or key to POS.
Do not send receipts without verified payment and an immutable issued document.
Separate company's billing mailbox and Support mailbox sender configuration.
Email ingestion of bank alerts is a notification/reconciliation signal, not
sufficient independent confirmation for auto-activation.

## Transactional email delivery (implemented 2026-09-27)
The IT control plane now supports both manual and automatic customer email for:
- Store activation: sent after the store/Owner/branch are successfully created.
- Verified package payment: sent only after Settlement atomically opens/renews the package and issues a real receipt.

Delivery is fail-soft: email failure never rolls back a successful store activation or verified financial settlement.
The `customer_email_deliveries` ledger uses a unique event key per registration/receipt, so automatic and manual actions converge on the same record and a successful event is not sent twice. Failed network attempts are throttled for five minutes. Common mistyped domains (for example `amil.com`) are blocked for IT correction rather than auto-corrected.

Automatic delivery can be enabled/disabled independently in IT email settings. Manual buttons remain available for activated stores and issued receipts. Manual retry resolves the current primary Owner email, so an address corrected after the original event can be used safely.

Actual dispatch is server-side through the authorized Google Apps Script MailApp bridge in `tools/customer-mail-bridge`. Required deployment secrets:
- `CPIPOS_MAIL_BRIDGE_URL`
- `CPIPOS_MAIL_BRIDGE_SECRET`

PINs are never included in customer email.

## Remaining follow-up
1. Monitor Gmail quota and delivery failures from the email ledger.
2. Add scheduled pre-expiry reminders only after a separate reminder cadence and opt-out policy are approved; do not reuse transactional event keys for marketing/reminder traffic.
