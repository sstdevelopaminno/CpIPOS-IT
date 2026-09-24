-- Tenant-scoped IT switches; absent row means enabled for legacy stores.
create table if not exists public.tenant_pos_menu_policies (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  menu_key text not null check(menu_key ~ '^(main|more|settings)\.[a-z_]+$'),
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key(tenant_id, menu_key)
);
create index if not exists tenant_pos_menu_policies_disabled_idx
  on public.tenant_pos_menu_policies(tenant_id) where not is_enabled;
alter table public.tenant_pos_menu_policies enable row level security;
revoke all on public.tenant_pos_menu_policies from public, anon, authenticated;
grant select, insert, update, delete on public.tenant_pos_menu_policies to service_role;
