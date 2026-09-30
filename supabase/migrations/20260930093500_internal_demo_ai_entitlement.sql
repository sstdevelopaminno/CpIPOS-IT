-- Preserve CpiPOS AI access for internal demo / quota-exempt stores.
-- These stores are not ordinary Growth customers and must remain available for product testing.
begin;

with internal_demo_tenants as (
  select tenant_id
  from public.tenant_data_lifecycle
  where lifecycle_status = 'sales_demo'
     or coalesce((metadata->>'quota_exempt')::boolean, false) = true
     or coalesce((metadata->>'internal_demo')::boolean, false) = true
)
update public.pos_ai_tenant_quota_overrides q
set quota_mode = 'unlimited',
    is_enabled_override = true,
    monthly_request_limit = null,
    monthly_token_limit = null,
    monthly_cost_limit_usd = null,
    updated_at = now()
where q.tenant_id in (select tenant_id from internal_demo_tenants);

with internal_demo_tenants as (
  select tenant_id
  from public.tenant_data_lifecycle
  where lifecycle_status = 'sales_demo'
     or coalesce((metadata->>'quota_exempt')::boolean, false) = true
     or coalesce((metadata->>'internal_demo')::boolean, false) = true
)
insert into public.pos_ai_tenant_quota_overrides(
  tenant_id, quota_mode, is_enabled_override,
  monthly_request_limit, monthly_token_limit, monthly_cost_limit_usd
)
select tenant_id, 'unlimited', true, null, null, null
from internal_demo_tenants d
where not exists (
  select 1
  from public.pos_ai_tenant_quota_overrides q
  where q.tenant_id = d.tenant_id
);

with internal_demo_tenants as (
  select tenant_id
  from public.tenant_data_lifecycle
  where lifecycle_status = 'sales_demo'
     or coalesce((metadata->>'quota_exempt')::boolean, false) = true
     or coalesce((metadata->>'internal_demo')::boolean, false) = true
)
update public.tenant_feature_subscriptions tfs
set is_enabled = true,
    source = 'internal_demo_ai',
    updated_at = now()
where tfs.feature_code = 'cpipos_ai'
  and tfs.branch_id is null
  and tfs.tenant_id in (select tenant_id from internal_demo_tenants);

with internal_demo_tenants as (
  select tenant_id
  from public.tenant_data_lifecycle
  where lifecycle_status = 'sales_demo'
     or coalesce((metadata->>'quota_exempt')::boolean, false) = true
     or coalesce((metadata->>'internal_demo')::boolean, false) = true
)
insert into public.tenant_feature_subscriptions(
  tenant_id, branch_id, feature_code, is_enabled, source
)
select tenant_id, null, 'cpipos_ai', true, 'internal_demo_ai'
from internal_demo_tenants d
where not exists (
  select 1
  from public.tenant_feature_subscriptions tfs
  where tfs.tenant_id = d.tenant_id
    and tfs.branch_id is null
    and tfs.feature_code = 'cpipos_ai'
);

commit;
