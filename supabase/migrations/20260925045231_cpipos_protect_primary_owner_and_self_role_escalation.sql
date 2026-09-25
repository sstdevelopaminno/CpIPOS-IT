-- Applied to shared CpiPOS-001 before release. Preserve existing IT and POS service_role APIs.
alter table public.tenants
  add column if not exists primary_owner_user_id uuid references public.users_profiles(id) on delete set null;

with per_user_owner as (
 select ubr.tenant_id,ubr.user_id,bool_or(ubr.is_default) as default_owner,
        min(ubr.created_at) as first_role_at,
        bool_or(up.platform_role = 'it_admin') as it_profile
 from public.user_branch_roles ubr
 join public.users_profiles up on up.id=ubr.user_id
 where ubr.role='owner'
 group by ubr.tenant_id,ubr.user_id
), ranked as (
 select *,row_number() over(partition by tenant_id order by default_owner desc,it_profile asc,first_role_at asc,user_id) as rn
 from per_user_owner
)
update public.tenants t
set primary_owner_user_id=r.user_id
from ranked r
where r.rn=1 and t.id=r.tenant_id and t.primary_owner_user_id is null;

comment on column public.tenants.primary_owner_user_id is
 'IT-managed canonical first/primary owner account; POS must not edit, suspend, unassign or delete. Set or transfer only through IT admin.';

revoke update, insert, delete on table public.users_profiles from anon, authenticated;
grant update (full_name, email, updated_at) on public.users_profiles to authenticated;
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;

create or replace function app.cpipos_protect_primary_owner_profile()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $body$
begin
 if current_user in ('anon','authenticated') then
   if tg_op='DELETE' then
     raise exception 'profile_deletion_requires_it_admin' using errcode='42501';
   end if;
   if old.id is distinct from new.id
      or old.platform_role is distinct from new.platform_role
      or old.is_active is distinct from new.is_active
      or old.pin_hash is distinct from new.pin_hash then
     raise exception 'profile_identity_and_role_change_requires_admin_server' using errcode='42501';
   end if;
   if exists (select 1 from public.tenants t where t.primary_owner_user_id=old.id) then
     raise exception 'primary_owner_profile_can_only_be_edited_by_it' using errcode='42501';
   end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end
$body$;

drop trigger if exists cpipos_protect_primary_owner_profile on public.users_profiles;
create trigger cpipos_protect_primary_owner_profile
before update or delete on public.users_profiles
for each row execute function app.cpipos_protect_primary_owner_profile();

create or replace function app.cpipos_protect_primary_owner_assignment()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $body$
begin
 if current_user in ('anon','authenticated') and exists (
   select 1 from public.tenants t
   where t.id=old.tenant_id and t.primary_owner_user_id=old.user_id
 ) then
   raise exception 'primary_owner_assignment_requires_it_admin' using errcode='42501';
 end if;
 return case when tg_op='DELETE' then old else new end;
end
$body$;

drop trigger if exists cpipos_protect_primary_owner_assignment on public.user_branch_roles;
create trigger cpipos_protect_primary_owner_assignment
before update or delete on public.user_branch_roles
for each row execute function app.cpipos_protect_primary_owner_assignment();

create or replace function app.cpipos_protect_primary_owner_reference()
returns trigger language plpgsql security invoker
set search_path = pg_catalog, public
as $body$
begin
 if current_user in ('anon','authenticated')
    and old.primary_owner_user_id is distinct from new.primary_owner_user_id then
   raise exception 'primary_owner_transfer_requires_it_admin' using errcode='42501';
 end if;
 return new;
end
$body$;

drop trigger if exists cpipos_protect_primary_owner_reference on public.tenants;
create trigger cpipos_protect_primary_owner_reference
before update of primary_owner_user_id on public.tenants
for each row execute function app.cpipos_protect_primary_owner_reference();
