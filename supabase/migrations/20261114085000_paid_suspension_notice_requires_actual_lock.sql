-- Never tell a paying customer they are suspended unless the authoritative lifecycle is actually locked.
-- Provisional/under_review evidence may keep POS access open after the normal grace boundary.
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
        and (due->>'days_until_due')::integer in (-3,-10,-17,-24)
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
