-- Source-controlled snapshot of the production subscription billing lifecycle.
-- Tenants / Stores contract dates are the billing anchor. Payment scan can grant
-- provisional access for 3 days, but only IT settlement creates paid/receipt facts.

alter table public.tenant_billing_cycles
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.tenant_subscription_payment_requests
  add column if not exists auto_check_status text not null default 'not_run',
  add column if not exists auto_check_reason text,
  add column if not exists provisional_access_granted_at timestamptz,
  add column if not exists provisional_access_expires_at timestamptz,
  add column if not exists provisional_access_revoked_at timestamptz;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='tenant_subscription_payment_requests_auto_check_status_chk') then
    alter table public.tenant_subscription_payment_requests
      add constraint tenant_subscription_payment_requests_auto_check_status_chk
      check (auto_check_status in ('not_run','passed','needs_review','failed'));
  end if;
end $$;

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
  source text not null,
  requested_by uuid,
  message text,
  status text not null default 'queued'
    check(status in ('queued','sent','failed','resolved')),
  email_status text,
  email_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tenant_subscription_support_requests_tenant_created_idx
  on public.tenant_subscription_support_requests(tenant_id,created_at desc);

revoke all on table public.tenant_subscription_support_requests from public,anon,authenticated;
grant select,insert,update on table public.tenant_subscription_support_requests to service_role;


CREATE OR REPLACE FUNCTION app.billing_period_end_date(p_start date, p_interval text)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when p_interval='yearly'
    then (p_start + interval '1 year')::date
    else (p_start + interval '1 month')::date
  end;
$function$;

CREATE OR REPLACE FUNCTION app.ensure_tenant_subscription_billing_cycle(p_tenant_id uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
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

CREATE OR REPLACE FUNCTION public.ensure_tenant_subscription_billing_cycle(p_tenant_id uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
  select app.ensure_tenant_subscription_billing_cycle(p_tenant_id,p_as_of);
$function$;

CREATE OR REPLACE FUNCTION app.grant_provisional_subscription_access(p_request_id uuid, p_scan jsonb, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
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

CREATE OR REPLACE FUNCTION public.grant_provisional_subscription_access(p_request_id uuid, p_scan jsonb, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
  select app.grant_provisional_subscription_access(p_request_id,p_scan,p_actor_id);
$function$;

CREATE OR REPLACE FUNCTION app.revoke_provisional_subscription_access(p_request_id uuid, p_reason text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
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

CREATE OR REPLACE FUNCTION public.revoke_provisional_subscription_access(p_request_id uuid, p_reason text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
  select app.revoke_provisional_subscription_access(p_request_id,p_reason,p_actor_id);
$function$;

CREATE OR REPLACE FUNCTION app.refresh_subscription_billing_lifecycle(p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
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

CREATE OR REPLACE FUNCTION public.subscription_billing_due_state(p_tenant_id uuid, p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
  select app.subscription_billing_due_state(p_tenant_id,p_as_of);
$function$;

CREATE OR REPLACE FUNCTION public.subscription_billing_due_states(p_tenant_ids uuid[], p_as_of timestamp with time zone DEFAULT now())
 RETURNS TABLE(tenant_id uuid, state jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
  select t.id,app.subscription_billing_due_state(t.id,p_as_of)
  from public.tenants t
  where t.id=any(coalesce(p_tenant_ids,'{}'::uuid[]));
$function$;

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

CREATE OR REPLACE FUNCTION app.reconcile_subscription_billing_period_to_contract(p_contract_id uuid, p_actor_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
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

CREATE OR REPLACE FUNCTION public.reconcile_subscription_billing_period_to_contract(p_contract_id uuid, p_actor_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
  select app.reconcile_subscription_billing_period_to_contract(
    p_contract_id,p_actor_id,p_reason
  );
$function$;

CREATE OR REPLACE FUNCTION public.subscription_reminder_candidates(p_as_of timestamp with time zone DEFAULT now())
 RETURNS TABLE(tenant_id uuid, store_name text, store_code text, owner_name text, owner_email text, reminder_type text, milestone text, due_at timestamp with time zone, days_remaining integer, package_name text, billing_interval text, amount_due numeric, currency text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
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
      when due->>'kind'='trial' and (due->>'status') not in ('prepaid','pending','under_review','provisional_review','support_required','not_payable')
        and (due->>'days_until_due')::integer between 2 and 3 then 'trial_3d'
      when due->>'kind'='trial' and (due->>'status') not in ('prepaid','pending','under_review','provisional_review','support_required','not_payable')
        and (due->>'days_until_due')::integer between 0 and 1 then 'trial_1d'
      when due->>'kind'='subscription' and (due->>'status') not in ('pending','under_review','provisional_review','support_required','not_payable')
        and (due->>'days_until_due')::integer between 4 and 7 then 'due_7d'
      when due->>'kind'='subscription' and (due->>'status') not in ('pending','under_review','provisional_review','support_required','not_payable')
        and (due->>'days_until_due')::integer between 2 and 3 then 'due_3d'
      when due->>'kind'='subscription' and (due->>'status') not in ('pending','under_review','provisional_review','support_required','not_payable')
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


revoke all on function public.ensure_tenant_subscription_billing_cycle(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.ensure_tenant_subscription_billing_cycle(uuid,timestamptz) to service_role;
revoke all on function public.grant_provisional_subscription_access(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.grant_provisional_subscription_access(uuid,jsonb,uuid) to service_role;
revoke all on function public.revoke_provisional_subscription_access(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.revoke_provisional_subscription_access(uuid,text,uuid) to service_role;
revoke all on function public.subscription_billing_due_state(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.subscription_billing_due_state(uuid,timestamptz) to service_role;
revoke all on function public.subscription_billing_due_states(uuid[],timestamptz) from public,anon,authenticated;
grant execute on function public.subscription_billing_due_states(uuid[],timestamptz) to service_role;
revoke all on function public.settle_subscription_payment(uuid,uuid,text,timestamptz,numeric,text) from public,anon,authenticated;
grant execute on function public.settle_subscription_payment(uuid,uuid,text,timestamptz,numeric,text) to service_role;
revoke all on function public.reconcile_subscription_billing_period_to_contract(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reconcile_subscription_billing_period_to_contract(uuid,uuid,text) to service_role;

select cron.unschedule(jobid) from cron.job where jobname='cpipos_subscription_billing_lifecycle';
select cron.schedule(
  'cpipos_subscription_billing_lifecycle',
  '*/15 * * * *',
  $$select app.refresh_subscription_billing_lifecycle(now());$$
);
