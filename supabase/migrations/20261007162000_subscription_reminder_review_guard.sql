-- Do not send renewal reminders while a provisional payment is under IT review
-- or after the account has moved to Support-only recovery.

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
