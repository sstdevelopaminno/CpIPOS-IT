-- Retire the pre-receipt paid activation path.
-- Every paid first activation / renewal must now pass through
-- public.settle_subscription_payment(), which atomically creates a paid
-- billing cycle, entitlement update, immutable settlement and receipt.

-- Normalize legacy prepaid-trial metadata into the same IT review queue.
insert into public.tenant_subscription_payment_requests (
  tenant_id,
  requested_package_id,
  request_type,
  amount_reported,
  currency,
  evidence_url,
  status,
  metadata
)
select
  l.tenant_id,
  p.id,
  'trial_conversion',
  case
    when coalesce(l.metadata->>'prepaid_amount_thb','') ~ '^[0-9]+([.][0-9]{1,2})?$'
      then (l.metadata->>'prepaid_amount_thb')::numeric(12,2)
    else p.monthly_price
  end,
  'THB',
  null,
  'pending',
  jsonb_build_object(
    'kind','payment_notice',
    'billing_interval','monthly',
    'expected_amount',p.monthly_price,
    'source','legacy_prepaid_migration',
    'payer_name','',
    'transfer_reference',coalesce(l.metadata->>'prepaid_payment_reference',''),
    'transfer_at',coalesce(l.metadata->>'prepaid_received_at',''),
    'note','Migrated from verified-prepaid legacy metadata; IT must independently reconfirm bank receipt before settlement.'
  )
from public.tenant_data_lifecycle l
join lateral (
  select c0.package_id, c0.status, c0.billing_interval
  from public.tenant_subscription_contracts c0
  where c0.tenant_id=l.tenant_id
  order by c0.created_at desc, c0.id desc
  limit 1
) c on true
join public.subscription_packages p on p.id=c.package_id
where l.metadata->>'prepaid_activation_state'='pending_trial_completion'
  and l.lifecycle_status='trial'
  and c.status='trial'
  and c.billing_interval='monthly'
  and p.is_active=true
  and not exists (
    select 1
    from public.tenant_subscription_payment_requests r
    where r.tenant_id=l.tenant_id
      and r.status in ('pending','under_review')
  );

update public.tenant_data_lifecycle l
set payment_review_status='pending',
    grace_until=case
      when l.trial_expires_at is null then l.grace_until
      else greatest(
        coalesce(l.grace_until,l.trial_expires_at),
        l.trial_expires_at + interval '7 days'
      )
    end,
    metadata=coalesce(l.metadata,'{}'::jsonb) || jsonb_build_object(
      'prepaid_activation_state','awaiting_verified_settlement',
      'legacy_paid_activation_retired_at',now()
    ),
    updated_at=now()
where l.metadata->>'prepaid_activation_state'='pending_trial_completion'
  and exists (
    select 1
    from public.tenant_subscription_payment_requests r
    where r.tenant_id=l.tenant_id
      and r.status in ('pending','under_review')
  );

-- Keep the legacy function signature for callers, but make it fail closed.
create or replace function app.approve_paid_subscription(
  p_tenant_id uuid,
  p_package_code text,
  p_actor_id uuid default null,
  p_payment_request_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $function$
begin
  raise exception 'legacy_paid_activation_disabled_use_settlement';
end;
$function$;

revoke all on function app.approve_paid_subscription(uuid,text,uuid,uuid)
  from public, anon, authenticated;
grant execute on function app.approve_paid_subscription(uuid,text,uuid,uuid)
  to service_role;

-- Expiry automation may lock or grant a short review grace only.
-- It must never activate a paid package.
create or replace function app.refresh_subscription_locks()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $function$
declare
  v_count integer := 0;
  v_rows integer := 0;
begin
  -- A migrated prepaid trial gets at most the configured grace window
  -- while IT independently re-confirms the bank transaction.
  update public.tenant_data_lifecycle l
  set lifecycle_status='grace',
      access_locked=false,
      lock_reason='awaiting_verified_settlement',
      updated_at=now()
  where l.access_locked=false
    and l.lifecycle_status='trial'
    and l.trial_expires_at is not null
    and l.trial_expires_at <= now()
    and l.grace_until is not null
    and l.grace_until > now()
    and l.metadata->>'prepaid_activation_state'='awaiting_verified_settlement'
    and exists (
      select 1
      from public.tenant_subscription_payment_requests r
      where r.tenant_id=l.tenant_id
        and r.status in ('pending','under_review')
        and r.metadata->>'source'='legacy_prepaid_migration'
    );

  -- Ordinary expired trials lock normally.
  update public.tenant_data_lifecycle l
  set access_locked=true,
      lock_reason='trial_expired',
      lifecycle_status='expired',
      updated_at=now()
  where l.access_locked=false
    and l.lifecycle_status='trial'
    and l.trial_expires_at is not null
    and l.trial_expires_at <= now();
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  -- Review grace is finite. If IT does not settle before grace ends,
  -- access locks rather than silently activating without a receipt.
  update public.tenant_data_lifecycle l
  set access_locked=true,
      lock_reason='subscription_payment_unverified',
      lifecycle_status='expired',
      updated_at=now()
  where l.access_locked=false
    and l.lifecycle_status='grace'
    and l.grace_until is not null
    and l.grace_until <= now();
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  update public.tenant_data_lifecycle l
  set access_locked=true,
      lock_reason='subscription_expired',
      updated_at=now()
  where l.access_locked=false
    and l.lifecycle_status='active'
    and l.subscription_expires_at is not null
    and l.subscription_expires_at <= now();
  get diagnostics v_rows = row_count;
  v_count := v_count + v_rows;

  return v_count;
end;
$function$;

revoke all on function app.refresh_subscription_locks() from public, anon, authenticated;
grant execute on function app.refresh_subscription_locks() to service_role;

comment on function app.approve_paid_subscription(uuid,text,uuid,uuid) is
  'Retired paid-activation compatibility function. Always fails closed; use public.settle_subscription_payment so every paid activation has a verified settlement and receipt.';
comment on function app.refresh_subscription_locks() is
  'Expiry enforcement only. Never activates a paid package; legacy prepaid trials receive finite review grace and must settle through the receipt workflow.';
