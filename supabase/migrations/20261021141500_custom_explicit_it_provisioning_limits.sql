-- Applied capacity is an explicit IT authorization stored in contract metadata.
-- This never activates pricing, changes billing, or alters existing payment records.
-- Payment-specific CUSTOM snapshots retain highest precedence.
CREATE OR REPLACE FUNCTION app.apply_custom_contract_limits()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
declare
  v_quota_mode text;
  v_request_id uuid;
  v_snapshot jsonb;
  v_terms public.tenant_custom_package_terms%rowtype;
  v_explicit_limits jsonb;
begin
  select quota_mode into v_quota_mode
  from public.subscription_packages
  where id = new.package_id;

  if coalesce(v_quota_mode,'standard') <> 'custom' then
    return new;
  end if;

  begin
    v_request_id := nullif(
      coalesce(new.metadata->>'payment_request_id', new.metadata->>'last_payment_request_id'),
      ''
    )::uuid;
  exception when others then
    v_request_id := null;
  end;

  if v_request_id is not null then
    select metadata->'custom_terms_snapshot' into v_snapshot
    from public.tenant_subscription_payment_requests
    where id = v_request_id
      and tenant_id = new.tenant_id;
  end if;

  if v_snapshot is not null and jsonb_typeof(v_snapshot) = 'object' then
    if coalesce(v_snapshot->>'max_branches','') !~ '^[1-9][0-9]*$'
       or coalesce(v_snapshot->>'max_devices','') !~ '^[1-9][0-9]*$'
       or coalesce(v_snapshot->>'max_users','') !~ '^[1-9][0-9]*$' then
      raise exception 'custom_terms_snapshot_invalid';
    end if;

    new.max_branches := (v_snapshot->>'max_branches')::integer;
    new.branch_limit := new.max_branches;
    new.max_devices := (v_snapshot->>'max_devices')::integer;
    new.terminal_limit_per_branch := new.max_devices;
    new.max_users := (v_snapshot->>'max_users')::integer;
    new.metadata := coalesce(new.metadata,'{}'::jsonb)
      || jsonb_build_object('custom_terms_snapshot',v_snapshot);
    return new;
  end if;

  -- IT may authorize quota provisioning independently from CUSTOM price.
  -- Merely saving a draft is never sufficient: this explicit snapshot must be
  -- written by the guarded IT tenant-control action.
  v_explicit_limits:=coalesce(new.metadata,'{}'::jsonb)->'it_approved_custom_limits';
  if v_explicit_limits is not null and jsonb_typeof(v_explicit_limits)='object' then
    if coalesce(v_explicit_limits->>'max_branches','') !~ '^[1-9][0-9]*
  -- IT-reviewed tenant terms row; otherwise remain at the minimum safe quota.
  select * into v_terms
  from public.tenant_custom_package_terms
  where tenant_id = new.tenant_id
    and package_id = new.package_id
    and status in ('approved','active');

  if found then
    new.max_branches := v_terms.max_branches;
    new.branch_limit := v_terms.max_branches;
    new.max_devices := v_terms.max_devices;
    new.terminal_limit_per_branch := v_terms.max_devices;
    new.max_users := v_terms.max_users;
  else
    new.max_branches := 1;
    new.branch_limit := 1;
    new.max_devices := 1;
    new.terminal_limit_per_branch := 1;
    new.max_users := 1;
  end if;

  return new;
end;
$function$

       or coalesce(v_explicit_limits->>'max_devices','') !~ '^[1-9][0-9]*
  -- IT-reviewed tenant terms row; otherwise remain at the minimum safe quota.
  select * into v_terms
  from public.tenant_custom_package_terms
  where tenant_id = new.tenant_id
    and package_id = new.package_id
    and status in ('approved','active');

  if found then
    new.max_branches := v_terms.max_branches;
    new.branch_limit := v_terms.max_branches;
    new.max_devices := v_terms.max_devices;
    new.terminal_limit_per_branch := v_terms.max_devices;
    new.max_users := v_terms.max_users;
  else
    new.max_branches := 1;
    new.branch_limit := 1;
    new.max_devices := 1;
    new.terminal_limit_per_branch := 1;
    new.max_users := 1;
  end if;

  return new;
end;
$function$

       or coalesce(v_explicit_limits->>'max_users','') !~ '^[1-9][0-9]*
  -- IT-reviewed tenant terms row; otherwise remain at the minimum safe quota.
  select * into v_terms
  from public.tenant_custom_package_terms
  where tenant_id = new.tenant_id
    and package_id = new.package_id
    and status in ('approved','active');

  if found then
    new.max_branches := v_terms.max_branches;
    new.branch_limit := v_terms.max_branches;
    new.max_devices := v_terms.max_devices;
    new.terminal_limit_per_branch := v_terms.max_devices;
    new.max_users := v_terms.max_users;
  else
    new.max_branches := 1;
    new.branch_limit := 1;
    new.max_devices := 1;
    new.terminal_limit_per_branch := 1;
    new.max_users := 1;
  end if;

  return new;
end;
$function$

       or coalesce(v_explicit_limits->>'approved_at','')=''
       or coalesce(v_explicit_limits->>'approved_by','')=''
       or (v_explicit_limits->>'max_branches')::numeric > 2000000000
       or (v_explicit_limits->>'max_devices')::numeric > 2000000000
       or (v_explicit_limits->>'max_users')::numeric > 2000000000 then
      raise exception 'it_custom_capacity_authorization_invalid';
    end if;
    new.max_branches := (v_explicit_limits->>'max_branches')::integer;
    new.branch_limit := new.max_branches;
    new.max_devices := (v_explicit_limits->>'max_devices')::integer;
    new.terminal_limit_per_branch := new.max_devices;
    new.max_users := (v_explicit_limits->>'max_users')::integer;
    return new;
  end if;

  -- Trial registrations do not yet have a payment request. They may use an
  -- IT-reviewed tenant terms row; otherwise remain at the minimum safe quota.
  select * into v_terms
  from public.tenant_custom_package_terms
  where tenant_id = new.tenant_id
    and package_id = new.package_id
    and status in ('approved','active');

  if found then
    new.max_branches := v_terms.max_branches;
    new.branch_limit := v_terms.max_branches;
    new.max_devices := v_terms.max_devices;
    new.terminal_limit_per_branch := v_terms.max_devices;
    new.max_users := v_terms.max_users;
  else
    new.max_branches := 1;
    new.branch_limit := 1;
    new.max_devices := 1;
    new.terminal_limit_per_branch := 1;
    new.max_users := 1;
  end if;

  return new;
end;
$function$;
