-- Compatibility schema for Support Web Push. Canonical migration lives in CpIPOS.
-- VAPID secrets are operational data and are not committed.

create table if not exists public.support_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  audience_type text not null check (audience_type in ('it','store')),
  tenant_id uuid references public.tenants(id) on delete cascade,
  user_id uuid,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
alter table public.support_push_subscriptions enable row level security;
revoke all on public.support_push_subscriptions from public,anon,authenticated;
grant select,insert,update,delete on public.support_push_subscriptions to service_role;

create table if not exists public.support_push_config (
  id text primary key check(id='default'),
  vapid_public_key text not null,
  vapid_private_key text not null,
  subject text not null,
  updated_at timestamptz not null default now()
);
alter table public.support_push_config enable row level security;
revoke all on public.support_push_config from public,anon,authenticated;
grant select,insert,update,delete on public.support_push_config to service_role;
