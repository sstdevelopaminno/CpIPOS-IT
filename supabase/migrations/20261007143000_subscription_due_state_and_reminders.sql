-- Canonical package due state, first-payment settlement correction, and pre-expiry reminders.
-- CpiPOS-001 remains the shared billing authority for IT, POS, and Customer Portal.

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

  -- First verified payment starts the first paid service window; it must not
  -- extend an already-provisioned placeholder expiry as though it were a renewal.
  if v_first_paid then
    v_previous_expiry := null;
    if coalesce(v_req.metadata->>'requested_start_date','') ~ '^\\d{4}-\\d{2}-\\d{2}$' then
      v_base := ((v_req.metadata->>'requested_start_date')::date::timestamp at time zone 'Asia/Bangkok');
    elsif v_req.request_type = 'trial_conversion'
       and v_lifecycle.trial_expires_at is not null
       and p_bank_received_at <= v_lifecycle.trial_expires_at then
      v_base := v_lifecycle.trial_expires_at;
    else
      v_base := p_bank_received_at;
    end if;
  else
    v_previous_expiry := case
      when v_lifecycle.lifecycle_status in ('active','grace') then v_lifecycle.subscription_expires_at
      else null
    end;
    v_base := greatest(v_now, coalesce(v_previous_expiry, v_now));
  end if;

  v_new_expiry := case when v_interval = 'yearly'
    then v_base + interval '1 year'
    else v_base + interval '1 month'
  end;

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

revoke all on function public.settle_subscription_payment(uuid,uuid,text,timestamptz,numeric,text) from public,anon,authenticated;
grant execute on function public.settle_subscription_payment(uuid,uuid,text,timestamptz,numeric,text) to service_role;


create or replace function app.subscription_billing_due_state(
  p_tenant_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, app
as $function$
declare
  v_tenant public.tenants%rowtype;
  v_lifecycle public.tenant_data_lifecycle%rowtype;
  v_contract public.tenant_subscription_contracts%rowtype;
  v_package public.subscription_packages%rowtype;
  v_request record;
  v_expiry timestamptz;
  v_interval text;
  v_amount numeric(12,2);
  v_days integer;
  v_status text;
  v_kind text;
  v_payable boolean := false;
  v_prepaid boolean := false;
  v_period_start date;
  v_period_end date;
  v_now timestamptz := coalesce(p_as_of,now());
begin
  select * into v_tenant from public.tenants where id=p_tenant_id;
  if not found then
    return jsonb_build_object('status','not_found','payable_now',false,'tenant_id',p_tenant_id);
  end if;

  select * into v_lifecycle from public.tenant_data_lifecycle where tenant_id=p_tenant_id;
  select * into v_contract
  from public.tenant_subscription_contracts
  where tenant_id=p_tenant_id
  order by created_at desc,id desc
  limit 1;

  if v_contract.package_id is not null then
    select * into v_package from public.subscription_packages where id=v_contract.package_id;
  elsif v_tenant.package_id is not null then
    select * into v_package from public.subscription_packages where id=v_tenant.package_id;
  end if;

  v_interval := case when v_contract.billing_interval='yearly' then 'yearly' else 'monthly' end;
  v_amount := coalesce(
    nullif(v_contract.amount_per_cycle,0),
    case when v_interval='yearly' then v_package.yearly_price else v_package.monthly_price end
  );

  select pr.id,pr.status,pr.request_type,pr.submitted_at,pr.metadata
  into v_request
  from public.tenant_subscription_payment_requests pr
  where pr.tenant_id=p_tenant_id
    and pr.status in ('pending','under_review')
    and coalesce(pr.metadata->>'kind','') not in ('ai_addon_payment','custom_quote_request')
  order by pr.created_at desc,pr.id desc
  limit 1;

  if v_lifecycle.lifecycle_status='sales_demo'
     or coalesce(v_lifecycle.metadata->>'quota_exempt','false')='true' then
    return jsonb_build_object(
      'tenant_id',p_tenant_id,'kind','internal_demo','status','not_payable',
      'payable_now',false,'amount_due',0,'amount_paid',0,'currency',coalesce(v_contract.currency,'THB'),
      'billing_interval',v_interval,'package_id',v_package.id,'package_code',v_package.code,'package_name',v_package.name,
      'source','derived_entitlement'
    );
  end if;

  if v_lifecycle.lifecycle_status='trial' or v_contract.status='trial' then
    v_kind := 'trial';
    v_expiry := coalesce(v_lifecycle.trial_expires_at,v_contract.ended_at);
    v_prepaid := coalesce(v_lifecycle.metadata->>'prepaid_activation_state','')='pending_trial_completion';
  else
    v_kind := 'subscription';
    v_expiry := coalesce(v_lifecycle.subscription_expires_at,v_contract.ended_at);
  end if;

  if v_expiry is null or v_package.id is null or coalesce(v_amount,0)<=0 then
    return jsonb_build_object(
      'tenant_id',p_tenant_id,'kind',coalesce(v_kind,'none'),'status','not_payable',
      'payable_now',false,'amount_due',coalesce(v_amount,0),'amount_paid',0,
      'currency',coalesce(v_contract.currency,'THB'),'billing_interval',v_interval,
      'package_id',v_package.id,'package_code',v_package.code,'package_name',v_package.name,
      'current_service_end',v_expiry,'source','derived_entitlement'
    );
  end if;

  v_days := ((v_expiry at time zone 'Asia/Bangkok')::date - (v_now at time zone 'Asia/Bangkok')::date);
  v_period_start := (v_expiry at time zone 'Asia/Bangkok')::date;
  v_period_end := case when v_interval='yearly' then (v_period_start + interval '1 year')::date
                       else (v_period_start + interval '1 month')::date end;

  if v_prepaid then
    v_status := 'prepaid';
    v_payable := false;
  elsif v_request.id is not null then
    v_status := case when v_request.status='under_review' then 'under_review' else 'pending' end;
    v_payable := false;
  elsif v_kind='trial' then
    v_status := case when v_days<0 then 'overdue' when v_days<=7 then 'trial_due' else 'trial' end;
    v_payable := v_days<=7;
  else
    v_status := case when v_days<0 then 'overdue' when v_days<=7 then 'open' else 'upcoming' end;
    v_payable := v_days<=7;
  end if;

  return jsonb_build_object(
    'tenant_id',p_tenant_id,
    'kind',v_kind,
    'status',v_status,
    'payable_now',v_payable,
    'days_until_due',v_days,
    'due_at',v_expiry,
    'current_service_end',v_expiry,
    'next_period_start',v_period_start,
    'next_period_end',v_period_end,
    'amount_due',round(v_amount,2),
    'amount_paid',0,
    'outstanding',round(v_amount,2),
    'currency',coalesce(v_contract.currency,'THB'),
    'billing_interval',v_interval,
    'package_id',v_package.id,
    'package_code',v_package.code,
    'package_name',v_package.name,
    'contract_id',v_contract.id,
    'contract_status',v_contract.status,
    'lifecycle_status',v_lifecycle.lifecycle_status,
    'open_request_id',v_request.id,
    'open_request_status',v_request.status,
    'prepaid_activation',v_prepaid,
    'source','derived_entitlement'
  );
end;
$function$;

revoke all on function app.subscription_billing_due_state(uuid,timestamptz) from public,anon,authenticated;
grant execute on function app.subscription_billing_due_state(uuid,timestamptz) to service_role;

create or replace function public.subscription_billing_due_state(
  p_tenant_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog,public,app
as $function$
  select app.subscription_billing_due_state(p_tenant_id,p_as_of);
$function$;

revoke all on function public.subscription_billing_due_state(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.subscription_billing_due_state(uuid,timestamptz) to service_role;

create or replace function public.subscription_billing_due_states(
  p_tenant_ids uuid[],
  p_as_of timestamptz default now()
)
returns table(tenant_id uuid,state jsonb)
language sql
stable
security definer
set search_path = pg_catalog,public,app
as $function$
  select t.id,app.subscription_billing_due_state(t.id,p_as_of)
  from public.tenants t
  where t.id=any(coalesce(p_tenant_ids,'{}'::uuid[]));
$function$;

revoke all on function public.subscription_billing_due_states(uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.subscription_billing_due_states(uuid[],timestamptz) to service_role;


alter table public.it_communication_settings
  add column if not exists auto_send_subscription_due_reminder boolean not null default true,
  add column if not exists auto_send_trial_expiry_reminder boolean not null default true;

alter table public.customer_email_deliveries
  drop constraint if exists customer_email_deliveries_event_type_check;
alter table public.customer_email_deliveries
  add constraint customer_email_deliveries_event_type_check
  check (event_type = any (array[
    'store_activation'::text,
    'payment_confirmation'::text,
    'sales_retention_export'::text,
    'daily_sales_summary'::text,
    'daily_sales_summary_test'::text,
    'subscription_due_reminder'::text,
    'trial_expiry_reminder'::text
  ]));

create schema if not exists private;
create table if not exists private.subscription_reminder_worker_tokens(
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
revoke all on table private.subscription_reminder_worker_tokens from public,anon,authenticated;
grant select,insert,update,delete on table private.subscription_reminder_worker_tokens to service_role;

create or replace function public.subscription_reminder_candidates(p_as_of timestamptz default now())
returns table(
  tenant_id uuid,
  store_name text,
  store_code text,
  owner_name text,
  owner_email text,
  reminder_type text,
  milestone text,
  due_at timestamptz,
  days_remaining integer,
  package_name text,
  billing_interval text,
  amount_due numeric,
  currency text
)
language sql
stable
security definer
set search_path = pg_catalog,public,app
as $function$
with base as (
  select
    t.id tenant_id,
    coalesce(nullif(t.display_name,''),t.name) store_name,
    coalesce(t.code,'') store_code,
    coalesce(nullif(up.full_name,''),nullif(t.owner_name,''),coalesce(nullif(t.display_name,''),t.name)) owner_name,
    coalesce(up.email,'') owner_email,
    app.subscription_billing_due_state(t.id,p_as_of) due
  from public.tenants t
  left join public.users_profiles up
    on up.id=t.primary_owner_user_id and up.is_active=true and up.archived_at is null
  where t.is_active=true
), tagged as (
  select b.*,
    case
      when due->>'kind'='trial' and (due->>'status') not in ('prepaid','pending','under_review','not_payable')
        and (due->>'days_until_due')::integer between 2 and 3 then 'trial_3d'
      when due->>'kind'='trial' and (due->>'status') not in ('prepaid','pending','under_review','not_payable')
        and (due->>'days_until_due')::integer between 0 and 1 then 'trial_1d'
      when due->>'kind'='subscription' and (due->>'status') not in ('pending','under_review','not_payable')
        and (due->>'days_until_due')::integer between 4 and 7 then 'due_7d'
      when due->>'kind'='subscription' and (due->>'status') not in ('pending','under_review','not_payable')
        and (due->>'days_until_due')::integer between 2 and 3 then 'due_3d'
      when due->>'kind'='subscription' and (due->>'status') not in ('pending','under_review','not_payable')
        and (due->>'days_until_due')::integer between 0 and 1 then 'due_1d'
      else null
    end milestone
  from base b
)
select
  tenant_id,store_name,store_code,owner_name,owner_email,
  case when due->>'kind'='trial' then 'trial_expiry_reminder' else 'subscription_due_reminder' end reminder_type,
  milestone,
  (due->>'due_at')::timestamptz due_at,
  (due->>'days_until_due')::integer days_remaining,
  coalesce(due->>'package_name','แพ็กเกจ CpIPOS') package_name,
  coalesce(due->>'billing_interval','monthly') billing_interval,
  coalesce((due->>'amount_due')::numeric,0) amount_due,
  coalesce(due->>'currency','THB') currency
from tagged
where milestone is not null and owner_email<>''
order by due_at,store_name;
$function$;

revoke all on function public.subscription_reminder_candidates(timestamptz) from public,anon,authenticated;
grant execute on function public.subscription_reminder_candidates(timestamptz) to service_role;

create or replace function app.consume_subscription_reminder_worker_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path=pg_catalog,private,app,extensions
as $function$
declare v_id uuid;
begin
  if coalesce(length(trim(p_token)),0)<32 then return false; end if;
  select id into v_id
  from private.subscription_reminder_worker_tokens
  where token_hash=encode(digest(p_token,'sha256'),'hex')
    and consumed_at is null and expires_at>now()
  order by created_at desc limit 1 for update;
  if v_id is null then return false; end if;
  update private.subscription_reminder_worker_tokens set consumed_at=now() where id=v_id;
  return true;
end;
$function$;

create or replace function public.consume_subscription_reminder_worker_token(p_token text)
returns boolean
language sql
security definer
set search_path=pg_catalog,public,app
as $function$
  select app.consume_subscription_reminder_worker_token(p_token);
$function$;
revoke all on function public.consume_subscription_reminder_worker_token(text) from public,anon,authenticated;
grant execute on function public.consume_subscription_reminder_worker_token(text) to service_role;

create or replace function app.invoke_subscription_reminder_worker()
returns bigint
language plpgsql
security definer
set search_path=pg_catalog,public,private,app,extensions,net
as $function$
declare
  v_token text:=encode(gen_random_bytes(32),'hex');
  v_request_id bigint;
begin
  delete from private.subscription_reminder_worker_tokens
  where expires_at<now()-interval '1 day' or consumed_at is not null;
  insert into private.subscription_reminder_worker_tokens(token_hash,expires_at)
  values(encode(digest(v_token,'sha256'),'hex'),now()+interval '5 minutes');
  select net.http_post(
    url:='https://cp-ipos-it-web.vercel.app/api/internal/subscription-reminders/run',
    headers:=jsonb_build_object('Content-Type','application/json'),
    body:=jsonb_build_object('token',v_token),
    timeout_milliseconds:=8000
  ) into v_request_id;
  return v_request_id;
end;
$function$;

create or replace function public.it_invoke_subscription_reminder_worker()
returns bigint
language sql
security definer
set search_path=pg_catalog,public,app
as $function$
  select app.invoke_subscription_reminder_worker();
$function$;
revoke all on function public.it_invoke_subscription_reminder_worker() from public,anon,authenticated;
grant execute on function public.it_invoke_subscription_reminder_worker() to service_role;

select cron.unschedule(jobid) from cron.job where jobname='cpipos_subscription_reminder_email';
select cron.schedule(
  'cpipos_subscription_reminder_email',
  '0 2 * * *',
  $$select app.invoke_subscription_reminder_worker();$$
);

