-- Final settlement consumes the automatically opened billing cycle.
-- Settlement and Receipt are still created only after IT confirms real bank receipt.

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
  v_requested_cycle public.tenant_billing_cycles%rowtype;
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

  if coalesce(v_req.metadata->>'billing_cycle_id','') <> '' then
    begin
      select * into v_requested_cycle
      from public.tenant_billing_cycles
      where id=(v_req.metadata->>'billing_cycle_id')::uuid
        and tenant_id=v_req.tenant_id
      for update;
    exception when invalid_text_representation then
      raise exception 'billing_cycle_invalid';
    end;
    if v_requested_cycle.id is null then raise exception 'billing_cycle_not_found'; end if;
    if v_requested_cycle.package_id is distinct from v_package.id then raise exception 'billing_cycle_package_mismatch'; end if;
    if v_requested_cycle.status in ('paid','cancelled','support_required')
       or coalesce(v_requested_cycle.amount_paid,0)>=coalesce(v_requested_cycle.amount_due,0) then
      raise exception 'billing_cycle_not_payable';
    end if;
  end if;

  -- If the request references an automatically opened billing cycle, that
  -- cycle is the authoritative service period. Approval must not shift it by now().
  if v_requested_cycle.id is not null then
    v_previous_expiry := case when v_first_paid then null else v_contract.ended_at end;
    v_base := (v_requested_cycle.period_start::timestamp at time zone 'Asia/Bangkok');
    v_new_expiry := (v_requested_cycle.period_end::timestamp at time zone 'Asia/Bangkok');
    v_expected := round(greatest(
      0,
      coalesce(v_requested_cycle.amount_due,0)-coalesce(v_requested_cycle.amount_paid,0)
    )::numeric,2);
    if v_expected <= 0 then raise exception 'billing_cycle_already_paid'; end if;
    if round(p_amount_received::numeric,2) <> round(v_expected::numeric,2) then
      raise exception 'verified_amount_mismatch';
    end if;
  elsif v_first_paid then
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
    elsif coalesce(v_req.metadata->>'requested_start_date','') ~ '^\\d{4}-\\d{2}-\\d{2}$' then
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
      else v_contract.ended_at
    end;
    v_base := greatest(v_now, coalesce(v_previous_expiry, v_now));
    v_new_expiry := case when v_interval = 'yearly'
      then v_base + interval '1 year'
      else v_base + interval '1 month'
    end;
  end if;

  if v_requested_cycle.id is not null then
    update public.tenant_billing_cycles
    set amount_due=v_expected,
        amount_paid=p_amount_received,
        status='paid',
        updated_at=v_now,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'paid_at',v_now,
          'payment_request_id',v_req.id,
          'period_source','automatic_billing_cycle'
        )
    where id=v_requested_cycle.id
    returning id into v_cycle_id;
  else
    insert into public.tenant_billing_cycles(
      tenant_id,package_id,period_start,period_end,
      amount_due,amount_paid,status,metadata,updated_at
    ) values (
      v_req.tenant_id,v_package.id,v_base::date,v_new_expiry::date,
      v_expected,p_amount_received,'paid',
      jsonb_build_object(
        'paid_at',v_now,
        'payment_request_id',v_req.id,
        'period_source','settlement'
      ),
      v_now
    )
    returning id into v_cycle_id;
  end if;

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
      set started_at = v_base,
          ended_at = v_new_expiry,
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
      coalesce(nullif(v_req.currency,''),'THB'), false, v_base, v_new_expiry,
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
    else coalesce(v_lifecycle.first_package_started_at,v_base)
      + make_interval(months => v_package.retention_months)
  end;

  update public.tenants
    set package_id = v_package.id, updated_at = v_now
  where id = v_req.tenant_id;

  update public.tenant_data_lifecycle
    set lifecycle_status = 'active',
        desired_data_home = 'primary',
        first_package_started_at = coalesce(first_package_started_at,v_base),
        current_package_started_at = v_base,
        subscription_expires_at = v_new_expiry,
        grace_until = null,
        retention_until = v_retention_until,
        access_locked = false,
        lock_reason = null,
        payment_review_status = 'approved',
        payment_reviewed_at = v_now,
        payment_reviewed_by = p_actor_id,
        updated_at = v_now,
        metadata = (
          coalesce(metadata,'{}'::jsonb)
          - 'provisional_payment_request_id'
          - 'provisional_access_started_at'
          - 'provisional_access_expires_at'
          - 'support_required'
          - 'support_required_at'
        ) || jsonb_build_object(
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
          'provisional_finalized_at', v_now,
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
