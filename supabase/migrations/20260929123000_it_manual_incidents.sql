create table if not exists public.it_manual_incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  branch_id uuid references public.branches(id) on delete set null,
  severity text not null default 'warning' check (severity in ('info','warning','critical')),
  code text not null default 'MANUAL',
  title text not null,
  message text not null default '',
  status text not null default 'open' check (status in ('open','investigating','resolved')),
  created_by uuid,
  updated_by uuid,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists it_manual_incidents_status_idx on public.it_manual_incidents(status,detected_at desc);
create index if not exists it_manual_incidents_tenant_idx on public.it_manual_incidents(tenant_id,branch_id,detected_at desc);
alter table public.it_manual_incidents enable row level security;
revoke all on public.it_manual_incidents from public,anon,authenticated;
grant select,insert,update,delete on public.it_manual_incidents to service_role;
