-- Automatic subscription billing lifecycle.
-- Tenants / Stores contract dates are the billing anchor.
-- Billing opens 7 days before due, stays self-service through 7 days overdue,
-- and then requires Support. A verified slip can grant 3-day provisional access
-- while IT performs the final bank-receipt confirmation.

alter table public.tenant_billing_cycles
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.tenant_subscription_payment_requests
  add column if not exists auto_check_status text not null default 'not_run',
  add column if not exists auto_check_reason text,
  add column if not exists provisional_access_granted_at timestamptz,
  add column if not exists provisional_access_expires_at timestamptz,
  add column if not exists provisional_access_revoked_at timestamptz;

alter table public.tenant_subscription_payment_requests
  drop constraint if exists tenant_subscription_payment_requests_auto_check_status_chk;
alter table public.tenant_subscription_payment_requests
  add constraint tenant_subscription_payment_requests_auto_check_status_chk
  check (auto_check_status in ('not_run','passed','needs_review','failed'));

create unique index if not exists tenant_billing_cycles_unique_period_idx
  on public.tenant_billing_cycles(tenant_id,package_id,period_start,period_end)
  where status <> 'cancelled';

create index if not exists tenant_payment_requests_provisional_deadline_idx
  on public.tenant_subscription_payment_requests(provisional_access_expires_at)
  where status='under_review' and provisional_access_revoked_at is null;

create table if not exists public.tenant_subscription_support_requests(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  billing_cycle_id uuid references public.tenant_billing_cycles(id) on delete set null,
  payment_request_id uuid references public.tenant_subscription_payment_requests(id) on delete set null,
  reason_code text not null,
  source text not null default 'pos',
  requested_by uuid,
  message text,
  status text not null default 'queued',
  email_status text,
  email_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tenant_subscription_support_requests
  drop constraint if exists tenant_subscription_support_requests_status_chk;
alter table public.tenant_subscription_support_requests
  add constraint tenant_subscription_support_requests_status_chk
  check(status in ('queued','sent','failed','resolved'));
create index if not exists tenant_subscription_support_requests_tenant_created_idx
  on public.tenant_subscription_support_requests(tenant_id,created_at desc);
alter table public.tenant_subscription_support_requests enable row level security;
revoke all on public.tenant_subscription_support_requests from public,anon,authenticated;
grant all on public.tenant_subscription_support_requests to service_role;

create or replace function app.billing_period_end_date(p_start date,p_interval text)
returns date
language sql
immutable
as $function$
  select case when p_interval='yearly'
    then (p_start + interval '1 year')::date
    else (p_start + interval '1 month')::date
  end;
$function$;

create or replace function app.ensure_tenant_subscription_billing_cycle(
  p_tenant_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,app
as $function$
declare
  v_tenant public.tenants%rowtype;
  v_contract public.tenant_subscription_contracts%rowtype;
  v_lifecycle public.tenant_data_lifecycle%rowtype;
  v_package public.subscription_packages%rowtype;
  v_cycle public.tenant_billing_cycles%rowtype;
  v_due timestamptz;
  v_start date;
  v_end date;
  v_interval text;
  v_amount numeric(12,2);
  v_days integer;
  v_status text;
  v_now timestamptz:=coalesce(p_as_of,now());
begin
  select * into v_tenant from public.tenants where id=p_tenant_id;
  if not found or not coalesce(v_tenant.is_active,false) then
    return jsonb_build_object('created',false,'reason','tenant_inactive');
  end if;

  select * into v_contract
  from public.tenant_subscription_contracts
  where tenant_id=p_tenant_id
  order by created_at desc,id desc
  limit 1;
  if v_contract.id is null or v_contract.status in ('cancelled','suspended') then
    return jsonb_build_object('created',false,'reason','contract_not_billable');
  end if;

  select * into v_lifecycle from public.tenant_data_lifecycle where tenant_id=p_tenant_id;
  if v_lifecycle.tenant_id is null
     or v_lifecycle.lifecycle_status in ('sales_demo','suspended','archived')
     or coalesce(v_lifecycle.metadata->>'quota_exempt','false')='true' then
    return jsonb_build_object('created',false,'reason','lifecycle_not_billable');
  end if;

  select * into v_package from public.subscription_packages where id=v_contract.package_id;
  if v_package.id is null then
    return jsonb_build_object('created',false,'reason','package_missing');
  end if;

  v_interval:=case when v_contract.billing_interval='yearly' then 'yearly' else 'monthly' end;
  v_amount:=coalesce(
    nullif(v_contract.amount_per_cycle,0),
    case when v_interval='yearly' then v_package.yearly_price else v_package.monthly_price end
  );
  if coalesce(v_amount,0)<=0 then
    return jsonb_build_object('created',false,'reason','amount_missing');
  end if;

  if v_contract.status='trial'
     or (v_lifecycle.lifecycle_status='trial' and v_lifecycle.first_package_started_at is null) then
    v_due:=coalesce(v_lifecycle.trial_expires_at,v_contract.ended_at);
  else
    v_due:=coalesce(v_lifecycle.subscription_expires_at,v_contract.ended_at);
  end if;
  if v_due is null then
    return jsonb_build_object('created',false,'reason','due_date_missing');
  end if;

  v_start:=(v_due at time zone 'Asia/Bangkok')::date;
  v_end:=app.billing_period_end_date(v_start,v_interval);
  v_days:=v_start-(v_now at time zone 'Asia/Bangkok')::date;

  if v_days>7 then
    return jsonb_build_object(
      'created',false,'reason','not_open_yet','days_until_due',v_days,
      'period_start',v_start,'period_end',v_end
    );
  end if;

  v_status:=case
    when v_days < -7 then 'support_required'
    when v_days < 0 then 'overdue'
    when v_days = 0 then 'due'
    else 'open'
  end;

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
    case when bc.period_start=v_start then 0 else 1 end,
    bc.created_at desc,bc.id desc
  limit 1
  for update;

  if v_cycle.id is null then
    insert into public.tenant_billing_cycles(
      tenant_id,package_id,period_start,period_end,
      amount_due,amount_paid,status,metadata,updated_at
    ) values (
      p_tenant_id,v_package.id,v_start,v_end,
      round(v_amount,2),0,v_status,
      jsonb_build_object(
        'source','automatic_contract_cycle',
        'contract_id',v_contract.id,
        'billing_interval',v_interval,
        'opened_at',v_now
      ),
      v_now
    )
    returning * into v_cycle;
  else
    update public.tenant_billing_cycles
    set period_start=v_start,
        period_end=v_end,
        amount_due=round(v_amount,2),
        status=v_status,
        updated_at=v_now,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'source','automatic_contract_cycle',
          'contract_id',v_contract.id,
          'billing_interval',v_interval,
          'last_synced_at',v_now
        )
    where id=v_cycle.id
    returning * into v_cycle;
  end if;

  return jsonb_build_object(
    'created',true,
    'billing_cycle_id',v_cycle.id,
    'status',v_cycle.status,
    'period_start',v_cycle.period_start,
    'period_end',v_cycle.period_end,
    'amount_due',v_cycle.amount_due,
    'amount_paid',v_cycle.amount_paid,
    'days_until_due',v_days,
    'contract_id',v_contract.id
  );
end;
$function$;

revoke all on function app.ensure_tenant_subscription_billing_cycle(uuid,timestamptz)
from public,anon,authenticated;
grant execute on function app.ensure_tenant_subscription_billing_cycle(uuid,timestamptz) to service_role;

create or replace function public.ensure_tenant_subscription_billing_cycle(
  p_tenant_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
security definer
set search_path=pg_catalog,public,app
as $function$
  select app.ensure_tenant_subscription_billing_cycle(p_tenant_id,p_as_of);
$function$;
revoke all on function public.ensure_tenant_subscription_billing_cycle(uuid,timestamptz)
from public,anon,authenticated;
grant execute on function public.ensure_tenant_subscription_billing_cycle(uuid,timestamptz) to service_role;

create or replace function app.subscription_billing_due_state(
  p_tenant_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path=pg_catalog,public,app
as $function$
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

  v_provisional_active:=v_request.id is not null
    and v_request.status='under_review'
    and v_request.provisional_access_granted_at is not null
    and v_request.provisional_access_revoked_at is null
    and v_request.provisional_access_expires_at is not null
    and v_request.provisional_access_expires_at>v_now;

  v_support:=v_days < -7
    or coalesce(v_lifecycle.lock_reason,'') in (
      'subscription_payment_support_required',
      'subscription_payment_review_timeout',
      'subscription_payment_rejected'
    )
    or (
      v_request.id is not null
      and v_request.status='under_review'
      and v_request.provisional_access_expires_at is not null
      and v_request.provisional_access_expires_at<=v_now
    );

  if v_prepaid then
    v_status:='prepaid';
  elsif v_provisional_active then
    v_status:='provisional_review';
  elsif v_support then
    v_status:='support_required';
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

revoke all on function app.subscription_billing_due_state(uuid,timestamptz)
from public,anon,authenticated;
grant execute on function app.subscription_billing_due_state(uuid,timestamptz) to service_role;

create or replace function public.subscription_billing_due_state(
  p_tenant_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path=pg_catalog,public,app
as $function$
  select app.subscription_billing_due_state(p_tenant_id,p_as_of);
$function$;
revoke all on function public.subscription_billing_due_state(uuid,timestamptz)
from public,anon,authenticated;
grant execute on function public.subscription_billing_due_state(uuid,timestamptz) to service_role;

create or replace function app.grant_provisional_subscription_access(
  p_request_id uuid,
  p_scan jsonb,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,app
as $function$
declare
  v_req public.tenant_subscription_payment_requests%rowtype;
  v_cycle public.tenant_billing_cycles%rowtype;
  v_lifecycle public.tenant_data_lifecycle%rowtype;
  v_expected numeric(12,2);
  v_amount numeric(12,2);
  v_ref text;
  v_deadline timestamptz:=now()+interval '3 days';
  v_overdue integer;
  v_checks jsonb:=coalesce(p_scan->'checks','{}'::jsonb);
  v_parsed jsonb:=coalesce(p_scan->'parsed','{}'::jsonb);
begin
  select * into v_req
  from public.tenant_subscription_payment_requests
  where id=p_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  if v_req.status<>'pending' then raise exception 'payment_request_not_pending'; end if;
  if coalesce(v_req.metadata->>'kind','')<>'payment_notice' then
    raise exception 'payment_notice_required';
  end if;

  if coalesce(p_scan->>'status','')<>'verified'
     or coalesce((v_checks->>'amount_match')::boolean,false)=false
     or coalesce((v_checks->>'payee_match')::boolean,false)=false
     or coalesce((v_checks->>'datetime_present')::boolean,false)=false
     or coalesce((v_checks->>'confidence_pass')::boolean,false)=false
     or coalesce((v_checks->>'passed')::boolean,false)=false then
    update public.tenant_subscription_payment_requests
    set auto_check_status='needs_review',
        auto_check_reason='slip_scan_not_verified',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('slip_ai',p_scan),
        updated_at=now()
    where id=p_request_id;
    return jsonb_build_object('granted',false,'status','needs_review');
  end if;

  if coalesce(v_req.metadata->>'billing_cycle_id','')='' then
    raise exception 'billing_cycle_required';
  end if;
  begin
    select * into v_cycle
    from public.tenant_billing_cycles
    where id=(v_req.metadata->>'billing_cycle_id')::uuid
      and tenant_id=v_req.tenant_id
    for update;
  exception when invalid_text_representation then
    raise exception 'billing_cycle_invalid';
  end;
  if v_cycle.id is null then raise exception 'billing_cycle_not_found'; end if;
  if v_cycle.status in ('paid','cancelled','support_required') then
    raise exception 'billing_cycle_not_self_service';
  end if;

  v_overdue:=(now() at time zone 'Asia/Bangkok')::date-v_cycle.period_start;
  if v_overdue>7 then raise exception 'billing_support_required'; end if;

  v_expected:=round(greatest(0,coalesce(v_cycle.amount_due,0)-coalesce(v_cycle.amount_paid,0))::numeric,2);
  begin
    v_amount:=round((v_parsed->>'amount')::numeric,2);
  exception when invalid_text_representation or numeric_value_out_of_range then
    v_amount:=null;
  end;
  if v_amount is null or v_amount<>v_expected then
    raise exception 'verified_amount_mismatch';
  end if;

  v_ref:=coalesce(
    nullif(trim(v_parsed->>'reference_no'),''),
    nullif(trim(v_parsed->>'transaction_id'),'')
  );
  if v_ref is null or char_length(v_ref)<4 then
    raise exception 'slip_reference_missing';
  end if;

  if exists(
    select 1 from public.tenant_subscription_settlements s
    where trim(coalesce(s.bank_transaction_reference,''))=v_ref
  ) or exists(
    select 1
    from public.tenant_subscription_payment_requests r
    where r.id<>p_request_id
      and (
        trim(coalesce(r.metadata#>>'{slip_ai,parsed,reference_no}',''))=v_ref
        or trim(coalesce(r.metadata#>>'{slip_ai,parsed,transaction_id}',''))=v_ref
      )
  ) then
    raise exception 'slip_reference_already_used';
  end if;

  update public.tenant_subscription_payment_requests
  set status='under_review',
      amount_reported=v_amount,
      auto_check_status='passed',
      auto_check_reason='amount_payee_datetime_confidence_reference_passed',
      provisional_access_granted_at=now(),
      provisional_access_expires_at=v_deadline,
      provisional_access_revoked_at=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'slip_ai',p_scan,
        'payer_name',coalesce(v_parsed->>'payer_name',''),
        'transfer_reference',v_ref,
        'transfer_at',coalesce(v_parsed->>'transfer_datetime',''),
        'provisional_access',true,
        'provisional_access_expires_at',v_deadline
      ),
      updated_at=now()
  where id=p_request_id;

  select * into v_lifecycle
  from public.tenant_data_lifecycle
  where tenant_id=v_req.tenant_id
  for update;
  if not found then raise exception 'tenant_lifecycle_not_found'; end if;

  update public.tenant_data_lifecycle
  set lifecycle_status=case
        when access_locked
          or (lifecycle_status='trial' and trial_expires_at is not null and trial_expires_at<=now())
          or (lifecycle_status in ('active','grace') and subscription_expires_at is not null and subscription_expires_at<=now())
        then 'grace'
        else lifecycle_status
      end,
      grace_until=greatest(
        coalesce(grace_until,v_deadline),
        v_deadline,
        coalesce(trial_expires_at,v_deadline)
      ),
      access_locked=false,
      lock_reason='subscription_payment_provisional_review',
      payment_review_status='under_review',
      payment_reviewed_at=null,
      payment_reviewed_by=null,
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'provisional_payment_request_id',p_request_id,
        'provisional_access_started_at',now(),
        'provisional_access_expires_at',v_deadline
      )
  where tenant_id=v_req.tenant_id;

  insert into public.tenant_subscription_approval_events(
    tenant_id,payment_request_id,action,actor_id,from_status,to_status,metadata
  ) values (
    v_req.tenant_id,p_request_id,'unlock',p_actor_id,'pending','under_review',
    jsonb_build_object(
      'provisional',true,
      'review_deadline',v_deadline,
      'billing_cycle_id',v_cycle.id,
      'auto_check_status','passed'
    )
  );

  return jsonb_build_object(
    'granted',true,
    'status','under_review',
    'tenant_id',v_req.tenant_id,
    'billing_cycle_id',v_cycle.id,
    'review_deadline',v_deadline,
    'provisional_access_expires_at',v_deadline
  );
end;
$function$;
revoke all on function app.grant_provisional_subscription_access(uuid,jsonb,uuid)
from public,anon,authenticated;
grant execute on function app.grant_provisional_subscription_access(uuid,jsonb,uuid) to service_role;

create or replace function public.grant_provisional_subscription_access(
  p_request_id uuid,
  p_scan jsonb,
  p_actor_id uuid default null
)
returns jsonb
language sql
security definer
set search_path=pg_catalog,public,app
as $function$
  select app.grant_provisional_subscription_access(p_request_id,p_scan,p_actor_id);
$function$;
revoke all on function public.grant_provisional_subscription_access(uuid,jsonb,uuid)
from public,anon,authenticated;
grant execute on function public.grant_provisional_subscription_access(uuid,jsonb,uuid) to service_role;

create or replace function app.revoke_provisional_subscription_access(
  p_request_id uuid,
  p_reason text,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,app
as $function$
declare
  v_req public.tenant_subscription_payment_requests%rowtype;
  v_reason text:=coalesce(nullif(trim(p_reason),''),'subscription_payment_rejected');
begin
  select * into v_req
  from public.tenant_subscription_payment_requests
  where id=p_request_id
  for update;
  if not found then raise exception 'payment_request_not_found'; end if;
  if v_req.provisional_access_granted_at is null then
    return jsonb_build_object('revoked',false,'reason','provisional_not_granted');
  end if;
  if exists(
    select 1 from public.tenant_subscription_settlements s
    where s.payment_request_id=p_request_id
  ) then
    return jsonb_build_object('revoked',false,'reason','already_settled');
  end if;

  update public.tenant_subscription_payment_requests
  set provisional_access_revoked_at=coalesce(provisional_access_revoked_at,now()),
      auto_check_reason=v_reason,
      updated_at=now()
  where id=p_request_id;

  update public.tenant_data_lifecycle
  set lifecycle_status='expired',
      access_locked=true,
      grace_until=null,
      lock_reason=case
        when v_reason='it_review_timeout' then 'subscription_payment_review_timeout'
        else 'subscription_payment_rejected'
      end,
      payment_review_status=case
        when v_reason='it_review_timeout' then 'under_review'
        else 'rejected'
      end,
      payment_reviewed_at=case
        when v_reason='it_review_timeout' then payment_reviewed_at
        else now()
      end,
      payment_reviewed_by=case
        when v_reason='it_review_timeout' then payment_reviewed_by
        else p_actor_id
      end,
      updated_at=now(),
      metadata=(coalesce(metadata,'{}'::jsonb)-'provisional_access_expires_at')
        ||jsonb_build_object(
          'last_provisional_revoke_reason',v_reason,
          'last_provisional_revoked_at',now(),
          'support_required',true
        )
  where tenant_id=v_req.tenant_id;

  return jsonb_build_object(
    'revoked',true,'tenant_id',v_req.tenant_id,'reason',v_reason
  );
end;
$function$;
revoke all on function app.revoke_provisional_subscription_access(uuid,text,uuid)
from public,anon,authenticated;
grant execute on function app.revoke_provisional_subscription_access(uuid,text,uuid) to service_role;

create or replace function public.revoke_provisional_subscription_access(
  p_request_id uuid,
  p_reason text,
  p_actor_id uuid default null
)
returns jsonb
language sql
security definer
set search_path=pg_catalog,public,app
as $function$
  select app.revoke_provisional_subscription_access(p_request_id,p_reason,p_actor_id);
$function$;
revoke all on function public.revoke_provisional_subscription_access(uuid,text,uuid)
from public,anon,authenticated;
grant execute on function public.revoke_provisional_subscription_access(uuid,text,uuid) to service_role;

create or replace function app.subscription_payment_rejection_lock()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,app
as $function$
begin
  if new.status='rejected'
     and old.status is distinct from new.status
     and new.provisional_access_granted_at is not null
     and new.provisional_access_revoked_at is null then
    perform app.revoke_provisional_subscription_access(
      new.id,'it_rejected',new.reviewed_by
    );
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_subscription_payment_rejection_lock
on public.tenant_subscription_payment_requests;
create trigger trg_subscription_payment_rejection_lock
after update of status
on public.tenant_subscription_payment_requests
for each row
execute function app.subscription_payment_rejection_lock();

create or replace function app.refresh_subscription_billing_lifecycle(
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,app
as $function$
declare
  v_row record;
  v_opened integer:=0;
  v_locked integer:=0;
  v_grace integer:=0;
  v_timeout integer:=0;
  v_result jsonb;
  v_rows integer;
begin
  for v_row in
    select t.id
    from public.tenants t
    join public.tenant_data_lifecycle l on l.tenant_id=t.id
    where t.is_active=true
      and l.lifecycle_status not in ('sales_demo','suspended','archived')
  loop
    v_result:=app.ensure_tenant_subscription_billing_cycle(v_row.id,p_as_of);
    if coalesce((v_result->>'created')::boolean,false) then
      v_opened:=v_opened+1;
    end if;
  end loop;

  update public.tenant_billing_cycles bc
  set status=case
        when ((p_as_of at time zone 'Asia/Bangkok')::date-bc.period_start)>7
          then 'support_required'
        when bc.period_start<(p_as_of at time zone 'Asia/Bangkok')::date
          then 'overdue'
        when bc.period_start=(p_as_of at time zone 'Asia/Bangkok')::date
          then 'due'
        else 'open'
      end,
      updated_at=p_as_of
  where bc.status not in ('paid','cancelled')
    and coalesce(bc.amount_paid,0)<coalesce(bc.amount_due,0)
    and not exists(
      select 1 from public.tenant_subscription_settlements s
      where s.billing_cycle_id=bc.id
    );

  for v_row in
    select r.id
    from public.tenant_subscription_payment_requests r
    where r.status='under_review'
      and r.provisional_access_granted_at is not null
      and r.provisional_access_revoked_at is null
      and r.provisional_access_expires_at is not null
      and r.provisional_access_expires_at<=p_as_of
      and not exists(
        select 1 from public.tenant_subscription_settlements s
        where s.payment_request_id=r.id
      )
  loop
    perform app.revoke_provisional_subscription_access(
      v_row.id,'it_review_timeout',null
    );
    v_timeout:=v_timeout+1;
  end loop;

  -- Paid subscriptions remain usable for up to 7 days after due.
  update public.tenant_data_lifecycle l
  set lifecycle_status='grace',
      grace_until=l.subscription_expires_at+interval '7 days',
      access_locked=false,
      lock_reason='subscription_payment_grace',
      updated_at=p_as_of
  where l.lifecycle_status in ('active','grace')
    and l.subscription_expires_at is not null
    and l.subscription_expires_at<=p_as_of
    and p_as_of<=l.subscription_expires_at+interval '7 days'
    and coalesce(l.lock_reason,'') not in (
      'subscription_payment_rejected',
      'subscription_payment_review_timeout'
    );
  get diagnostics v_rows=row_count;
  v_grace:=v_grace+v_rows;

  -- A valid provisional review overrides ordinary post-due state.
  update public.tenant_data_lifecycle l
  set lifecycle_status='grace',
      grace_until=greatest(
        coalesce(l.grace_until,p_as_of),
        r.provisional_access_expires_at,
        coalesce(l.trial_expires_at,p_as_of)
      ),
      access_locked=false,
      lock_reason='subscription_payment_provisional_review',
      payment_review_status='under_review',
      updated_at=p_as_of
  from public.tenant_subscription_payment_requests r
  where r.tenant_id=l.tenant_id
    and r.status='under_review'
    and r.provisional_access_granted_at is not null
    and r.provisional_access_revoked_at is null
    and r.provisional_access_expires_at>p_as_of;
  get diagnostics v_rows=row_count;
  v_grace:=v_grace+v_rows;

  -- Trial has no free 7-day usage extension; only provisional review can unlock it.
  update public.tenant_data_lifecycle l
  set lifecycle_status='expired',
      access_locked=true,
      grace_until=null,
      lock_reason='trial_expired',
      updated_at=p_as_of
  where l.lifecycle_status='trial'
    and l.trial_expires_at is not null
    and l.trial_expires_at<=p_as_of
    and not exists(
      select 1 from public.tenant_subscription_payment_requests r
      where r.tenant_id=l.tenant_id
        and r.status='under_review'
        and r.provisional_access_revoked_at is null
        and r.provisional_access_expires_at>p_as_of
    );
  get diagnostics v_rows=row_count;
  v_locked:=v_locked+v_rows;

  -- More than seven days overdue: no self-service payment, Support only.
  update public.tenant_data_lifecycle l
  set lifecycle_status='expired',
      access_locked=true,
      grace_until=null,
      lock_reason='subscription_payment_support_required',
      updated_at=p_as_of,
      metadata=coalesce(metadata,'{}'::jsonb)
        ||jsonb_build_object(
          'support_required',true,
          'support_required_at',p_as_of
        )
  where l.subscription_expires_at is not null
    and p_as_of>l.subscription_expires_at+interval '7 days'
    and l.lifecycle_status in ('active','grace','expired')
    and not exists(
      select 1 from public.tenant_subscription_payment_requests r
      where r.tenant_id=l.tenant_id
        and r.status='under_review'
        and r.provisional_access_revoked_at is null
        and r.provisional_access_expires_at>p_as_of
    )
    and coalesce(l.lock_reason,'') not in (
      'subscription_payment_rejected',
      'subscription_payment_review_timeout'
    );
  get diagnostics v_rows=row_count;
  v_locked:=v_locked+v_rows;

  return jsonb_build_object(
    'cycles_opened_or_synced',v_opened,
    'grace_rows',v_grace,
    'locked_rows',v_locked,
    'review_timeouts',v_timeout,
    'ran_at',p_as_of
  );
end;
$function$;
revoke all on function app.refresh_subscription_billing_lifecycle(timestamptz)
from public,anon,authenticated;
grant execute on function app.refresh_subscription_billing_lifecycle(timestamptz) to service_role;

create or replace function app.refresh_subscription_locks()
returns integer
language plpgsql
security definer
set search_path=pg_catalog,public,app
as $function$
declare v jsonb;
begin
  v:=app.refresh_subscription_billing_lifecycle(now());
  return coalesce((v->>'locked_rows')::integer,0)
    +coalesce((v->>'review_timeouts')::integer,0);
end;
$function$;
revoke all on function app.refresh_subscription_locks() from public,anon,authenticated;
grant execute on function app.refresh_subscription_locks() to service_role;

create or replace function app.reconcile_subscription_billing_period_to_contract(
  p_contract_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,app
as $function$
declare
  v_contract public.tenant_subscription_contracts%rowtype;
  v_settlement public.tenant_subscription_settlements%rowtype;
  v_cycle public.tenant_billing_cycles%rowtype;
  v_receipt public.tenant_subscription_receipts%rowtype;
  v_open_cycle public.tenant_billing_cycles%rowtype;
  v_start date;
  v_end date;
  v_next_start date;
  v_next_end date;
  v_actor uuid;
  v_reason text:=nullif(left(trim(coalesce(p_reason,'')),600),'');
begin
  select * into v_contract
  from public.tenant_subscription_contracts
  where id=p_contract_id
  for update;
  if not found then raise exception 'contract_not_found'; end if;
  if v_contract.started_at is null
     or v_contract.ended_at is null
     or v_contract.ended_at<=v_contract.started_at then
    return jsonb_build_object('reconciled',false,'reason','contract_window_invalid');
  end if;

  v_start:=(v_contract.started_at at time zone 'Asia/Bangkok')::date;
  v_end:=(v_contract.ended_at at time zone 'Asia/Bangkok')::date;
  v_next_start:=v_end;
  v_next_end:=app.billing_period_end_date(
    v_next_start,
    case when v_contract.billing_interval='yearly' then 'yearly' else 'monthly' end
  );

  select s.* into v_settlement
  from public.tenant_subscription_settlements s
  where s.tenant_id=v_contract.tenant_id
    and s.package_id=v_contract.package_id
  order by s.created_at desc,s.id desc
  limit 1;

  if v_settlement.id is not null then
    select * into v_cycle
    from public.tenant_billing_cycles
    where id=v_settlement.billing_cycle_id
    for update;

    if v_cycle.id is not null
       and (v_cycle.period_start<>v_start or v_cycle.period_end<>v_end) then
      update public.tenant_billing_cycles
      set period_start=v_start,
          period_end=v_end,
          updated_at=now(),
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'period_source','tenant_contract_admin_correction',
            'contract_id',v_contract.id,
            'corrected_at',now()
          )
      where id=v_cycle.id;

      select * into v_receipt
      from public.tenant_subscription_receipts
      where billing_cycle_id=v_cycle.id
      order by issued_at desc
      limit 1;

      if v_receipt.id is not null then
        insert into public.tenant_subscription_receipt_annotations(
          receipt_id,tenant_id,correction_note,updated_at,updated_by,metadata
        ) values (
          v_receipt.id,v_contract.tenant_id,
          coalesce(v_reason,'แก้ไขช่วงบริการให้ตรงตามสัญญา Tenants / Stores')
            ||' · ช่วงบริการที่ถูกต้อง '||v_start::text||' ถึง '||v_end::text
            ||' · ยอดรับเงินจริง เลขอ้างอิงธนาคาร เลขที่ใบเสร็จ และ Settlement เดิมไม่เปลี่ยนแปลง',
          now(),p_actor_id,
          jsonb_build_object(
            'source','tenant_contract_period_reconciliation',
            'contract_id',v_contract.id,
            'original_period_start',v_receipt.package_snapshot->>'period_start',
            'original_period_end',v_receipt.package_snapshot->>'period_end',
            'corrected_period_start',v_start,
            'corrected_period_end',v_end,
            'settlement_immutable',true,
            'receipt_snapshot_immutable',true
          )
        )
        on conflict(receipt_id) do update set
          correction_note=excluded.correction_note,
          updated_at=excluded.updated_at,
          updated_by=excluded.updated_by,
          metadata=coalesce(public.tenant_subscription_receipt_annotations.metadata,'{}'::jsonb)
            ||excluded.metadata;
      end if;
    end if;
  end if;

  select bc.* into v_open_cycle
  from public.tenant_billing_cycles bc
  where bc.tenant_id=v_contract.tenant_id
    and bc.package_id=v_contract.package_id
    and bc.status not in ('paid','cancelled')
    and coalesce(bc.amount_paid,0)<coalesce(bc.amount_due,0)
    and not exists(
      select 1 from public.tenant_subscription_settlements s
      where s.billing_cycle_id=bc.id
    )
  order by bc.created_at desc
  limit 1
  for update;

  if v_open_cycle.id is not null then
    update public.tenant_billing_cycles
    set period_start=v_next_start,
        period_end=v_next_end,
        amount_due=coalesce(nullif(v_contract.amount_per_cycle,0),amount_due),
        updated_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'source','tenant_contract_admin_correction',
          'contract_id',v_contract.id,
          'last_synced_at',now()
        )
    where id=v_open_cycle.id;
  end if;

  update public.tenant_data_lifecycle
  set first_package_started_at=coalesce(first_package_started_at,v_contract.started_at),
      current_package_started_at=v_contract.started_at,
      subscription_expires_at=case
        when lifecycle_status='trial' then subscription_expires_at
        else v_contract.ended_at
      end,
      updated_at=now()
  where tenant_id=v_contract.tenant_id;

  select id into v_actor from public.users_profiles where id=p_actor_id;
  if v_actor is not null then
    insert into public.audit_logs(
      tenant_id,actor_user_id,actor_role,action,target_table,target_id,metadata,
      user_id,role,module,entity_type,entity_id,before_data,after_data
    ) values (
      v_contract.tenant_id,v_actor,'it_admin',
      'subscription_billing_period_contract_reconciled',
      'tenant_subscription_contracts',v_contract.id,
      jsonb_build_object(
        'reason',v_reason,'contract_id',v_contract.id,
        'financial_records_immutable',true
      ),
      v_actor,'it_admin','it_admin',
      'tenant_subscription_contracts',v_contract.id::text,
      '{}'::jsonb,
      jsonb_build_object(
        'current_period_start',v_start,
        'current_period_end',v_end,
        'next_period_start',v_next_start,
        'next_period_end',v_next_end
      )
    );
  end if;

  return jsonb_build_object(
    'reconciled',true,
    'tenant_id',v_contract.tenant_id,
    'contract_id',v_contract.id,
    'current_period_start',v_start,
    'current_period_end',v_end,
    'next_period_start',v_next_start,
    'next_period_end',v_next_end,
    'financial_records_immutable',true
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
  select app.reconcile_subscription_billing_period_to_contract(
    p_contract_id,p_actor_id,p_reason
  );
$function$;
revoke all on function public.reconcile_subscription_billing_period_to_contract(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function public.reconcile_subscription_billing_period_to_contract(uuid,uuid,text)
to service_role;

do $do$
declare v_job bigint;
begin
  for v_job in
    select jobid from cron.job
    where jobname in (
      'cpipos_subscription_lock_hourly',
      'cpipos_subscription_billing_lifecycle'
    )
  loop
    perform cron.unschedule(v_job);
  end loop;

  perform cron.schedule(
    'cpipos_subscription_billing_lifecycle',
    '*/15 * * * *',
    'select app.refresh_subscription_billing_lifecycle(now());'
  );
end
$do$;
