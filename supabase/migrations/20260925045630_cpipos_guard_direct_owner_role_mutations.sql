-- Direct authenticated PostgREST callers cannot appoint/demote Owners or
-- change assignment identity. IT-admin APIs use server-side service_role.
create or replace function app.cpipos_guard_branch_owner_roles()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $body$
begin
  if current_user not in ('anon','authenticated') then
    return case when tg_op='DELETE' then old else new end;
  end if;

  if tg_op='INSERT' then
    if new.role='owner' then
      raise exception 'owner_role_assignment_requires_it' using errcode='42501';
    end if;
    return new;
  end if;

  if tg_op='DELETE' then
    if old.role='owner' then
      raise exception 'owner_role_removal_requires_it' using errcode='42501';
    end if;
    return old;
  end if;

  if old.role='owner' or new.role='owner'
     or old.user_id is distinct from new.user_id
     or old.tenant_id is distinct from new.tenant_id
     or old.branch_id is distinct from new.branch_id then
    raise exception 'owner_role_or_assignment_identity_requires_it' using errcode='42501';
  end if;
  return new;
end
$body$;

drop trigger if exists cpipos_guard_branch_owner_roles on public.user_branch_roles;
create trigger cpipos_guard_branch_owner_roles
before insert or update or delete on public.user_branch_roles
for each row execute function app.cpipos_guard_branch_owner_roles();
