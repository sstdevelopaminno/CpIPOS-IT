-- Suspended/cancelled/inactive stores do not receive payable billing state or automatic renewal reminders.

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

  if not coalesce(v_tenant.is_active,false)
     or v_lifecycle.lifecycle_status in ('sales_demo','suspended','cancelled')
     or v_contract.status in ('suspended','cancelled')
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
