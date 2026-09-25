-- Ensure disabled account cannot retain tenant data access with a still-valid JWT.
create or replace function app.has_role(p_tenant_id uuid, p_branch_id uuid, allowed_roles public.branch_role[])
returns boolean language sql stable security definer set search_path to 'public'
as $body$
 select exists (
   select 1 from public.user_branch_roles ubr
   join public.users_profiles up on up.id=ubr.user_id and up.is_active=true
   where ubr.user_id=auth.uid() and ubr.tenant_id=p_tenant_id
     and ubr.branch_id=p_branch_id and ubr.role=any(allowed_roles)
 );
$body$;

create or replace function app.has_tenant_access(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $body$
 select app.is_it_admin() or exists (
   select 1 from public.user_branch_roles ubr
   join public.users_profiles up on up.id=ubr.user_id and up.is_active=true
   where ubr.user_id=auth.uid() and ubr.tenant_id=p_tenant_id
 );
$body$;
