-- Clarify the payment review entitlement logic: no elapsed-time approval cutoff.
-- Refuse when IT locked the tenant, and require a passed scan plus a non-revoked grant.
-- The actual bank settlement remains a separate IT-only transaction.
CREATE OR REPLACE FUNCTION app.subscription_billing_due_state(p_tenant_id uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
declare
  v_tenant public.tenants%rowtype;
  v_lifecycle public.tenant_data_lifecycle%rowtype;
  v_contract public.tenant_subscription_contracts%rowtype;
  v_package public.subscription_packages%rowtype;
  v_cycle public.tenant_billing_cycles%rowtype;
  v_request public.tenant_subscription_payment_requests%rowtype;
  v_expiry timestamptz;
  v_interval text;
  v_amount numeric(12,2);
  v_days integer;
  v_status text;
  v_kind text;
  v_self_service boolean:=false;
  v_support boolean:=false;
  v_prepaid boolean:=false;
  v_period_start date;
  v_period_end date;
  v_amount_paid numeric(12,2):=0;
  v_now timestamptz:=coalesce(p_as_of,now());
  v_provisional_active boolean:=false;
begin
  select * into v_tenant from public.tenants where id=p_tenant_id;
  if not found then
    return jsonb_build_object(
      'status','not_found','payable_now',false,
      'self_service_payment_allowed',false,'tenant_id',p_tenant_id
    );
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

  v_interval:=case when v_contract.billing_interval='yearly' then 'yearly' else 'monthly' end;
  v_amount:=coalesce(
    nullif(v_contract.amount_per_cycle,0),
    case when v_interval='yearly' then v_package.yearly_price else v_package.monthly_price end
  );

  if not coalesce(v_tenant.is_active,false)
     or v_lifecycle.lifecycle_status in ('sales_demo','suspended','archived')
     or v_contract.status in ('suspended','cancelled')
     or coalesce(v_lifecycle.metadata->>'quota_exempt','false')='true' then
    return jsonb_build_object(
      'tenant_id',p_tenant_id,'kind','internal_demo','status','not_payable',
      'payable_now',false,'self_service_payment_allowed',false,'support_required',false,
      'amount_due',0,'amount_paid',0,'outstanding',0,
      'currency',coalesce(v_contract.currency,'THB'),
      'billing_interval',v_interval,
      'package_id',v_package.id,'package_code',v_package.code,'package_name',v_package.name,
      'access_locked',coalesce(v_lifecycle.access_locked,false),
      'lock_reason',v_lifecycle.lock_reason,'source','derived_entitlement'
    );
  end if;

  if v_contract.status='trial'
     or (v_lifecycle.lifecycle_status='trial' and v_lifecycle.first_package_started_at is null) then
    v_kind:='trial';
    v_expiry:=coalesce(v_lifecycle.trial_expires_at,v_contract.ended_at);
    v_prepaid:=coalesce(v_lifecycle.metadata->>'prepaid_activation_state','')='pending_trial_completion';
  else
    v_kind:='subscription';
    v_expiry:=coalesce(v_lifecycle.subscription_expires_at,v_contract.ended_at);
  end if;

  if v_expiry is null or v_package.id is null or coalesce(v_amount,0)<=0 then
    return jsonb_build_object(
      'tenant_id',p_tenant_id,'kind',coalesce(v_kind,'none'),'status','not_payable',
      'payable_now',false,'self_service_payment_allowed',false,'support_required',false,
      'amount_due',coalesce(v_amount,0),'amount_paid',0,'outstanding',coalesce(v_amount,0),
      'currency',coalesce(v_contract.currency,'THB'),'billing_interval',v_interval,
      'package_id',v_package.id,'package_code',v_package.code,'package_name',v_package.name,
      'current_service_end',v_expiry,
      'access_locked',coalesce(v_lifecycle.access_locked,false),
      'lock_reason',v_lifecycle.lock_reason,'source','derived_entitlement'
    );
  end if;

  v_period_start:=(v_expiry at time zone 'Asia/Bangkok')::date;
  v_period_end:=app.billing_period_end_date(v_period_start,v_interval);

  select bc.* into v_cycle
  from public.tenant_billing_cycles bc
  where bc.tenant_id=p_tenant_id
    and bc.package_id=v_package.id
    and bc.status not in ('paid','cancelled')
    and coalesce(bc.amount_paid,0)<coalesce(bc.amount_due,0)
    and not exists(
      select 1 from public.tenant_subscription_settlements s
      where s.billing_cycle_id=bc.id
    )
  order by
    case when bc.period_start=v_period_start then 0 else 1 end,
    bc.created_at desc,bc.id desc
  limit 1;

  if v_cycle.id is not null then
    v_period_start:=v_cycle.period_start;
    v_period_end:=v_cycle.period_end;
    v_amount:=v_cycle.amount_due;
    v_amount_paid:=coalesce(v_cycle.amount_paid,0);
  end if;

  v_days:=v_period_start-(v_now at time zone 'Asia/Bangkok')::date;

  select pr.* into v_request
  from public.tenant_subscription_payment_requests pr
  where pr.tenant_id=p_tenant_id
    and pr.status in ('pending','under_review')
    and coalesce(pr.metadata->>'kind','') not in ('ai_addon_payment','custom_quote_request')
  order by pr.created_at desc,pr.id desc
  limit 1;

  -- Verified evidence opens POS while awaiting an explicit IT decision.
  -- No three-day review timeout; IT rejection/revocation still locks immediately.
  v_provisional_active:=v_request.id is not null
    and v_request.status='under_review'
    and v_request.auto_check_status='passed'
    and v_request.provisional_access_granted_at is not null
    and v_request.provisional_access_revoked_at is null
    and not coalesce(v_lifecycle.access_locked,false);

  v_support:=v_days < -7
    or coalesce(v_lifecycle.lock_reason,'') in (
      'subscription_payment_support_required',
      'subscription_payment_review_timeout',
      'subscription_payment_rejected'
    )
    ;

  if v_support then
    v_status:='support_required';
  elsif v_prepaid then
    v_status:='prepaid';
  elsif v_provisional_active then
    v_status:='provisional_review';
  elsif v_request.id is not null then
    v_status:=case when v_request.status='under_review' then 'under_review' else 'pending' end;
  elsif v_kind='trial' then
    v_status:=case
      when v_days < 0 then 'overdue'
      when v_days <= 7 then 'trial_due'
      else 'trial'
    end;
  else
    v_status:=case
      when v_days < 0 then 'overdue'
      when v_days = 0 then 'due'
      when v_days <= 7 then 'open'
      else 'upcoming'
    end;
  end if;

  v_self_service:=not v_support
    and not v_prepaid
    and v_request.id is null
    and v_days between -7 and 7;

  return jsonb_build_object(
    'tenant_id',p_tenant_id,
    'kind',v_kind,
    'status',v_status,
    'payable_now',v_self_service,
    'self_service_payment_allowed',v_self_service,
    'support_required',v_support,
    'days_until_due',v_days,
    'due_at',(v_period_start::timestamp at time zone 'Asia/Bangkok'),
    'current_service_end',v_expiry,
    'next_period_start',v_period_start,
    'next_period_end',v_period_end,
    'billing_cycle_id',v_cycle.id,
    'amount_due',round(coalesce(v_amount,0),2),
    'amount_paid',round(coalesce(v_amount_paid,0),2),
    'outstanding',round(greatest(0,coalesce(v_amount,0)-coalesce(v_amount_paid,0)),2),
    'currency',coalesce(v_contract.currency,'THB'),
    'billing_interval',v_interval,
    'package_id',v_package.id,
    'package_code',v_package.code,
    'package_name',v_package.name,
    'contract_id',v_contract.id,
    'contract_status',v_contract.status,
    'lifecycle_status',v_lifecycle.lifecycle_status,
    'access_locked',coalesce(v_lifecycle.access_locked,false),
    'lock_reason',v_lifecycle.lock_reason,
    'grace_until',v_lifecycle.grace_until,
    'open_request_id',v_request.id,
    'open_request_status',v_request.status,
    'auto_check_status',v_request.auto_check_status,
    'provisional_access_granted_at',v_request.provisional_access_granted_at,
    'provisional_access_expires_at',v_request.provisional_access_expires_at,
    'provisional_access_active',v_provisional_active,
    'prepaid_activation',v_prepaid,
    'source',case when v_cycle.id is not null then 'automatic_billing_cycle' else 'derived_entitlement' end
  );
end;
$function$;
