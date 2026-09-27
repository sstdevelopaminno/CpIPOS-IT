-- Transactional customer email delivery for store activation and verified package payments.
-- The DB owns idempotency so automatic and manual actions cannot repeatedly send the same event.

alter table public.it_communication_settings
  add column if not exists auto_send_store_activation boolean not null default true,
  add column if not exists auto_send_payment_confirmation boolean not null default true;

create table if not exists public.customer_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('store_activation','payment_confirmation')),
  event_key text not null unique,
  tenant_id uuid references public.tenants(id) on delete cascade,
  source_id uuid not null,
  recipient_email text not null,
  subject text not null,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','blocked','failed')),
  trigger_mode text not null check (trigger_mode in ('automatic','manual')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  provider text,
  provider_message_id text,
  created_by uuid references public.users_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_email_deliveries_tenant_created_idx
  on public.customer_email_deliveries(tenant_id, created_at desc);
create index if not exists customer_email_deliveries_status_idx
  on public.customer_email_deliveries(status, updated_at desc);

alter table public.customer_email_deliveries enable row level security;
revoke all on table public.customer_email_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.customer_email_deliveries to service_role;

comment on table public.customer_email_deliveries is
  'IT-only transactional customer email ledger. event_key is unique so store activation/payment confirmation is sent at most once per source event.';
comment on column public.customer_email_deliveries.event_key is
  'Stable idempotency key such as store_activation:<registration_id> or payment_confirmation:<receipt_id>.';
