-- IT verification has no automatic three-day review deadline.
-- Slip OCR is preliminary; IT retains manual approval and rejection/locking.
-- Existing PAID-package expiry grace remains unchanged.

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
  v_deadline timestamptz:=null;
  v_transfer_at timestamptz;
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
  begin
    if coalesce(v_parsed->>'transfer_datetime','') !~
       '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?(Z|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'transfer_datetime_invalid';
    end if;
    v_transfer_at := (v_parsed->>'transfer_datetime')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'transfer_datetime_invalid';
  end;
  if v_transfer_at is null
    or v_transfer_at < now()-interval '7 days'
    or v_transfer_at > now()+interval '10 minutes' then
    raise exception 'transfer_datetime_out_of_range';
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
      provisional_access_expires_at=null,
      provisional_access_revoked_at=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'slip_ai',p_scan,
        'payer_name',coalesce(v_parsed->>'payer_name',''),
        'transfer_reference',v_ref,
        'transfer_at',coalesce(v_parsed->>'transfer_datetime',''),
        'provisional_access',true,
        'provisional_access_expires_at',null
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
      grace_until=null,
      access_locked=false,
      lock_reason='subscription_payment_provisional_review',
      payment_review_status='under_review',
      payment_reviewed_at=null,
      payment_reviewed_by=null,
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'provisional_payment_request_id',p_request_id,
        'provisional_access_started_at',now(),
        'provisional_access_expires_at',null
      )
  where tenant_id=v_req.tenant_id;

  insert into public.tenant_subscription_approval_events(
    tenant_id,payment_request_id,action,actor_id,from_status,to_status,metadata
  ) values (
    v_req.tenant_id,p_request_id,'unlock',p_actor_id,'pending','under_review',
    jsonb_build_object(
      'provisional',true,
      'it_confirmation_required',true,
      'billing_cycle_id',v_cycle.id,
      'auto_check_status','passed'
    )
  );

  return jsonb_build_object(
    'granted',true,
    'status','under_review',
    'tenant_id',v_req.tenant_id,
    'billing_cycle_id',v_cycle.id,
    'it_confirmation_required',true,
    'provisional_access_expires_at',null
  );
end;
$function$


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
  v_retention jsonb;
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
        when ((p_as_of at time zone 'Asia/Bangkok')::date-bc.period_start)>3
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

  -- IT alone decides approval/rejection; no elapsed-time review lock.

  -- Paid packages keep access for exactly three days after expiry.
  update public.tenant_data_lifecycle l
  set lifecycle_status='grace',
      grace_until=l.subscription_expires_at+interval '3 days',
      access_locked=false,
      lock_reason='subscription_payment_grace',
      retention_until=l.subscription_expires_at+interval '30 days',
      updated_at=p_as_of,
      metadata=coalesce(metadata,'{}'::jsonb)
        ||jsonb_build_object(
          'paid_access_grace_days',3,
          'paid_retention_days',30,
          'deletion_requires_it_confirmation',true
        )
  where l.lifecycle_status in ('active','grace','expired')
    and l.first_package_started_at is not null
    and l.subscription_expires_at is not null
    and l.subscription_expires_at<=p_as_of
    and p_as_of<=l.subscription_expires_at+interval '3 days'
    and coalesce(l.lock_reason,'') not in (
      'subscription_payment_rejected',
      'subscription_payment_review_timeout'
    );
  get diagnostics v_rows=row_count;
  v_grace:=v_grace+v_rows;

  -- A valid provisional IT payment review overrides the ordinary lock.
  update public.tenant_data_lifecycle l
  set lifecycle_status='grace',
      grace_until=null,
      access_locked=false,
      lock_reason='subscription_payment_provisional_review',
      payment_review_status='under_review',
      updated_at=p_as_of
  from public.tenant_subscription_payment_requests r
  where r.tenant_id=l.tenant_id
    and r.status='under_review'
    and r.provisional_access_granted_at is not null
    and r.provisional_access_revoked_at is null
    and r.auto_check_status='passed';
  get diagnostics v_rows=row_count;
  v_grace:=v_grace+v_rows;

  -- Trial access ends at the configured trial expiry (normally day 7).
  -- Data and integrations are retained until 8 days later (day 15 total)
  -- and then go to IT review; nothing is auto-deleted.
  update public.tenant_data_lifecycle l
  set lifecycle_status='expired',
      access_locked=true,
      grace_until=null,
      retention_until=l.trial_expires_at+interval '8 days',
      lock_reason='trial_expired',
      updated_at=p_as_of,
      metadata=coalesce(metadata,'{}'::jsonb)
        ||jsonb_build_object(
          'trial_access_days',7,
          'trial_deletion_review_days_from_start',15,
          'deletion_requires_it_confirmation',true
        )
  where l.lifecycle_status in ('trial','expired')
    and l.first_package_started_at is null
    and coalesce(l.lock_reason,'') not in ('subscription_payment_rejected','subscription_payment_review_timeout')
    and l.trial_expires_at is not null
    and l.trial_expires_at<=p_as_of
    and not exists(
      select 1 from public.tenant_subscription_payment_requests r
      where r.tenant_id=l.tenant_id
        and r.status='under_review'
        and r.provisional_access_revoked_at is null
        and r.auto_check_status='passed'
    );
  get diagnostics v_rows=row_count;
  v_locked:=v_locked+v_rows;

  -- Paid package after three-day access grace: lock access, retain all data/integrations
  -- through day 30, then require explicit IT confirmation for deletion.
  update public.tenant_data_lifecycle l
  set lifecycle_status='expired',
      access_locked=true,
      grace_until=null,
      retention_until=l.subscription_expires_at+interval '30 days',
      lock_reason='subscription_payment_support_required',
      updated_at=p_as_of,
      metadata=coalesce(metadata,'{}'::jsonb)
        ||jsonb_build_object(
          'support_required',true,
          'support_required_at',p_as_of,
          'paid_access_grace_days',3,
          'paid_retention_days',30,
          'deletion_requires_it_confirmation',true
        )
  where l.first_package_started_at is not null
    and l.subscription_expires_at is not null
    and p_as_of>l.subscription_expires_at+interval '3 days'
    and l.lifecycle_status in ('active','grace','expired')
    and not exists(
      select 1 from public.tenant_subscription_payment_requests r
      where r.tenant_id=l.tenant_id
        and r.status='under_review'
        and r.provisional_access_revoked_at is null
        and r.auto_check_status='passed'
    )
    and coalesce(l.lock_reason,'') not in (
      'subscription_payment_rejected',
      'subscription_payment_review_timeout'
    );
  get diagnostics v_rows=row_count;
  v_locked:=v_locked+v_rows;

  v_retention:=app.refresh_tenant_deletion_reviews(p_as_of);

  return jsonb_build_object(
    'cycles_opened_or_synced',v_opened,
    'grace_rows',v_grace,
    'locked_rows',v_locked,
    'review_timeouts',v_timeout,
    'retention_reviews',v_retention,
    'ran_at',p_as_of
  );
end;
$function$

