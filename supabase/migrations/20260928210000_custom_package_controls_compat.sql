-- CpIPOS-IT compatibility schema for package commercial controls (2026-09-28).
-- Primary authority migration lives in CpIPOS. Keep this idempotent because IT and POS
-- deploy independently against the same CpiPOS-001 control plane.

alter table public.subscription_packages
  add column if not exists monthly_discount_percent numeric(5,2) not null default 0,
  add column if not exists yearly_discount_percent numeric(5,2) not null default 0;

alter table public.store_registration_requests
  add column if not exists custom_requirements text,
  add column if not exists custom_terms jsonb not null default '{}'::jsonb;

create table if not exists public.tenant_custom_package_terms (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  package_id uuid not null references public.subscription_packages(id) on delete restrict,
  status text not null default 'draft'
    check (status in ('draft','approved','active','retired')),
  monthly_price numeric(12,2) not null default 0 check (monthly_price >= 0),
  yearly_price numeric(12,2) not null default 0 check (yearly_price >= 0),
  monthly_discount_percent numeric(5,2) not null default 0 check (monthly_discount_percent between 0 and 100),
  yearly_discount_percent numeric(5,2) not null default 0 check (yearly_discount_percent between 0 and 100),
  max_branches integer not null default 1 check (max_branches between 1 and 10000),
  max_devices integer not null default 1 check (max_devices between 1 and 10000),
  max_users integer not null default 1 check (max_users between 1 and 100000),
  retention_months integer not null default 6 check (retention_months between 1 and 120),
  max_products integer check (max_products is null or max_products between 1 and 10000000),
  monthly_bill_limit integer check (monthly_bill_limit is null or monthly_bill_limit between 1 and 100000000),
  storage_limit_gb numeric(12,2) check (storage_limit_gb is null or storage_limit_gb > 0),
  feature_overrides jsonb not null default '{}'::jsonb,
  notes text,
  version bigint not null default 1 check (version >= 1),
  approved_by uuid references public.users_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_custom_package_terms enable row level security;
revoke all on public.tenant_custom_package_terms from public, anon, authenticated;
grant select,insert,update,delete on public.tenant_custom_package_terms to service_role;

update public.subscription_packages
set retention_months=6,updated_at=now()
where quota_mode='standard' and retention_months is distinct from 6;

update public.subscription_packages
set monthly_price=0,yearly_price=0,retention_months=null,
    metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
      'contact_sales',true,'it_admin_managed',true,'custom_contract_required',true
    ),
    updated_at=now()
where code='custom';
