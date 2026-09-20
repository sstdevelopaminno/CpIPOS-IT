-- Independent customer applications.  Not the IT provisioning ledger.
-- No public/client Data API access.  Customer website submits through its server.
create table if not exists public.store_registration_requests (
  id uuid primary key default gen_random_uuid(),
  submission_key uuid not null unique,
  store_name text not null check (char_length(btrim(store_name)) between 2 and 180),
  business_type text not null check (char_length(btrim(business_type)) between 2 and 100),
  owner_name text not null check (char_length(btrim(owner_name)) between 2 and 180),
  owner_email text not null check (char_length(btrim(owner_email)) between 3 and 254),
  owner_phone text not null check (char_length(btrim(owner_phone)) between 8 and 40),
  package_id uuid not null references public.subscription_packages(id),
  sales_modes jsonb not null default '{"takeaway":true,"dine_in":false,"buffet_table":false,"delivery":false,"general_sale":false}'::jsonb
    check (jsonb_typeof(sales_modes) = 'object'),
  trial_days integer not null default 7 check (trial_days = 7),
  source text not null default 'website',
  consent_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','processing','failed','activated','deleted')),
  provision_request_key uuid not null unique default gen_random_uuid(),
  tenant_id uuid unique references public.tenants(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  deleted_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists store_registration_queue_status_idx
  on public.store_registration_requests (status, created_at desc)
  where deleted_at is null;
alter table public.store_registration_requests enable row level security;
revoke all on public.store_registration_requests from public, anon, authenticated;
grant select, insert, update on public.store_registration_requests to service_role;
comment on table public.store_registration_requests is 'Website applications pending IT manual approval; no PIN or password is stored in this queue.';
