-- CpiPOS paid packages: two entire unpaid billing months of usable POS access,
-- then suspend sales and preserve business data for another 30 days pending IT review.
-- Free 7-day trials and IT rejection/security suspensions are unchanged.
-- Create an independently priced second monthly invoice only when it becomes due;
-- approved discount triggers remain the authoritative pricing mechanism.

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
    when v_now >= (v_due + interval '2 months') then 'support_required'
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

  -- Open the SECOND unpaid month as its own immutable cycle only when the
  -- customer is genuinely using that second month of paid grace. The existing
  -- BEFORE INSERT trigger applies any approved tenant discount for that date.
  -- Never shift or replace the first unpaid invoice; IT must settle oldest first.
  if v_interval='monthly'
     and v_lifecycle.first_package_started_at is not null
     and v_now >= v_due + interval '1 month'
     and v_now < v_due + interval '2 months'
     and exists(
       select 1 from public.tenant_billing_cycles bc
       where bc.tenant_id=p_tenant_id
         and bc.package_id=v_package.id
         and bc.period_start=v_start
         and bc.status not in ('paid','cancelled')
         and coalesce(bc.amount_paid,0)<coalesce(bc.amount_due,0)
     ) then
    insert into public.tenant_billing_cycles(
      tenant_id,package_id,period_start,period_end,
      amount_due,amount_paid,status,metadata,updated_at
    ) values (
      p_tenant_id,v_package.id,
      app.billing_period_end_date(v_start,'monthly'),
      app.billing_period_end_date(app.billing_period_end_date(v_start,'monthly'),'monthly'),
      round(v_amount,2),0,
      case when (v_now at time zone 'Asia/Bangkok')::date=app.billing_period_end_date(v_start,'monthly')
        then 'due' else 'overdue' end,
      jsonb_build_object('source','automatic_contract_cycle','contract_id',v_contract.id,
        'billing_interval','monthly','grace_second_unpaid_cycle',true,'opened_at',v_now),
      v_now
    )
    on conflict (tenant_id,package_id,period_start,period_end)
      where status <> 'cancelled'
    do nothing;
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
        when p_as_of >= ((bc.period_start::timestamp at time zone 'Asia/Bangkok') + interval '2 months')
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

  -- Paid packages keep access until two calendar months after expiry.
  update public.tenant_data_lifecycle l
  set lifecycle_status='grace',
      grace_until=l.subscription_expires_at+interval '2 months',
      access_locked=false,
      lock_reason='subscription_payment_grace',
      retention_until=l.subscription_expires_at+interval '2 months'+interval '30 days',
      updated_at=p_as_of,
      metadata=coalesce(metadata,'{}'::jsonb)
        ||jsonb_build_object(
          'paid_access_grace_months',2,
          'paid_retention_days',30,
          'deletion_requires_it_confirmation',true
        )
  where l.lifecycle_status in ('active','grace','expired')
    and l.first_package_started_at is not null
    and l.subscription_expires_at is not null
    and l.subscription_expires_at<=p_as_of
    and p_as_of<l.subscription_expires_at+interval '2 months'
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

  -- Paid package after two calendar months of access grace: lock access;
  -- retain business data/integrations a further 30 days, then require IT review.
  update public.tenant_data_lifecycle l
  set lifecycle_status='expired',
      access_locked=true,
      grace_until=null,
      retention_until=l.subscription_expires_at+interval '2 months'+interval '30 days',
      lock_reason='subscription_payment_support_required',
      updated_at=p_as_of,
      metadata=coalesce(metadata,'{}'::jsonb)
        ||jsonb_build_object(
          'support_required',true,
          'support_required_at',p_as_of,
          'paid_access_grace_months',2,
          'paid_retention_days',30,
          'deletion_requires_it_confirmation',true
        )
  where l.first_package_started_at is not null
    and l.subscription_expires_at is not null
    and p_as_of>=l.subscription_expires_at+interval '2 months'
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
$function$;

CREATE OR REPLACE FUNCTION app.refresh_tenant_deletion_reviews(p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
declare
  v_upserted integer := 0;
  v_ready integer := 0;
  v_it_queued integer := 0;
begin
  with candidates as (
    select
      t.id as tenant_id,
      case when l.first_package_started_at is null then 'trial' else 'subscription' end as lifecycle_kind,
      case
        when l.first_package_started_at is null then l.trial_expires_at
        else l.subscription_expires_at
      end as service_ended_at,
      case
        when l.first_package_started_at is null then l.trial_expires_at
        else l.subscription_expires_at + interval '2 months'
      end as access_grace_until,
      case
        -- Standard trial is 7 days; review at day 15 = 8 days after the actual configured trial end.
        when l.first_package_started_at is null then l.trial_expires_at + interval '8 days'
        else l.subscription_expires_at + interval '2 months' + interval '30 days'
      end as deletion_review_at,
      exists (
        select 1 from public.mdm_devices md
        where md.tenant_id=t.id
          and (md.is_device_owner=true or lower(coalesce(md.enrollment_mode,'')) in
            ('android_enterprise_device_owner','fully_managed','dedicated_device'))
      ) as mdm_release_required
    from public.tenants t
    join public.tenant_data_lifecycle l on l.tenant_id=t.id
    where t.is_active=true
      and l.lifecycle_status not in ('sales_demo','suspended','archived')
      and (
        (l.first_package_started_at is null and l.trial_expires_at is not null)
        or
        (l.first_package_started_at is not null and l.subscription_expires_at is not null)
      )
  ), upserted as (
    insert into public.tenant_lifecycle_deletion_reviews(
      tenant_id,lifecycle_kind,service_ended_at,access_grace_until,deletion_review_at,
      review_status,mdm_release_required,metadata,updated_at
    )
    select
      c.tenant_id,c.lifecycle_kind,c.service_ended_at,c.access_grace_until,c.deletion_review_at,
      case
        when p_as_of < c.service_ended_at then 'watching'
        when p_as_of < c.deletion_review_at then 'retention_window'
        else 'ready_for_it_review'
      end,
      c.mdm_release_required,
      jsonb_build_object(
        'policy_version','2026-10-07',
        'trial_access_days',7,
        'trial_review_day',15,
        'paid_access_grace_months',2,
        'paid_retention_days',30,
        'requires_it_confirmation',true
      ),
      p_as_of
    from candidates c
    on conflict (tenant_id) do update
    set
      lifecycle_kind=excluded.lifecycle_kind,
      access_grace_until=excluded.access_grace_until,
      deletion_review_at=excluded.deletion_review_at,
      mdm_release_required=excluded.mdm_release_required,
      metadata=public.tenant_lifecycle_deletion_reviews.metadata || excluded.metadata,
      updated_at=p_as_of,
      service_ended_at=excluded.service_ended_at,
      review_status=case
        -- A renewal/conversion creates a new lifecycle window and cancels stale manual decisions.
        when public.tenant_lifecycle_deletion_reviews.service_ended_at <> excluded.service_ended_at
          or public.tenant_lifecycle_deletion_reviews.lifecycle_kind <> excluded.lifecycle_kind
          then excluded.review_status
        when public.tenant_lifecycle_deletion_reviews.review_status in
          ('keep','delete_approved','mdm_release_pending','ready_to_delete','cancelled')
          then public.tenant_lifecycle_deletion_reviews.review_status
        else excluded.review_status
      end,
      mdm_release_completed_at=case
        when public.tenant_lifecycle_deletion_reviews.service_ended_at <> excluded.service_ended_at
          or public.tenant_lifecycle_deletion_reviews.lifecycle_kind <> excluded.lifecycle_kind
          then null
        else public.tenant_lifecycle_deletion_reviews.mdm_release_completed_at
      end,
      confirmed_by=case
        when public.tenant_lifecycle_deletion_reviews.service_ended_at <> excluded.service_ended_at
          or public.tenant_lifecycle_deletion_reviews.lifecycle_kind <> excluded.lifecycle_kind
          then null
        else public.tenant_lifecycle_deletion_reviews.confirmed_by
      end,
      confirmed_at=case
        when public.tenant_lifecycle_deletion_reviews.service_ended_at <> excluded.service_ended_at
          or public.tenant_lifecycle_deletion_reviews.lifecycle_kind <> excluded.lifecycle_kind
          then null
        else public.tenant_lifecycle_deletion_reviews.confirmed_at
      end
    returning 1
  )
  select count(*) into v_upserted from upserted;

  select count(*) into v_ready
  from public.tenant_lifecycle_deletion_reviews
  where review_status='ready_for_it_review';

  -- Put a single actionable item into the existing IT/Support queue when review is due.
  insert into public.tenant_subscription_support_requests(
    tenant_id,billing_cycle_id,payment_request_id,reason_code,source,
    requested_by,message,status,created_at,updated_at
  )
  select
    r.tenant_id,null,null,
    case when r.lifecycle_kind='trial'
      then 'trial_deletion_review_due'
      else 'subscription_deletion_review_due'
    end,
    'system',null,
    case when r.lifecycle_kind='trial'
      then 'ทดลองใช้ครบช่วงรักษาข้อมูลแล้ว: IT ต้องยืนยันว่าจะเก็บร้านไว้หรือดำเนินการลบถาวร'
      else 'แพ็กเกจหมดอายุครบ 2 เดือนผ่อนผันและเก็บข้อมูลต่ออีก 30 วันแล้ว: IT ต้องตรวจสอบภาระทางบัญชี/กฎหมายก่อนอนุมัติลบถาวร'
    end,
    'queued',p_as_of,p_as_of
  from public.tenant_lifecycle_deletion_reviews r
  where r.review_status='ready_for_it_review'
    and r.it_notified_at is null
    and not exists (
      select 1 from public.tenant_subscription_support_requests sr
      where sr.tenant_id=r.tenant_id
        and sr.reason_code=case when r.lifecycle_kind='trial'
          then 'trial_deletion_review_due'
          else 'subscription_deletion_review_due'
        end
        and sr.status in ('queued','open','in_progress')
    );
  get diagnostics v_it_queued = row_count;

  update public.tenant_lifecycle_deletion_reviews r
  set it_notified_at=p_as_of,updated_at=p_as_of
  where r.review_status='ready_for_it_review'
    and r.it_notified_at is null
    and exists (
      select 1 from public.tenant_subscription_support_requests sr
      where sr.tenant_id=r.tenant_id
        and sr.reason_code=case when r.lifecycle_kind='trial'
          then 'trial_deletion_review_due'
          else 'subscription_deletion_review_due'
        end
        and sr.status in ('queued','open','in_progress')
    );

  return jsonb_build_object(
    'upserted',v_upserted,
    'ready_for_it_review',v_ready,
    'it_notifications_queued',v_it_queued,
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

  -- Verified evidence opens POS while awaiting an explicit IT decision.
  -- No three-day review timeout; IT rejection/revocation still locks immediately.
  v_provisional_active:=v_request.id is not null
    and v_request.status='under_review'
    and v_request.auto_check_status='passed'
    and v_request.provisional_access_granted_at is not null
    and v_request.provisional_access_revoked_at is null
    and not coalesce(v_lifecycle.access_locked,false);

  v_support:=v_now >= (v_expiry + interval '2 months')
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
    and (v_days between 0 and 7 or (v_days < 0 and v_now < v_expiry + interval '2 months'));

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

CREATE OR REPLACE FUNCTION public.subscription_reminder_candidates(p_as_of timestamp with time zone DEFAULT now())
 RETURNS TABLE(tenant_id uuid, store_name text, store_code text, owner_name text, owner_email text, reminder_type text, milestone text, due_at timestamp with time zone, days_remaining integer, package_name text, billing_interval text, amount_due numeric, currency text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$
with standard_base as (
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
), standard_tagged as (
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
      when due->>'kind'='subscription' and (due->>'status') not in ('pending','under_review','provisional_review','support_required','not_payable')
        and (due->>'days_until_due')::integer in (-3,-10,-17,-24,-31,-38,-45,-52)
        then 'paid_grace_day_' || abs((due->>'days_until_due')::integer)::text
      else null
    end milestone
  from standard_base b
), standard_rows as (
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
  from standard_tagged
  where milestone is not null and owner_email<>''
), retention_base as (
  select
    r.tenant_id,
    coalesce(nullif(t.display_name,''),t.name) store_name,
    coalesce(t.code,'') store_code,
    coalesce(nullif(up.full_name,''),nullif(t.owner_name,''),coalesce(nullif(t.display_name,''),t.name)) owner_name,
    coalesce(up.email,'') owner_email,
    r.lifecycle_kind,
    r.access_grace_until,
    l.access_locked as actual_access_locked,
    l.lifecycle_status as actual_lifecycle_status,
    r.deletion_review_at,
    ((r.deletion_review_at at time zone 'Asia/Bangkok')::date-(p_as_of at time zone 'Asia/Bangkok')::date)::integer days_remaining,
    coalesce(sp.name,'CpIPOS') package_name,
    coalesce(c.billing_interval,case when r.lifecycle_kind='trial' then 'trial' else 'monthly' end) billing_interval
  from public.tenant_lifecycle_deletion_reviews r
  join public.tenants t on t.id=r.tenant_id and t.is_active=true
  join public.tenant_data_lifecycle l on l.tenant_id=r.tenant_id
  left join public.users_profiles up
    on up.id=t.primary_owner_user_id and up.is_active=true and up.archived_at is null
  left join lateral (
    select package_id,billing_interval
    from public.tenant_subscription_contracts c0
    where c0.tenant_id=r.tenant_id
    order by created_at desc,id desc
    limit 1
  ) c on true
  left join public.subscription_packages sp on sp.id=c.package_id
  where r.review_status in ('retention_window','ready_for_it_review')
), retention_rows as (
  select
    tenant_id,store_name,store_code,owner_name,owner_email,
    'tenant_deletion_warning'::text reminder_type,
    case
      when lifecycle_kind='subscription' and actual_access_locked=true and actual_lifecycle_status='expired' and (access_grace_until at time zone 'Asia/Bangkok')::date=(p_as_of at time zone 'Asia/Bangkok')::date then 'paid_suspended_notice'
      when lifecycle_kind='trial' and days_remaining=0 then 'trial_retention_final'
      when lifecycle_kind='trial' then 'trial_retention_2d'
      when days_remaining=0 then 'paid_retention_final'
      else 'paid_retention_3d'
    end milestone,
    deletion_review_at due_at,
    days_remaining,
    package_name,
    billing_interval,
    0::numeric amount_due,
    'THB'::text currency
  from retention_base
  where owner_email<>''
    and (
      (lifecycle_kind='subscription' and actual_access_locked=true and actual_lifecycle_status='expired' and (access_grace_until at time zone 'Asia/Bangkok')::date=(p_as_of at time zone 'Asia/Bangkok')::date)
      or (lifecycle_kind='trial' and days_remaining between 1 and 2)
      or (lifecycle_kind='trial' and days_remaining=0)
      or (lifecycle_kind='subscription' and days_remaining between 2 and 3)
      or (lifecycle_kind='subscription' and days_remaining=0)
    )
)
select * from standard_rows
union all
select * from retention_rows
order by due_at,store_name;
$function$;
