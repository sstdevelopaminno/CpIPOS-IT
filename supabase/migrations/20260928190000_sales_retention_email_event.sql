-- IT email compatibility for CpIPOS sales-retention archive notifications.
-- Safe to apply even when the primary data-plane migration already created these fields.

alter table public.it_communication_settings
  add column if not exists auto_send_sales_retention_export boolean not null default true;

alter table public.customer_email_deliveries
  drop constraint if exists customer_email_deliveries_event_type_check;

alter table public.customer_email_deliveries
  add constraint customer_email_deliveries_event_type_check
  check (event_type in ('store_activation','payment_confirmation','sales_retention_export'));
