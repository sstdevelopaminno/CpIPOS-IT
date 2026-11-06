-- Production migration applied as 20261106102912.
-- Keep tenant deletion complete across current Primary, Storage/Auth and communications cleanup.

alter table public.it_tenant_deletion_cleanup
  add column if not exists auth_user_ids jsonb not null default '[]'::jsonb,
  add column if not exists storage_completed_at timestamptz,
  add column if not exists auth_users_completed_at timestamptz;

CREATE OR REPLACE FUNCTION public.it_delete_tenant_cascade(p_tenant_id uuid, p_confirmation_code text, p_admin_reason text, p_actor_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_tenant public.tenants%rowtype;
  v_expected_code text;
  v_user_ids uuid[];
  v_exclusive_users uuid[] := '{}'::uuid[];
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
    where id = p_actor_user_id
      and platform_role in ('it_admin','it_support')
      and is_active
  ) then
    raise exception 'tenant_delete_it_admin_required';
  end if;

  select * into v_tenant
  from public.tenants
  where id = p_tenant_id
  for update;
  if not found then raise exception 'tenant_not_found'; end if;

  select access_code into v_expected_code
  from public.tenant_access_codes
  where tenant_id = p_tenant_id and is_active
  order by issued_at desc
  limit 1;
  v_expected_code := coalesce(v_expected_code, v_tenant.code);

  if trim(coalesce(p_confirmation_code, '')) <> v_expected_code then
    raise exception 'tenant_delete_confirmation_failed';
  end if;
  if length(trim(coalesce(p_admin_reason, ''))) < 8 then
    raise exception 'tenant_delete_reason_required';
  end if;
  if v_tenant.is_active then raise exception 'tenant_must_be_inactive'; end if;

  if exists (
    select 1 from public.branch_devices
    where tenant_id = p_tenant_id
      and last_seen_at >= v_online_since
  ) then
    raise exception 'tenant_devices_still_online';
  end if;

  if exists (
    select 1 from public.tenant_data_lifecycle
    where tenant_id = p_tenant_id
      and (data_home <> 'primary' or desired_data_home <> 'primary' or migration_status <> 'idle')
  ) then
    raise exception 'tenant_delete_cross_plane_requires_reconciliation';
  end if;

  if exists (
    select 1 from public.desktop_license_contracts
    where tenant_id = p_tenant_id
  ) then
    raise exception 'tenant_delete_desktop_license_requires_reconciliation';
  end if;

  select coalesce(array_agg(distinct user_id), '{}'::uuid[])
  into v_user_ids
  from (
    select user_id
    from public.user_branch_roles
    where tenant_id = p_tenant_id
    union
    select user_id
    from public.pos_user_profiles
    where tenant_id = p_tenant_id
    union
    select owner_user_id as user_id
    from public.it_store_provisioning_requests
    where tenant_id = p_tenant_id and owner_user_id is not null
  ) users;

  foreach v_user in array v_user_ids loop
    if exists (
      select 1 from public.users_profiles
      where id = v_user and platform_role <> 'tenant_user'
    ) or exists (
      select 1 from public.user_branch_roles
      where user_id = v_user and tenant_id <> p_tenant_id
    ) or exists (
      select 1 from public.pos_user_profiles
      where user_id = v_user and tenant_id <> p_tenant_id
    ) then
      v_shared_users := v_shared_users + 1;
    else
      v_exclusive_users := array_append(v_exclusive_users, v_user);
    end if;
  end loop;

  select coalesce(
    jsonb_agg(jsonb_build_object('bucket', bucket_id, 'path', name)),
    '[]'::jsonb
  )
  into v_files
  from storage.objects
  where name like p_tenant_id::text || '/%';

  -- Any future tenant-scoped table that has no direct FK to tenants must be
  -- explicitly classified before deletion is allowed. This prevents silent leftovers.
  for v_table in
    select cols.table_name
    from information_schema.columns cols
    join information_schema.tables tbl
      on tbl.table_schema = cols.table_schema
     and tbl.table_name = cols.table_name
     and tbl.table_type = 'BASE TABLE'
    where cols.table_schema = 'public'
      and cols.column_name = 'tenant_id'
      and not exists (
        select 1
        from pg_catalog.pg_constraint fk
        where fk.contype = 'f'
          and fk.conrelid = pg_catalog.to_regclass('public.' || pg_catalog.quote_ident(cols.table_name))
          and fk.confrelid = 'public.tenants'::regclass
      )
      and cols.table_name <> all(array[
        'device_commands','mdm_command_audit','mdm_commands','mdm_devices',
        'mdm_remote_support_sessions','mobile_push_subscriptions',
        'native_pos_push_devices',
        'pos_device_health_latest','pos_device_health_snapshots','pos_device_incidents',
        'print_job_attempts','table_qr_client_sessions','table_qr_timeline_events',
        'optical_document_counters','optical_document_numbers','optical_eye_exams',
        'optical_payment_ledger','optical_stock_movements','optical_stock_reservations',
        'optical_work_order_events','optical_work_order_lines'
      ])
  loop
    execute pg_catalog.format(
      'select exists(select 1 from public.%I where tenant_id = $1)', v_table
    ) into v_has_rows using p_tenant_id;
    if v_has_rows then
      raise exception 'tenant_delete_unmanaged_table:%', v_table;
    end if;
  end loop;

  -- Likewise, a future FK using SET NULL / RESTRICT / NO ACTION must not silently
  -- preserve tenant data. Known non-cascade tables are explicitly removed below.
  for v_table in
    select distinct child.relname
    from pg_catalog.pg_constraint fk
    join pg_catalog.pg_class child on child.oid = fk.conrelid
    join pg_catalog.pg_namespace ns on ns.oid = child.relnamespace
    where fk.contype = 'f'
      and ns.nspname = 'public'
      and fk.confrelid = 'public.tenants'::regclass
      and fk.confdeltype <> 'c'
      and child.relname <> all(array[
        'optical_customers','optical_pos_sale_stock_ledger',
        'optical_shift_auto_close_events','optical_stock_adjustments',
        'optical_stock_bins','optical_work_orders',
        'it_tenant_addon_proposals','tenant_subscription_receipts',
        'tenant_subscription_settlements','it_manual_incidents',
        'it_store_provisioning_requests','login_attempts',
        'pos_payment_callback_logs','store_registration_requests',
        'desktop_license_contracts'
      ])
  loop
    execute pg_catalog.format(
      'select exists(select 1 from public.%I where tenant_id = $1)', v_table
    ) into v_has_rows using p_tenant_id;
    if v_has_rows then
      raise exception 'tenant_delete_unmanaged_fk_table:%', v_table;
    end if;
  end loop;

  -- Legacy / operational tables without a tenant FK.
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
  delete from public.native_pos_push_devices where tenant_id = p_tenant_id;
  delete from public.table_qr_client_sessions where tenant_id = p_tenant_id;
  delete from public.table_qr_timeline_events where tenant_id = p_tenant_id;

  -- Optical module: child-first because several current FKs intentionally use
  -- NO ACTION rather than CASCADE.
  delete from public.optical_stock_movements where tenant_id = p_tenant_id;
  delete from public.optical_work_order_events where tenant_id = p_tenant_id;
  delete from public.optical_work_order_lines where tenant_id = p_tenant_id;
  delete from public.optical_payment_ledger where tenant_id = p_tenant_id;
  delete from public.optical_stock_reservations where tenant_id = p_tenant_id;
  delete from public.optical_pos_sale_stock_ledger where tenant_id = p_tenant_id;
  delete from public.optical_stock_adjustments where tenant_id = p_tenant_id;
  delete from public.optical_work_orders where tenant_id = p_tenant_id;
  delete from public.optical_eye_exams where tenant_id = p_tenant_id;
  delete from public.optical_stock_bins where tenant_id = p_tenant_id;
  delete from public.optical_shift_auto_close_events where tenant_id = p_tenant_id;
  delete from public.optical_document_numbers where tenant_id = p_tenant_id;
  delete from public.optical_document_counters where tenant_id = p_tenant_id;
  delete from public.optical_customers where tenant_id = p_tenant_id;

  -- Financial rows with RESTRICT FKs must be removed in dependency order.
  delete from public.tenant_subscription_receipt_annotations where tenant_id = p_tenant_id;
  delete from public.tenant_subscription_receipts where tenant_id = p_tenant_id;
  delete from public.tenant_subscription_settlements where tenant_id = p_tenant_id;
  delete from public.it_tenant_addon_proposals where tenant_id = p_tenant_id;

  -- SET NULL FKs would otherwise leave store records orphaned.
  delete from public.store_registration_requests
  where tenant_id = p_tenant_id
     or provision_request_key in (
       select request_key
       from public.it_store_provisioning_requests
       where tenant_id = p_tenant_id
     );
  delete from public.it_store_provisioning_requests where tenant_id = p_tenant_id;
  delete from public.it_manual_incidents where tenant_id = p_tenant_id;
  delete from public.login_attempts where tenant_id = p_tenant_id;
  delete from public.pos_payment_callback_logs where tenant_id = p_tenant_id;

  -- Storage must be removed through the Storage API. Auth users are deliberately
  -- deferred until after Storage cleanup because Supabase blocks deletion of users
  -- who still own Storage objects.
  if jsonb_array_length(v_files) > 0 or coalesce(array_length(v_exclusive_users, 1), 0) > 0 then
    insert into public.it_tenant_deletion_cleanup(
      tenant_id, storage_objects, auth_user_ids, status,
      completed_at, storage_completed_at, auth_users_completed_at
    )
    values (
      p_tenant_id,
      v_files,
      to_jsonb(v_exclusive_users),
      'pending',
      null,
      case when jsonb_array_length(v_files) = 0 then now() else null end,
      case when coalesce(array_length(v_exclusive_users, 1), 0) = 0 then now() else null end
    )
    on conflict (tenant_id) do update
    set storage_objects = excluded.storage_objects,
        auth_user_ids = excluded.auth_user_ids,
        status = 'pending',
        completed_at = null,
        storage_completed_at = excluded.storage_completed_at,
        auth_users_completed_at = excluded.auth_users_completed_at;
  end if;

  delete from public.tenants where id = p_tenant_id;
  if not found then raise exception 'tenant_delete_failed'; end if;

  -- Transactional completeness check: any tenant-scoped row left behind in the
  -- current schema aborts the entire primary deletion. The cleanup journal is the
  -- only intentional exception because it survives the tenant for retryable cleanup.
  for v_table in
    select distinct cols.table_name
    from information_schema.columns cols
    join information_schema.tables tbl
      on tbl.table_schema = cols.table_schema
     and tbl.table_name = cols.table_name
     and tbl.table_type = 'BASE TABLE'
    where cols.table_schema = 'public'
      and cols.column_name = 'tenant_id'
      and cols.table_name <> 'it_tenant_deletion_cleanup'
  loop
    execute pg_catalog.format(
      'select exists(select 1 from public.%I where tenant_id = $1)', v_table
    ) into v_has_rows using p_tenant_id;
    if v_has_rows then
      raise exception 'tenant_delete_residual_table:%', v_table;
    end if;
  end loop;

  return jsonb_build_object(
    'deleted', true,
    'tenant_id', p_tenant_id,
    'tenant_code', v_expected_code,
    'auth_users_deleted', v_removed_users,
    'auth_users_to_delete', to_jsonb(v_exclusive_users),
    'shared_users_preserved', v_shared_users,
    'storage_cleanup_pending', jsonb_array_length(v_files) > 0,
    'auth_cleanup_pending', coalesce(array_length(v_exclusive_users, 1), 0) > 0,
    'storage_objects', v_files
  );
end;
$function$


revoke all on function public.it_delete_tenant_cascade(uuid,text,text,uuid)
from public, anon, authenticated;
grant execute on function public.it_delete_tenant_cascade(uuid,text,text,uuid)
to service_role;

CREATE OR REPLACE FUNCTION public.it_verify_tenant_deleted_for_cross_plane_cleanup(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or p_tenant_id is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.users_profiles
    where id = v_actor
      and platform_role = 'it_support'
      and is_active = true
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.tenants where id = p_tenant_id
  ) then
    return false;
  end if;

  return exists (
    select 1
    from public.audit_logs
    where action = 'tenant_permanently_deleted'
      and target_table = 'tenants'
      and target_id = p_tenant_id
  );
end;
$function$


revoke all on function public.it_verify_tenant_deleted_for_cross_plane_cleanup(uuid)
from public, anon, authenticated;
grant execute on function public.it_verify_tenant_deleted_for_cross_plane_cleanup(uuid)
to authenticated;
