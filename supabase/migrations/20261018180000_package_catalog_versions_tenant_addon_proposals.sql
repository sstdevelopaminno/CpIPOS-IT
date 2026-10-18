-- Phase 1: non-destructive, reviewable package catalog versions and tenant add-on quotations.
-- These tables contain NO active entitlements, payment authorizations or live plan mutations.
create table if not exists public.it_package_catalog_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.subscription_packages(id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  state text not null default 'draft' check (state in ('draft','approved','retired')),
  effective_at timestamptz not null,
  proposed_terms jsonb not null check (jsonb_typeof(proposed_terms) = 'object'),
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  created_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (package_id,version_no),
  constraint catalog_version_approval_pair check (
    (state = 'approved' and approved_by is not null and approved_at is not null)
    or (state <> 'approved' and approved_by is null and approved_at is null)
  )
);

create index if not exists it_package_versions_latest_idx
  on public.it_package_catalog_versions(package_id, version_no desc);
create index if not exists it_package_versions_approval_idx
  on public.it_package_catalog_versions(state,effective_at);

create table if not exists public.it_tenant_addon_proposals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  contract_id uuid not null references public.tenant_subscription_contracts(id) on delete restrict,
  addon_type text not null check (addon_type in ('quota','feature')),
  addon_code text not null check (char_length(addon_code) between 2 and 100),
  feature_code text references public.package_feature_catalog(code) on delete restrict,
  quantity integer not null check (quantity between 1 and 100000),
  billing_interval text not null check (billing_interval in ('monthly','yearly','one_time')),
  currency text not null check (currency in ('THB','LAK','USD')),
  unit_price numeric(15,2) not null check (unit_price >= 0),
  total_price numeric(15,2) generated always as (quantity * unit_price) stored,
  state text not null default 'draft' check (state in ('draft','approved','cancelled')),
  effective_after_payment boolean not null default true,
  reason text not null check (char_length(btrim(reason)) between 5 and 1000),
  created_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint addon_feature_shape_chk check (
    (addon_type = 'feature' and feature_code is not null and feature_code = addon_code)
    or (addon_type = 'quota' and feature_code is null and addon_code in
      ('extra_branch','extra_device','extra_user','extra_storage_gb'))
  ),
  constraint addon_proposal_approval_pair check (
    (state='approved' and approved_by is not null and approved_at is not null)
    or (state<>'approved' and approved_by is null and approved_at is null)
  )
);

create index if not exists it_addon_proposals_tenant_idx
  on public.it_tenant_addon_proposals(tenant_id,created_at desc);
create index if not exists it_addon_proposals_state_idx
  on public.it_tenant_addon_proposals(state,created_at desc);

alter table public.it_package_catalog_versions enable row level security;
alter table public.it_tenant_addon_proposals enable row level security;
revoke all on table public.it_package_catalog_versions from anon,authenticated;
revoke all on table public.it_tenant_addon_proposals from anon,authenticated;
grant select,insert,update on table public.it_package_catalog_versions to service_role;
grant select,insert,update on table public.it_tenant_addon_proposals to service_role;

comment on table public.it_package_catalog_versions is
  'IT-only version proposals; approval and effective_at do NOT mutate the live package or existing contracts. Future migration of new-business pricing is a separate release gate.';
comment on table public.it_tenant_addon_proposals is
  'IT-only additive quotations; approvals do NOT grant rights, modify quotas, create bills, or confirm financial settlement.';
