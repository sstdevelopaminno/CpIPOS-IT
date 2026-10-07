-- Keep billing history aligned with the authoritative Tenants / Stores contract window.
-- Payment facts remain immutable; only service-period metadata is reconciled.

CREATE OR REPLACE FUNCTION public.settle_subscription_payment(p_request_id uuid, p_actor_id uuid, p_bank_transaction_reference text, p_bank_received_at timestamp with time zone, p_amount_received numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
declare
  v_req public.tenant_subscription_payment_requests%rowtype;
  v_package public.subscription_packages%rowtype;
  v_lifecycle public.tenant_data_lifecycle%rowtype;
  v_tenant public.tenants%rowtype;
  v_contract public.tenant_subscription_contracts%rowtype;
  v_existing_settlement public.tenant_subscription_settlements%rowtype;
  v_existing_receipt public.tenant_subscription_receipts%rowtype;
  v_issuer record;
  v_owner_email text;
  v_interval text;
  v_expected numeric(12,2);
  v_now timestamptz := now();
  v_previous_expiry timestamptz;
  v_base timestamptz;
  v_new_expiry timestamptz;
  v_first_paid boolean;
  v_cycle_id uuid;
  v_settlement_id uuid;
  v_receipt_id uuid;
  v_receipt_number text;
  v_reference text := trim(coalesce(p_bank_transaction_reference,''));
  v_note text := nullif(left(trim(coalesce(p_note,'')),500),'');
  v_event_action text;
  v_retention_until timestamptz;
begin
  if p_request_id is null then raise exception 'request_required'; end if;
  if p_actor_id is null then raise exception 'actor_required'; end if;
  if char_length(v_reference) < 4 or char_length(v_reference) > 160 then
    raise exception 'bank_reference_invalid';
  end if;
  if p_bank_received_at is null
     or p_bank_received_at > v_now + interval '1 hour'
     or p_bank_received_at < v_now - interval '2 years' then
    raise exception 'bank_received_at_invalid';
  end if;
  if p_amount_received is null or p_amount_received <= 0 or p_amount_received > 10000000 then
    raise exception 'amount_received_invalid';
  end if;

  select * into v_req
  from public.tenant_subscription_payment_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'request_not_found'; end if;

  select * into v_existing_settlement
  from public.tenant_subscription_settlements
  where payment_request_id = p_request_id;

  if found then
    select * into v_existing_receipt
    from public.tenant_subscription_receipts
    where settlement_id = v_existing_settlement.id;
    return jsonb_build_object(
      'already_settled', true,
      'settlement_id', v_existing_settlement.id,
      'billing_cycle_id', v_existing_settlement.billing_cycle_id,
      'receipt_id', v_existing_receipt.id,
      'receipt_number', v_existing_receipt.receipt_number,
      'new_expiry', v_existing_settlement.new_expiry
    );
  end if;

  if v_req.status <> 'under_review' then raise exception 'request_not_under_review'; end if;
  if coalesce(v_req.metadata->>'kind','') <> 'payment_notice' then
    raise exception 'payment_notice_required';
  end if;
  if v_req.requested_package_id is null then raise exception 'requested_package_missing'; end if;

  select * into v_package
  from public.subscription_packages
  where id = v_req.requested_package_id and is_active = true;
  if not found then raise exception 'package_not_found'; end if;

  v_interval := case when v_req.metadata->>'billing_interval' = 'yearly' then 'yearly'
                     when v_req.metadata->>'billing_interval' = 'monthly' then 'monthly'
                     else null end;
  if v_interval is null then raise exception 'billing_interval_invalid'; end if;

  if coalesce(v_req.metadata->>'expected_amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then
    v_expected := (v_req.metadata->>'expected_amount')::numeric(12,2);
  else
    v_expected := case when v_interval = 'yearly' then v_package.yearly_price else v_package.monthly_price end;
  end if;
  if v_expected is null or v_expected <= 0 then raise exception 'expected_amount_missing'; end if;
  if round(p_amount_received::numeric,2) <> round(v_expected::numeric,2) then
    raise exception 'verified_amount_mismatch';
  end if;

  select * into v_tenant from public.tenants where id = v_req.tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  select * into v_lifecycle
  from public.tenant_data_lifecycle
  where tenant_id = v_req.tenant_id
  for update;
  if not found then raise exception 'tenant_lifecycle_not_found'; end if;

  if v_lifecycle.lifecycle_status = 'sales_demo'
     or coalesce(v_lifecycle.metadata->>'quota_exempt','false') = 'true' then
    raise exception 'internal_demo_not_billable';
  end if;
  if v_lifecycle.data_home <> 'primary' or v_lifecycle.migration_status not in ('idle','complete') then
    raise exception 'primary_data_migration_not_ready';
  end if;

  select * into v_contract
  from public.tenant_subscription_contracts
  where tenant_id = v_req.tenant_id
  order by created_at desc, id desc
  limit 1
  for update;

  v_first_paid := v_lifecycle.first_package_started_at is null
    or not exists (
      select 1 from public.tenant_subscription_settlements s where s.tenant_id = v_req.tenant_id
    );

  -- The Tenants / Stores contract is authoritative for the first paid
  -- service window when IT has already opened/corrected an active contract.
  -- Payment/receipt facts stay immutable; only the service-period metadata
  -- follows the canonical contract window.
  if v_first_paid then
    v_previous_expiry := null;
    if v_contract.id is not null
       and v_contract.status = 'active'
       and v_contract.package_id = v_package.id
       and v_contract.billing_interval = v_interval
       and v_contract.started_at is not null
       and v_contract.ended_at is not null
       and v_contract.ended_at > v_contract.started_at then
      v_base := v_contract.started_at;
      v_new_expiry := v_contract.ended_at;
    elsif coalesce(v_req.metadata->>'requested_start_date','') ~ '^\\d{4}-\\d{2}-\\d{2}

  insert into public.tenant_billing_cycles(
    tenant_id, package_id, period_start, period_end,
    amount_due, amount_paid, status
  ) values (
    v_req.tenant_id, v_package.id, v_base::date, v_new_expiry::date,
    v_expected, p_amount_received, 'paid'
  ) returning id into v_cycle_id;

  begin
    insert into public.tenant_subscription_settlements(
      tenant_id, payment_request_id, billing_cycle_id, package_id,
      billing_interval, amount_received, currency,
      bank_transaction_reference, bank_received_at, verified_by,
      period_start, period_end, previous_expiry, new_expiry, metadata
    ) values (
      v_req.tenant_id, v_req.id, v_cycle_id, v_package.id,
      v_interval, p_amount_received, coalesce(nullif(v_req.currency,''),'THB'),
      v_reference, p_bank_received_at, p_actor_id,
      v_base::date, v_new_expiry::date, v_previous_expiry, v_new_expiry,
      jsonb_build_object(
        'request_type', v_req.request_type,
        'reported_amount', v_req.amount_reported,
        'first_paid_activation', v_first_paid
      )
    ) returning id into v_settlement_id;
  exception when unique_violation then
    raise exception 'bank_reference_already_used';
  end;

  if v_contract.id is not null
     and v_contract.status = 'active'
     and v_contract.package_id = v_package.id
     and v_contract.billing_interval = v_interval
     and v_lifecycle.lifecycle_status in ('active','grace') then
    update public.tenant_subscription_contracts
      set ended_at = v_new_expiry,
          amount_per_cycle = v_expected,
          currency = coalesce(nullif(v_req.currency,''),'THB'),
          max_branches = v_package.max_branches,
          branch_limit = greatest(1,coalesce(v_package.max_branches,1)),
          max_devices = v_package.max_devices,
          terminal_limit_per_branch = greatest(1,coalesce(v_package.max_devices,1)),
          max_users = v_package.max_users,
          updated_at = v_now,
          metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'last_settlement_id', v_settlement_id,
            'last_payment_request_id', v_req.id,
            'last_verified_at', v_now
          )
    where id = v_contract.id;
  else
    update public.tenant_subscription_contracts
      set status = 'cancelled',
          ended_at = least(coalesce(ended_at,v_now),v_now),
          updated_at = v_now
    where tenant_id = v_req.tenant_id and status in ('active','trial');

    insert into public.tenant_subscription_contracts(
      tenant_id, package_id, contract_type, billing_interval, deployment_mode,
      status, branch_limit, terminal_limit_per_branch, amount_per_cycle, currency,
      auto_renew, started_at, ended_at, max_branches, max_devices, max_users, metadata
    ) values (
      v_req.tenant_id, v_package.id, 'saas', v_interval, 'hybrid',
      'active', greatest(1,coalesce(v_package.max_branches,1)),
      greatest(1,coalesce(v_package.max_devices,1)), v_expected,
      coalesce(nullif(v_req.currency,''),'THB'), false, v_now, v_new_expiry,
      v_package.max_branches, v_package.max_devices, v_package.max_users,
      jsonb_build_object(
        'settlement_id', v_settlement_id,
        'payment_request_id', v_req.id,
        'verified_activation', true
      )
    );
  end if;

  v_retention_until := case
    when v_package.retention_months is null then null
    else coalesce(v_lifecycle.first_package_started_at,v_now)
      + make_interval(months => v_package.retention_months)
  end;

  update public.tenants
    set package_id = v_package.id, updated_at = v_now
  where id = v_req.tenant_id;

  update public.tenant_data_lifecycle
    set lifecycle_status = 'active',
        desired_data_home = 'primary',
        first_package_started_at = coalesce(first_package_started_at,v_base),
        current_package_started_at = case
          when v_contract.id is null
            or v_contract.status <> 'active'
            or v_contract.package_id <> v_package.id
            or v_contract.billing_interval <> v_interval then v_base
          else current_package_started_at
        end,
        subscription_expires_at = v_new_expiry,
        retention_until = v_retention_until,
        access_locked = false,
        lock_reason = null,
        payment_review_status = 'approved',
        payment_reviewed_at = v_now,
        payment_reviewed_by = p_actor_id,
        updated_at = v_now,
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'last_verified_settlement_id', v_settlement_id,
          'last_verified_payment_request_id', v_req.id,
          'last_verified_at', v_now,
          'package_code', v_package.code
        )
  where tenant_id = v_req.tenant_id;

  select
    billing_legal_name_th, billing_legal_name_en, billing_registered_address,
    billing_registration_no, billing_email, billing_vat_registered
  into v_issuer
  from public.it_communication_settings
  where id = 'default';

  if v_tenant.primary_owner_user_id is not null then
    select email into v_owner_email
    from public.users_profiles
    where id = v_tenant.primary_owner_user_id;
  end if;

  v_receipt_number := 'CPR-' || to_char(v_now,'YYYY') || '-' ||
    lpad(nextval('public.subscription_receipt_number_seq')::text,6,'0');

  insert into public.tenant_subscription_receipts(
    tenant_id, settlement_id, payment_request_id, billing_cycle_id,
    receipt_number, issued_at, amount, currency,
    issuer_snapshot, customer_snapshot, package_snapshot, payment_snapshot
  ) values (
    v_req.tenant_id, v_settlement_id, v_req.id, v_cycle_id,
    v_receipt_number, v_now, p_amount_received,
    coalesce(nullif(v_req.currency,''),'THB'),
    jsonb_build_object(
      'legal_name_th', coalesce(v_issuer.billing_legal_name_th,''),
      'legal_name_en', coalesce(v_issuer.billing_legal_name_en,''),
      'registered_address', coalesce(v_issuer.billing_registered_address,''),
      'registration_no', coalesce(v_issuer.billing_registration_no,''),
      'billing_email', coalesce(v_issuer.billing_email,''),
      'vat_registered', coalesce(v_issuer.billing_vat_registered,false)
    ),
    jsonb_build_object(
      'tenant_id', v_tenant.id,
      'store_code', v_tenant.code,
      'store_name', coalesce(v_tenant.display_name,v_tenant.name),
      'owner_name', v_tenant.owner_name,
      'address', v_tenant.company_address,
      'phone', coalesce(v_tenant.contact_phone,v_tenant.owner_phone),
      'email', v_owner_email
    ),
    jsonb_build_object(
      'package_id', v_package.id,
      'package_code', v_package.code,
      'package_name', v_package.name,
      'billing_interval', v_interval,
      'period_start', v_base::date,
      'period_end', v_new_expiry::date,
      'expected_amount', v_expected,
      'first_paid_activation', v_first_paid
    ),
    jsonb_build_object(
      'settlement_id', v_settlement_id,
      'payment_request_id', v_req.id,
      'bank_transaction_reference', v_reference,
      'bank_received_at', p_bank_received_at,
      'amount_received', p_amount_received,
      'currency', coalesce(nullif(v_req.currency,''),'THB'),
      'payer_name', v_req.metadata->>'payer_name',
      'customer_transfer_reference', v_req.metadata->>'transfer_reference'
    )
  ) returning id into v_receipt_id;

  update public.tenant_subscription_payment_requests
    set status = 'approved',
        reviewed_at = v_now,
        reviewed_by = p_actor_id,
        review_note = coalesce(v_note,review_note),
        updated_at = v_now,
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'settlement_id', v_settlement_id,
          'billing_cycle_id', v_cycle_id,
          'receipt_id', v_receipt_id,
          'receipt_number', v_receipt_number,
          'settled_at', v_now
        )
  where id = v_req.id;

  v_event_action := case when v_first_paid then 'approve' else 'renewal' end;
  insert into public.tenant_subscription_approval_events(
    tenant_id, payment_request_id, action, actor_id,
    from_status, to_status, metadata
  ) values (
    v_req.tenant_id, v_req.id, v_event_action, p_actor_id,
    v_req.status, 'approved',
    jsonb_build_object(
      'settlement_id', v_settlement_id,
      'billing_cycle_id', v_cycle_id,
      'receipt_id', v_receipt_id,
      'receipt_number', v_receipt_number,
      'package_code', v_package.code,
      'billing_interval', v_interval,
      'new_expiry', v_new_expiry
    )
  );

  return jsonb_build_object(
    'already_settled', false,
    'settlement_id', v_settlement_id,
    'billing_cycle_id', v_cycle_id,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'first_paid_activation', v_first_paid,
    'period_start', v_base::date,
    'period_end', v_new_expiry::date,
    'new_expiry', v_new_expiry
  );
end;
$function$ then
      v_base := ((v_req.metadata->>'requested_start_date')::date::timestamp at time zone 'Asia/Bangkok');
      v_new_expiry := case when v_interval = 'yearly'
        then v_base + interval '1 year'
        else v_base + interval '1 month'
      end;
    elsif v_req.request_type = 'trial_conversion'
       and v_lifecycle.trial_expires_at is not null
       and p_bank_received_at <= v_lifecycle.trial_expires_at then
      v_base := v_lifecycle.trial_expires_at;
      v_new_expiry := case when v_interval = 'yearly'
        then v_base + interval '1 year'
        else v_base + interval '1 month'
      end;
    else
      v_base := p_bank_received_at;
      v_new_expiry := case when v_interval = 'yearly'
        then v_base + interval '1 year'
        else v_base + interval '1 month'
      end;
    end if;
  else
    v_previous_expiry := case
      when v_lifecycle.lifecycle_status in ('active','grace') then v_lifecycle.subscription_expires_at
      else null
    end;
    v_base := greatest(v_now, coalesce(v_previous_expiry, v_now));
    v_new_expiry := case when v_interval = 'yearly'
      then v_base + interval '1 year'
      else v_base + interval '1 month'
    end;
  end if;

  insert into public.tenant_billing_cycles(
    tenant_id, package_id, period_start, period_end,
    amount_due, amount_paid, status
  ) values (
    v_req.tenant_id, v_package.id, v_base::date, v_new_expiry::date,
    v_expected, p_amount_received, 'paid'
  ) returning id into v_cycle_id;

  begin
    insert into public.tenant_subscription_settlements(
      tenant_id, payment_request_id, billing_cycle_id, package_id,
      billing_interval, amount_received, currency,
      bank_transaction_reference, bank_received_at, verified_by,
      period_start, period_end, previous_expiry, new_expiry, metadata
    ) values (
      v_req.tenant_id, v_req.id, v_cycle_id, v_package.id,
      v_interval, p_amount_received, coalesce(nullif(v_req.currency,''),'THB'),
      v_reference, p_bank_received_at, p_actor_id,
      v_base::date, v_new_expiry::date, v_previous_expiry, v_new_expiry,
      jsonb_build_object(
        'request_type', v_req.request_type,
        'reported_amount', v_req.amount_reported,
        'first_paid_activation', v_first_paid
      )
    ) returning id into v_settlement_id;
  exception when unique_violation then
    raise exception 'bank_reference_already_used';
  end;

  if v_contract.id is not null
     and v_contract.status = 'active'
     and v_contract.package_id = v_package.id
     and v_contract.billing_interval = v_interval
     and v_lifecycle.lifecycle_status in ('active','grace') then
    update public.tenant_subscription_contracts
      set ended_at = v_new_expiry,
          amount_per_cycle = v_expected,
          currency = coalesce(nullif(v_req.currency,''),'THB'),
          max_branches = v_package.max_branches,
          branch_limit = greatest(1,coalesce(v_package.max_branches,1)),
          max_devices = v_package.max_devices,
          terminal_limit_per_branch = greatest(1,coalesce(v_package.max_devices,1)),
          max_users = v_package.max_users,
          updated_at = v_now,
          metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'last_settlement_id', v_settlement_id,
            'last_payment_request_id', v_req.id,
            'last_verified_at', v_now
          )
    where id = v_contract.id;
  else
    update public.tenant_subscription_contracts
      set status = 'cancelled',
          ended_at = least(coalesce(ended_at,v_now),v_now),
          updated_at = v_now
    where tenant_id = v_req.tenant_id and status in ('active','trial');

    insert into public.tenant_subscription_contracts(
      tenant_id, package_id, contract_type, billing_interval, deployment_mode,
      status, branch_limit, terminal_limit_per_branch, amount_per_cycle, currency,
      auto_renew, started_at, ended_at, max_branches, max_devices, max_users, metadata
    ) values (
      v_req.tenant_id, v_package.id, 'saas', v_interval, 'hybrid',
      'active', greatest(1,coalesce(v_package.max_branches,1)),
      greatest(1,coalesce(v_package.max_devices,1)), v_expected,
      coalesce(nullif(v_req.currency,''),'THB'), false, v_now, v_new_expiry,
      v_package.max_branches, v_package.max_devices, v_package.max_users,
      jsonb_build_object(
        'settlement_id', v_settlement_id,
        'payment_request_id', v_req.id,
        'verified_activation', true
      )
    );
  end if;

  v_retention_until := case
    when v_package.retention_months is null then null
    else coalesce(v_lifecycle.first_package_started_at,v_now)
      + make_interval(months => v_package.retention_months)
  end;

  update public.tenants
    set package_id = v_package.id, updated_at = v_now
  where id = v_req.tenant_id;

  update public.tenant_data_lifecycle
    set lifecycle_status = 'active',
        desired_data_home = 'primary',
        first_package_started_at = coalesce(first_package_started_at,v_now),
        current_package_started_at = case
          when v_contract.id is null
            or v_contract.status <> 'active'
            or v_contract.package_id <> v_package.id
            or v_contract.billing_interval <> v_interval then v_now
          else current_package_started_at
        end,
        subscription_expires_at = v_new_expiry,
        retention_until = v_retention_until,
        access_locked = false,
        lock_reason = null,
        payment_review_status = 'approved',
        payment_reviewed_at = v_now,
        payment_reviewed_by = p_actor_id,
        updated_at = v_now,
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'last_verified_settlement_id', v_settlement_id,
          'last_verified_payment_request_id', v_req.id,
          'last_verified_at', v_now,
          'package_code', v_package.code
        )
  where tenant_id = v_req.tenant_id;

  select
    billing_legal_name_th, billing_legal_name_en, billing_registered_address,
    billing_registration_no, billing_email, billing_vat_registered
  into v_issuer
  from public.it_communication_settings
  where id = 'default';

  if v_tenant.primary_owner_user_id is not null then
    select email into v_owner_email
    from public.users_profiles
    where id = v_tenant.primary_owner_user_id;
  end if;

  v_receipt_number := 'CPR-' || to_char(v_now,'YYYY') || '-' ||
    lpad(nextval('public.subscription_receipt_number_seq')::text,6,'0');

  insert into public.tenant_subscription_receipts(
    tenant_id, settlement_id, payment_request_id, billing_cycle_id,
    receipt_number, issued_at, amount, currency,
    issuer_snapshot, customer_snapshot, package_snapshot, payment_snapshot
  ) values (
    v_req.tenant_id, v_settlement_id, v_req.id, v_cycle_id,
    v_receipt_number, v_now, p_amount_received,
    coalesce(nullif(v_req.currency,''),'THB'),
    jsonb_build_object(
      'legal_name_th', coalesce(v_issuer.billing_legal_name_th,''),
      'legal_name_en', coalesce(v_issuer.billing_legal_name_en,''),
      'registered_address', coalesce(v_issuer.billing_registered_address,''),
      'registration_no', coalesce(v_issuer.billing_registration_no,''),
      'billing_email', coalesce(v_issuer.billing_email,''),
      'vat_registered', coalesce(v_issuer.billing_vat_registered,false)
    ),
    jsonb_build_object(
      'tenant_id', v_tenant.id,
      'store_code', v_tenant.code,
      'store_name', coalesce(v_tenant.display_name,v_tenant.name),
      'owner_name', v_tenant.owner_name,
      'address', v_tenant.company_address,
      'phone', coalesce(v_tenant.contact_phone,v_tenant.owner_phone),
      'email', v_owner_email
    ),
    jsonb_build_object(
      'package_id', v_package.id,
      'package_code', v_package.code,
      'package_name', v_package.name,
      'billing_interval', v_interval,
      'period_start', v_base::date,
      'period_end', v_new_expiry::date,
      'expected_amount', v_expected,
      'first_paid_activation', v_first_paid
    ),
    jsonb_build_object(
      'settlement_id', v_settlement_id,
      'payment_request_id', v_req.id,
      'bank_transaction_reference', v_reference,
      'bank_received_at', p_bank_received_at,
      'amount_received', p_amount_received,
      'currency', coalesce(nullif(v_req.currency,''),'THB'),
      'payer_name', v_req.metadata->>'payer_name',
      'customer_transfer_reference', v_req.metadata->>'transfer_reference'
    )
  ) returning id into v_receipt_id;

  update public.tenant_subscription_payment_requests
    set status = 'approved',
        reviewed_at = v_now,
        reviewed_by = p_actor_id,
        review_note = coalesce(v_note,review_note),
        updated_at = v_now,
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'settlement_id', v_settlement_id,
          'billing_cycle_id', v_cycle_id,
          'receipt_id', v_receipt_id,
          'receipt_number', v_receipt_number,
          'settled_at', v_now
        )
  where id = v_req.id;

  v_event_action := case when v_first_paid then 'approve' else 'renewal' end;
  insert into public.tenant_subscription_approval_events(
    tenant_id, payment_request_id, action, actor_id,
    from_status, to_status, metadata
  ) values (
    v_req.tenant_id, v_req.id, v_event_action, p_actor_id,
    v_req.status, 'approved',
    jsonb_build_object(
      'settlement_id', v_settlement_id,
      'billing_cycle_id', v_cycle_id,
      'receipt_id', v_receipt_id,
      'receipt_number', v_receipt_number,
      'package_code', v_package.code,
      'billing_interval', v_interval,
      'new_expiry', v_new_expiry
    )
  );

  return jsonb_build_object(
    'already_settled', false,
    'settlement_id', v_settlement_id,
    'billing_cycle_id', v_cycle_id,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'first_paid_activation', v_first_paid,
    'period_start', v_base::date,
    'period_end', v_new_expiry::date,
    'new_expiry', v_new_expiry
  );
end;
$function$;

revoke all on function public.settle_subscription_payment(uuid,uuid,text,timestamptz,numeric,text)
from public,anon,authenticated;
grant execute on function public.settle_subscription_payment(uuid,uuid,text,timestamptz,numeric,text)
to service_role;


create or replace function app.reconcile_subscription_billing_period_to_contract(
  p_contract_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog,public,app
as $function$
declare
  v_contract public.tenant_subscription_contracts%rowtype;
  v_settlement public.tenant_subscription_settlements%rowtype;
  v_cycle public.tenant_billing_cycles%rowtype;
  v_receipt public.tenant_subscription_receipts%rowtype;
  v_start date;
  v_end date;
  v_actor uuid;
  v_reason text:=nullif(left(trim(coalesce(p_reason,'')),600),'');
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_contract
  from public.tenant_subscription_contracts
  where id=p_contract_id
  for update;
  if not found then raise exception 'contract_not_found'; end if;
  if v_contract.started_at is null or v_contract.ended_at is null or v_contract.ended_at<=v_contract.started_at then
    return jsonb_build_object('reconciled',false,'reason','contract_window_invalid');
  end if;

  select * into v_settlement
  from public.tenant_subscription_settlements
  where tenant_id=v_contract.tenant_id
    and package_id=v_contract.package_id
    and coalesce((metadata->>'first_paid_activation')::boolean,false)=true
  order by created_at,id
  limit 1
  for update;
  if not found then
    return jsonb_build_object('reconciled',false,'reason','no_first_paid_settlement');
  end if;

  select * into v_cycle
  from public.tenant_billing_cycles
  where id=v_settlement.billing_cycle_id
  for update;
  if not found then raise exception 'billing_cycle_not_found'; end if;

  select * into v_receipt
  from public.tenant_subscription_receipts
  where billing_cycle_id=v_cycle.id
  order by issued_at,id
  limit 1
  for update;

  v_start := (v_contract.started_at at time zone 'Asia/Bangkok')::date;
  v_end := (v_contract.ended_at at time zone 'Asia/Bangkok')::date;
  if v_start>=v_end then raise exception 'contract_window_invalid'; end if;

  if v_cycle.period_start=v_start
     and v_cycle.period_end=v_end
     and v_settlement.period_start=v_start
     and v_settlement.period_end=v_end
     and v_settlement.new_expiry=v_contract.ended_at
     and (v_receipt.id is null or (
       v_receipt.package_snapshot->>'period_start'=v_start::text
       and v_receipt.package_snapshot->>'period_end'=v_end::text
     )) then
    return jsonb_build_object(
      'reconciled',false,'reason','already_aligned',
      'billing_cycle_id',v_cycle.id,'settlement_id',v_settlement.id,'receipt_id',v_receipt.id
    );
  end if;

  v_before:=jsonb_build_object(
    'contract_id',v_contract.id,
    'contract_start',v_contract.started_at,
    'contract_end',v_contract.ended_at,
    'cycle_start',v_cycle.period_start,
    'cycle_end',v_cycle.period_end,
    'settlement_start',v_settlement.period_start,
    'settlement_end',v_settlement.period_end,
    'settlement_previous_expiry',v_settlement.previous_expiry,
    'settlement_new_expiry',v_settlement.new_expiry,
    'receipt_period_start',v_receipt.package_snapshot->>'period_start',
    'receipt_period_end',v_receipt.package_snapshot->>'period_end'
  );

  update public.tenant_billing_cycles
  set period_start=v_start,period_end=v_end
  where id=v_cycle.id and tenant_id=v_contract.tenant_id;

  update public.tenant_subscription_settlements
  set period_start=v_start,
      period_end=v_end,
      previous_expiry=null,
      new_expiry=v_contract.ended_at,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'period_source','tenant_contract',
        'period_reconciled_at',now(),
        'contract_id',v_contract.id
      )
  where id=v_settlement.id and tenant_id=v_contract.tenant_id;

  if v_receipt.id is not null then
    update public.tenant_subscription_receipts
    set package_snapshot=coalesce(package_snapshot,'{}'::jsonb)||jsonb_build_object(
      'period_start',v_start,
      'period_end',v_end,
      'period_source','tenant_contract',
      'contract_id',v_contract.id
    )
    where id=v_receipt.id and tenant_id=v_contract.tenant_id;

    insert into public.tenant_subscription_receipt_annotations(
      receipt_id,tenant_id,correction_note,updated_at,updated_by,metadata
    ) values (
      v_receipt.id,v_contract.tenant_id,
      coalesce(v_reason,'แก้ไขช่วงบริการให้ตรงตามสัญญา Tenants / Stores')||
        ' · ช่วงบริการ '||v_start::text||' ถึง '||v_end::text||
        ' · ยอดรับเงินจริง เลขอ้างอิงธนาคาร และเลขที่ใบเสร็จไม่เปลี่ยนแปลง',
      now(),p_actor_id,
      jsonb_build_object(
        'source','tenant_contract_period_reconciliation',
        'contract_id',v_contract.id,
        'old_period_start',v_cycle.period_start,
        'old_period_end',v_cycle.period_end,
        'new_period_start',v_start,
        'new_period_end',v_end
      )
    )
    on conflict(receipt_id) do update set
      correction_note=excluded.correction_note,
      updated_at=excluded.updated_at,
      updated_by=excluded.updated_by,
      metadata=coalesce(public.tenant_subscription_receipt_annotations.metadata,'{}'::jsonb)||excluded.metadata;
  end if;

  update public.tenant_data_lifecycle
  set first_package_started_at=v_contract.started_at,
      current_package_started_at=v_contract.started_at,
      subscription_expires_at=v_contract.ended_at,
      updated_at=now()
  where tenant_id=v_contract.tenant_id
    and lifecycle_status in ('active','grace','expired');

  v_after:=jsonb_build_object(
    'contract_id',v_contract.id,
    'period_start',v_start,
    'period_end',v_end,
    'billing_cycle_id',v_cycle.id,
    'settlement_id',v_settlement.id,
    'receipt_id',v_receipt.id
  );

  select id into v_actor from public.users_profiles where id=p_actor_id;
  if v_actor is not null then
    insert into public.audit_logs(
      tenant_id,actor_user_id,actor_role,action,target_table,target_id,metadata,
      user_id,role,module,entity_type,entity_id,before_data,after_data
    ) values (
      v_contract.tenant_id,v_actor,'it_admin',
      'subscription_billing_period_contract_reconciled',
      'tenant_billing_cycles',v_cycle.id,
      jsonb_build_object('reason',v_reason,'contract_id',v_contract.id,'settlement_id',v_settlement.id,'receipt_id',v_receipt.id),
      v_actor,'it_admin','it_admin','tenant_billing_cycles',v_cycle.id::text,v_before,v_after
    );
  end if;

  return jsonb_build_object(
    'reconciled',true,
    'tenant_id',v_contract.tenant_id,
    'contract_id',v_contract.id,
    'billing_cycle_id',v_cycle.id,
    'settlement_id',v_settlement.id,
    'receipt_id',v_receipt.id,
    'period_start',v_start,
    'period_end',v_end
  );
end;
$function$;

revoke all on function app.reconcile_subscription_billing_period_to_contract(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function app.reconcile_subscription_billing_period_to_contract(uuid,uuid,text)
to service_role;

create or replace function public.reconcile_subscription_billing_period_to_contract(
  p_contract_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language sql
security definer
set search_path=pg_catalog,public,app
as $function$
  select app.reconcile_subscription_billing_period_to_contract(p_contract_id,p_actor_id,p_reason);
$function$;

revoke all on function public.reconcile_subscription_billing_period_to_contract(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function public.reconcile_subscription_billing_period_to_contract(uuid,uuid,text)
to service_role;

create or replace function app.sync_admin_contract_billing_period()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,app
as $function$
declare
  v_correction jsonb;
  v_old_correction jsonb;
  v_actor uuid;
  v_reason text;
begin
  v_correction:=coalesce(new.metadata->'last_admin_contract_correction','{}'::jsonb);
  v_old_correction:=coalesce(old.metadata->'last_admin_contract_correction','{}'::jsonb);

  if (new.started_at,new.ended_at) is not distinct from (old.started_at,old.ended_at)
     or v_correction=v_old_correction then
    return new;
  end if;

  if coalesce(v_correction->>'corrected_by','') ~ '^[0-9a-fA-F-]{36}$' then
    v_actor:=(v_correction->>'corrected_by')::uuid;
  end if;
  v_reason:=nullif(v_correction->>'reason','');

  perform app.reconcile_subscription_billing_period_to_contract(new.id,v_actor,v_reason);
  return new;
end;
$function$;

drop trigger if exists trg_sync_admin_contract_billing_period
on public.tenant_subscription_contracts;
create trigger trg_sync_admin_contract_billing_period
after update of started_at,ended_at,metadata
on public.tenant_subscription_contracts
for each row
execute function app.sync_admin_contract_billing_period();

