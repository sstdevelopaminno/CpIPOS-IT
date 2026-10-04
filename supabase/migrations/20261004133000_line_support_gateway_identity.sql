-- LINE OA / LIFF external support identity gateway.
-- Store codes remain identifiers only. First-time binding requires a verified
-- LINE identity plus an OTP delivered to the tenant primary owner's email.
-- These tables are server-only control-plane state on CpiPOS-001.

create extension if not exists pgcrypto;

create table if not exists public.line_support_bindings (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null check (char_length(line_user_id) between 8 and 160),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  verified_owner_user_id uuid references public.users_profiles(id) on delete set null,
  line_display_name text,
  line_avatar_url text,
  is_active boolean not null default true,
  verified_at timestamptz not null default now(),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (line_user_id, tenant_id)
);

create index if not exists line_support_bindings_tenant_idx
  on public.line_support_bindings (tenant_id, is_active, updated_at desc);

create table if not exists public.line_support_verification_challenges (
  id uuid primary key,
  line_user_id text not null check (char_length(line_user_id) between 8 and 160),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  owner_user_id uuid not null references public.users_profiles(id) on delete cascade,
  otp_hash text not null check (char_length(otp_hash) = 64),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 10),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists line_support_verification_lookup_idx
  on public.line_support_verification_challenges
    (tenant_id, line_user_id, expires_at desc);

alter table public.line_support_bindings enable row level security;
alter table public.line_support_verification_challenges enable row level security;

revoke all on public.line_support_bindings from public, anon, authenticated;
revoke all on public.line_support_verification_challenges from public, anon, authenticated;
grant all on public.line_support_bindings to service_role;
grant all on public.line_support_verification_challenges to service_role;

comment on table public.line_support_bindings is
  'Server-only binding between a verified LINE user and a CpIPOS tenant for external Support Chat entry.';
comment on table public.line_support_verification_challenges is
  'Short-lived hashed owner-email OTP challenges for first-time LINE Support binding. Plaintext OTP is never stored.';
