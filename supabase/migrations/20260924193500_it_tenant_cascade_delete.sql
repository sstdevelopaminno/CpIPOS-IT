-- Atomic store erasure for CpIPOS-IT. Invoked ONLY by the server's service_role client.
-- A tenant's own Auth users are removed only when they are not assigned to another store.
-- Storage paths are recorded for recoverable post-commit removal via the Storage API.
create table if not exists public.it_tenant_deletion_cleanup (
  tenant_id uuid primary key,
  storage_objects jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending','complete')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.it_tenant_deletion_cleanup enable row level security;
revoke all on public.it_tenant_deletion_cleanup from public, anon, authenticated;
grant select, insert, update on public.it_tenant_deletion_cleanup to service_role;

create or replace function public.it_delete_tenant_cascade(
  p_tenant_id uuid,
  p_confirmation_code text,
  p_admin_reason text,
  p_actor_user_id uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_expected_code text;
  v_user_ids uuid[];
  v_user uuid;
  v_files jsonb;
  v_removed_users integer := 0;
  v_shared_users integer := 0;
  v_online_since timestamptz := now() - interval '5 minutes';
  v_table text;
  v_has_rows boolean;
begin
  if not exists (
    select 1 from public.users_profiles
    where id = p_actor_user_id and platform_role = 'it_admin' and is_active
  ) then
    raise exception 'tenant_delete_it_admin_required';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  select access_code into v_expected_code
    from public.tenant_access_codes
    where tenant_id = p_tenant_id and is_active
    order by issued_at desc limit 1;
  v_expected_code := coalesce(v_expected_code, v_tenant.code);
  if trim(coalesce(p_confirmation_code, '')) <> v_expected_code then
    raise exception 'tenant_delete_confirmation_failed';
  end if;
  if length(trim(coalesce(p_admin_reason, ''))) < 8 then
    raise exception 'tenant_delete_reason_required';
  end if;
  if v_tenant.is_active then raise exception 'tenant_must_be_inactive'; end if;
  if exists (
    select 1 from public.branch_devices where tenant_id = p_tenant_id
    and last_seen_at >= v_online_since
  ) then raise exception 'tenant_devices_still_online'; end if;
  if exists (
    select 1 from public.tenant_data_lifecycle
    where tenant_id = p_tenant_id and
      (data_home <> 'primary' or desired_data_home <> 'primary' or migration_status <> 'idle')
  ) then raise exception 'tenant_delete_cross_plane_requires_reconciliation'; end if;
  -- Desktop licence contracts have their own commerce/receipt authority.
  -- Refuse rather than silently orphaning or erasing a separate product's licences.
  if exists (select 1 from public.desktop_license_contracts where tenant_id = p_tenant_id) then
    raise exception 'tenant_delete_desktop_license_requires_reconciliation';
  end if;

  select coalesce(array_agg(distinct user_id), '{}'::uuid[]) into v_user_ids
    from (
      select user_id from public.user_branch_roles where tenant_id = p_tenant_id
      union
      select user_id from public.pos_user_profiles where tenant_id = p_tenant_id
      union
      select owner_user_id as user_id from public.it_store_provisioning_requests
        where tenant_id = p_tenant_id and owner_user_id is not null
    ) users;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'path', name)), '[]'::jsonb)
    into v_files from storage.objects
    where name like p_tenant_id::text || '/%';

  -- Guard against future tenant-scoped tables without an FK or an explicit cleanup.
  for v_table in
    select cols.table_name
    from information_schema.columns cols
    join information_schema.tables tbl on tbl.table_schema = cols.table_schema
       and tbl.table_name = cols.table_name and tbl.table_type = 'BASE TABLE'
    where cols.table_schema = 'public' and cols.column_name = 'tenant_id'
      and not exists (
        select 1 from pg_catalog.pg_constraint fk
        where fk.contype = 'f'
          and fk.conrelid = pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(cols.table_name))
          and fk.confrelid = 'public.tenants'::regclass
      )
      and cols.table_name <> all(array[
        'device_commands','mdm_command_audit','mdm_commands','mdm_devices',
        'mdm_remote_support_sessions','mobile_push_subscriptions',
        'pos_device_health_latest','pos_device_health_snapshots','pos_device_incidents',
        'print_job_attempts','table_qr_client_sessions','table_qr_timeline_events'
      ])
  loop
    execute pg_catalog.format('select exists(select 1 from public.%I where tenant_id = $1)', v_table)
      into v_has_rows using p_tenant_id;
    if v_has_rows then raise exception 'tenant_delete_unmanaged_table:%', v_table; end if;
  end loop;

  -- Clean up tables that predate the tenant FK, in child-first order.
  delete from public.mdm_command_audit where tenant_id = p_tenant_id;
  delete from public.mdm_remote_support_sessions where tenant_id = p_tenant_id;
  delete from public.mdm_commands where tenant_id = p_tenant_id;
  delete from public.mdm_devices where tenant_id = p_tenant_id;
  delete from public.device_commands where tenant_id = p_tenant_id;
  delete from public.pos_device_incidents where tenant_id = p_tenant_id;
  delete from public.pos_device_health_snapshots where tenant_id = p_tenant_id;
  delete from public.pos_device_health_latest where tenant_id = p_tenant_id;
  delete from public.print_job_attempts where tenant_id = p_tenant_id;
  delete from public.mobile_push_subscriptions where tenant_id = p_tenant_id;
  delete from public.table_qr_client_sessions where tenant_id = p_tenant_id;
  delete from public.table_qr_timeline_events where tenant_id = p_tenant_id;

  -- SET NULL FKs would otherwise leave store data or provisioning IDs orphaned.
  delete from public.store_registration_requests
    where tenant_id = p_tenant_id
       or provision_request_key in (
         select request_key from public.it_store_provisioning_requests where tenant_id = p_tenant_id
       );
  delete from public.it_store_provisioning_requests where tenant_id = p_tenant_id;
  delete from public.login_attempts where tenant_id = p_tenant_id;
  delete from public.pos_payment_callback_logs where tenant_id = p_tenant_id;

  if jsonb_array_length(v_files) > 0 then
    insert into public.it_tenant_deletion_cleanup(tenant_id, storage_objects, status)
    values (p_tenant_id, v_files, 'pending')
    on conflict (tenant_id) do update
      set storage_objects = excluded.storage_objects, status = 'pending', completed_at = null;
  end if;

  -- Primary tenant-scoped data, including products, orders, payments, shifts,
  -- devices, roles and all FK descendants, is removed in this SAME transaction.
  delete from public.tenants where id = p_tenant_id;
  if not found then raise exception 'tenant_delete_failed'; end if;

  foreach v_user in array v_user_ids loop
    -- An IT account or an account still assigned to any other store stays intact.
    if exists (
      select 1 from public.users_profiles
      where id = v_user and platform_role <> 'tenant_user'
    ) or exists (
      select 1 from public.user_branch_roles where user_id = v_user
    ) or exists (
      select 1 from public.pos_user_profiles where user_id = v_user
    ) then
      v_shared_users := v_shared_users + 1;
    else
      -- This also removes the Auth user's POS profile via the existing FK.
      -- Any other RESTRICT reference fails and rolls back the ENTIRE purge.
      delete from auth.users where id = v_user;
      if found then v_removed_users := v_removed_users + 1; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'deleted', true, 'tenant_id', p_tenant_id, 'tenant_code', v_expected_code,
    'auth_users_deleted', v_removed_users, 'shared_users_preserved', v_shared_users,
    'storage_cleanup_pending', jsonb_array_length(v_files) > 0,
    'storage_objects', v_files
  );
end;
$$;
revoke all on function public.it_delete_tenant_cascade(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.it_delete_tenant_cascade(uuid,text,text,uuid) to service_role;
