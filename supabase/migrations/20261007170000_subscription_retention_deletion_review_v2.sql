-- CpIPOS lifecycle retention / deletion confirmation policy.
-- Source-of-truth snapshot for the runtime policy introduced 2026-10-07.
-- Trial: 7 days of access, retain until day 15, then IT review.
-- Paid: 3 days post-expiry access grace, retain data for 30 days, then IT review.
-- Permanent deletion is never automatic.

create table if not exists public.tenant_lifecycle_deletion_reviews(
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  lifecycle_kind text not null check(lifecycle_kind in ('trial','subscription')),
  service_ended_at timestamptz not null,
  access_grace_until timestamptz not null,
  deletion_review_at timestamptz not null,
  review_status text not null default 'watching'
    check(review_status in ('watching','retention_window','ready_for_it_review','keep','delete_approved','mdm_release_pending','ready_to_delete','cancelled')),
  mdm_release_required boolean not null default false,
  mdm_release_completed_at timestamptz,
  it_notified_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  confirmation_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(deletion_review_at >= service_ended_at),
  check(access_grace_until >= service_ended_at)
);

create index if not exists idx_tenant_lifecycle_delete_review_due
  on public.tenant_lifecycle_deletion_reviews(review_status,deletion_review_at);

revoke all on table public.tenant_lifecycle_deletion_reviews from public,anon,authenticated;
grant select,insert,update,delete on table public.tenant_lifecycle_deletion_reviews to service_role;

CREATE OR REPLACE FUNCTION app.refresh_tenant_deletion_reviews(p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$;
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
        else l.subscription_expires_at + interval '3 days'
      end as access_grace_until,
      case
        -- Standard trial is 7 days; review at day 15 = 8 days after the actual configured trial end.
        when l.first_package_started_at is null then l.trial_expires_at + interval '8 days'
        else l.subscription_expires_at + interval '30 days'
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
        'paid_access_grace_days',3,
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
      else 'แพ็กเกจสิ้นสุดและครบ 30 วันรักษาข้อมูลแล้ว: IT ต้องยืนยันว่าจะเก็บร้านไว้หรือดำเนินการลบถาวร'
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


CREATE OR REPLACE FUNCTION app.it_decide_tenant_deletion_review(p_tenant_id uuid, p_action text, p_actor_user_id uuid, p_note text DEFAULT NULL::text, p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$;
declare
  v_review public.tenant_lifecycle_deletion_reviews%rowtype;
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_status text;
begin
  select * into v_review
  from public.tenant_lifecycle_deletion_reviews
  where tenant_id=p_tenant_id
  for update;

  if not found then
    raise exception 'tenant_deletion_review_not_found' using errcode='P0001';
  end if;

  if p_as_of < v_review.deletion_review_at then
    raise exception 'tenant_deletion_review_not_due' using errcode='P0001';
  end if;

  if v_action='keep' then
    update public.tenant_lifecycle_deletion_reviews
    set review_status='keep',
        confirmed_by=p_actor_user_id,
        confirmed_at=p_as_of,
        confirmation_note=nullif(trim(coalesce(p_note,'')),''),
        updated_at=p_as_of
    where tenant_id=p_tenant_id;
    v_status:='keep';

    update public.tenant_subscription_support_requests
    set status='resolved',updated_at=p_as_of
    where tenant_id=p_tenant_id
      and reason_code in ('trial_deletion_review_due','subscription_deletion_review_due')
      and status in ('queued','open','in_progress');

  elsif v_action='delete' then
    -- Lock business access immediately after IT confirms deletion, but preserve
    -- MDM connectivity until Device Owner release is acknowledged.
    update public.tenant_data_lifecycle
    set access_locked=true,
        lock_reason='tenant_deletion_confirmed',
        updated_at=p_as_of,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'deletion_confirmed_at',p_as_of,
          'deletion_confirmed_by',p_actor_user_id,
          'deletion_requires_mdm_release',v_review.mdm_release_required
        )
    where tenant_id=p_tenant_id;

    update public.pos_sessions
    set status='revoked',revoked_at=p_as_of,updated_at=p_as_of
    where tenant_id=p_tenant_id and status='active';

    if v_review.mdm_release_required and v_review.mdm_release_completed_at is null then
      v_status:='mdm_release_pending';
    else
      v_status:='ready_to_delete';
      update public.tenants set is_active=false,updated_at=p_as_of where id=p_tenant_id;
    end if;

    update public.tenant_lifecycle_deletion_reviews
    set review_status=v_status,
        confirmed_by=p_actor_user_id,
        confirmed_at=p_as_of,
        confirmation_note=nullif(trim(coalesce(p_note,'')),''),
        updated_at=p_as_of
    where tenant_id=p_tenant_id;
  else
    raise exception 'tenant_deletion_review_invalid_action' using errcode='22023';
  end if;

  return jsonb_build_object(
    'tenant_id',p_tenant_id,
    'action',v_action,
    'review_status',v_status,
    'mdm_release_required',v_review.mdm_release_required,
    'mdm_release_completed',v_review.mdm_release_completed_at is not null
  );
end;
$function$;


CREATE OR REPLACE FUNCTION app.it_mark_tenant_mdm_release_completed(p_tenant_id uuid, p_actor_user_id uuid, p_note text DEFAULT NULL::text, p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$;
declare
  v_review public.tenant_lifecycle_deletion_reviews%rowtype;
begin
  select * into v_review
  from public.tenant_lifecycle_deletion_reviews
  where tenant_id=p_tenant_id
  for update;

  if not found then
    raise exception 'tenant_deletion_review_not_found' using errcode='P0001';
  end if;
  if v_review.review_status <> 'mdm_release_pending' then
    raise exception 'tenant_mdm_release_not_pending' using errcode='P0001';
  end if;

  update public.tenant_lifecycle_deletion_reviews
  set mdm_release_completed_at=p_as_of,
      review_status='ready_to_delete',
      confirmation_note=concat_ws(E'\n',nullif(confirmation_note,''),nullif(trim(coalesce(p_note,'')),'')),
      updated_at=p_as_of
  where tenant_id=p_tenant_id;

  update public.tenants set is_active=false,updated_at=p_as_of where id=p_tenant_id;

  return jsonb_build_object(
    'tenant_id',p_tenant_id,
    'review_status','ready_to_delete',
    'mdm_release_completed_at',p_as_of,
    'actor_user_id',p_actor_user_id
  );
end;
$function$;


create or replace view public.it_tenant_deletion_review_queue as
select
  r.tenant_id,
  coalesce(nullif(t.display_name,''),t.name) store_name,
  t.code store_code,
  r.lifecycle_kind,
  r.service_ended_at,
  r.access_grace_until,
  r.deletion_review_at,
  r.review_status,
  r.mdm_release_required,
  r.mdm_release_completed_at,
  r.it_notified_at,
  r.confirmed_by,
  r.confirmed_at,
  r.confirmation_note,
  r.metadata,
  r.updated_at
from public.tenant_lifecycle_deletion_reviews r
join public.tenants t on t.id=r.tenant_id;

revoke all on public.it_tenant_deletion_review_queue from public,anon,authenticated;
grant select on public.it_tenant_deletion_review_queue to service_role;

create or replace function public.refresh_tenant_deletion_reviews(p_as_of timestamptz default now())
returns jsonb
language sql
security definer
set search_path=pg_catalog,public,app
as $$
  select app.refresh_tenant_deletion_reviews(p_as_of);
$$;

create or replace function public.it_decide_tenant_deletion_review(
  p_tenant_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_note text default null,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
security definer
set search_path=pg_catalog,public,app
as $$
  select app.it_decide_tenant_deletion_review(p_tenant_id,p_action,p_actor_user_id,p_note,p_as_of);
$$;

create or replace function public.it_mark_tenant_mdm_release_completed(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_note text default null,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
security definer
set search_path=pg_catalog,public,app
as $$
  select app.it_mark_tenant_mdm_release_completed(p_tenant_id,p_actor_user_id,p_note,p_as_of);
$$;

revoke all on function public.refresh_tenant_deletion_reviews(timestamptz) from public,anon,authenticated;
grant execute on function public.refresh_tenant_deletion_reviews(timestamptz) to service_role;
revoke all on function public.it_decide_tenant_deletion_review(uuid,text,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.it_decide_tenant_deletion_review(uuid,text,uuid,text,timestamptz) to service_role;
revoke all on function public.it_mark_tenant_mdm_release_completed(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.it_mark_tenant_mdm_release_completed(uuid,uuid,text,timestamptz) to service_role;

CREATE OR REPLACE FUNCTION app.refresh_subscription_billing_lifecycle(p_as_of timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'app'
AS $function$;
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
        and r.provisional_access_expires_at>p_as_of
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


drop function if exists public.subscription_reminder_candidates(timestamptz);
create function public.subscription_reminder_candidates(p_as_of timestamptz default now())
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
set search_path=pg_catalog,public,app
as $$
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
    r.deletion_review_at,
    ((r.deletion_review_at at time zone 'Asia/Bangkok')::date-(p_as_of at time zone 'Asia/Bangkok')::date)::integer days_remaining,
    coalesce(sp.name,'CpIPOS') package_name,
    coalesce(c.billing_interval,case when r.lifecycle_kind='trial' then 'trial' else 'monthly' end) billing_interval
  from public.tenant_lifecycle_deletion_reviews r
  join public.tenants t on t.id=r.tenant_id and t.is_active=true
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
      (lifecycle_kind='trial' and days_remaining between 1 and 2)
      or (lifecycle_kind='trial' and days_remaining=0)
      or (lifecycle_kind='subscription' and days_remaining between 2 and 3)
      or (lifecycle_kind='subscription' and days_remaining=0)
    )
)
select * from standard_rows
union all
select * from retention_rows
order by due_at,store_name;
$$;

revoke all on function public.subscription_reminder_candidates(timestamptz) from public,anon,authenticated;
grant execute on function public.subscription_reminder_candidates(timestamptz) to service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='cpipos_tenant_deletion_review_refresh' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'cpipos_tenant_deletion_review_refresh',
    '*/15 * * * *',
    'select app.refresh_tenant_deletion_reviews(now());'
  );
end $$;

select app.refresh_tenant_deletion_reviews(now());