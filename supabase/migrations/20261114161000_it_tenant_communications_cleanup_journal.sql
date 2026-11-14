-- Keep a durable external-communications cleanup receipt for every approved
-- permanent tenant deletion, even when no Primary Storage/Auth objects exist.
-- The trigger does not remove anything; cross-plane deletion still requires IT
-- confirmation and the communications gateway's verified primary deletion receipt.

create table if not exists public.it_tenant_communications_cleanup (
  tenant_id uuid primary key,
  status text not null default 'pending' check (status in ('pending', 'complete')),
  requested_at timestamptz not null default now(),
  attempted_at timestamptz,
  completed_at timestamptz,
  last_error text,
  storage_removed integer not null default 0 check (storage_removed >= 0)
);

revoke all on public.it_tenant_communications_cleanup from public, anon, authenticated;
grant select, insert, update on public.it_tenant_communications_cleanup to service_role;

create or replace function app.journal_tenant_communications_cleanup_after_primary_delete()
returns trigger
language plpgsql security definer set search_path = ''
as $journal$
begin
  insert into public.it_tenant_communications_cleanup(
    tenant_id, status, requested_at, attempted_at, completed_at, last_error, storage_removed
  )
  values (old.id, 'pending', now(), null, null, null, 0)
  on conflict (tenant_id) do update
     set status = 'pending',
         requested_at = now(),
         attempted_at = null,
         completed_at = null,
         last_error = null,
         storage_removed = 0;
  return old;
end;
$journal$;

revoke all on function app.journal_tenant_communications_cleanup_after_primary_delete()
  from public, anon, authenticated;

drop trigger if exists trg_journal_tenant_communications_cleanup
  on public.tenants;
create trigger trg_journal_tenant_communications_cleanup
after delete on public.tenants
for each row execute function app.journal_tenant_communications_cleanup_after_primary_delete();

create index if not exists idx_it_tenant_communications_cleanup_pending
on public.it_tenant_communications_cleanup(status, requested_at)
where status='pending';
