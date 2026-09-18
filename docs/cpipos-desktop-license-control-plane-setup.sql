-- CpIPOS Desktop License Control Plane setup
-- Run this in Supabase SQL Editor with a service/admin role.
-- Purpose: allow the IT Control Plane to read/write the P-256 private signing key
-- used to issue CpIPOS Desktop 0.3.1 offline licenses.

create table if not exists public.cpipos_license_signing_keys (
  id text primary key default 'desktop-current',
  private_key_pem text not null,
  active boolean not null default true,
  changed_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cpipos_license_signing_keys enable row level security;

-- Service-role-only access is expected. Do not expose this table to browser clients.
create or replace function public.get_cpipos_license_signing_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  key_pem text;
begin
  select private_key_pem into key_pem
  from public.cpipos_license_signing_keys
  where id = 'desktop-current' and active is true
  limit 1;
  return coalesce(key_pem, '');
end;
$$;

create or replace function public.set_cpipos_license_signing_key(private_key_pem text, changed_by uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if private_key_pem is null or length(trim(private_key_pem)) < 100 then
    raise exception 'PRIVATE_KEY_INVALID';
  end if;

  insert into public.cpipos_license_signing_keys(id, private_key_pem, active, changed_by, updated_at)
  values ('desktop-current', private_key_pem, true, changed_by, now())
  on conflict (id) do update set
    private_key_pem = excluded.private_key_pem,
    active = true,
    changed_by = excluded.changed_by,
    updated_at = now();

  return jsonb_build_object('saved', true, 'updated_at', now());
end;
$$;

revoke all on function public.get_cpipos_license_signing_key() from anon, authenticated;
revoke all on function public.set_cpipos_license_signing_key(text, uuid) from anon, authenticated;

-- Grant only to service_role when your Supabase project exposes the role name.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_cpipos_license_signing_key() to service_role;
    grant execute on function public.set_cpipos_license_signing_key(text, uuid) to service_role;
    grant select, insert, update on public.cpipos_license_signing_keys to service_role;
  end if;
end $$;
