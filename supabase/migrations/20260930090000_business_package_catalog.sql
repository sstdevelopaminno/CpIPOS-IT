-- Canonical CpIPOS commercial catalog: Starter -> Growth -> Business -> CUSTOM.
-- Business is the premium fixed package and includes CpiPOS AI + all sales modes.
-- CUSTOM remains contract/IT managed.
begin;

-- Replace the previous "all standard plans = 6 months" trigger.
-- Standard plans now carry their own retention (Starter 6, Growth 12, Business 24).
create or replace function app.enforce_package_commercial_rules()
returns trigger
language plpgsql
set search_path = pg_catalog, public, app
as $
begin
  new.monthly_discount_percent := greatest(0, least(100, coalesce(new.monthly_discount_percent,0)));
  new.yearly_discount_percent := greatest(0, least(100, coalesce(new.yearly_discount_percent,0)));

  if coalesce(new.quota_mode,'standard') = 'standard' then
    new.retention_months := greatest(1, least(120, coalesce(new.retention_months,6)));
  end if;

  if lower(coalesce(new.code,'')) = 'custom' then
    new.quota_mode := 'custom';
    new.monthly_price := 0;
    new.yearly_price := 0;
    new.retention_months := null;
    new.metadata := coalesce(new.metadata,'{}'::jsonb)
      || jsonb_build_object(
        'contact_sales', true,
        'it_admin_managed', true,
        'custom_contract_required', true,
        'device_quota_source', 'tenant_contract'
      );
  end if;

  new.updated_at := now();
  return new;
end;
$;

drop trigger if exists trg_subscription_packages_commercial_rules on public.subscription_packages;
create trigger trg_subscription_packages_commercial_rules
before insert or update on public.subscription_packages
for each row execute function app.enforce_package_commercial_rules();

-- Retention workers must follow the active package, not the retired global six-month rule.
create or replace function app.sales_retention_months_for_tenant(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $
  select greatest(
    1,
    least(
      120,
      case
        when coalesce(sp.quota_mode,'standard') = 'custom' then
          coalesce(
            cpt.retention_months,
            case
              when coalesce(tdl.metadata->>'sales_retention_months','') ~ '^[1-9][0-9]{0,2}-- Starter: 350/month, 3,780/year effective (10% off 4,200 list).
update public.subscription_packages
set name = 'Starter',
    monthly_price = 350,
    yearly_price = 3780,
    max_branches = 1,
    max_devices = 1,
    max_users = 4,
    max_products = 1000,
    monthly_bill_limit = 3000,
    storage_limit_gb = 3,
    retention_months = 6,
    max_staff_users = 2,
    max_owner_users = 1,
    max_manager_users = 1,
    csv_export_enabled = true,
    tablet_pos_enabled = true,
    windows_pos_enabled = true,
    quota_mode = 'standard',
    display_order = 1,
    is_active = true,
    status = 'active',
    metadata = (coalesce(metadata,'{}'::jsonb)
      - 'catalog_hidden' - 'audit_history_only' - 'legacy_reference_only' - 'retired_reason' - 'superseded_by')
      || jsonb_build_object(
        'public_package', true,
        'canonical_package', true,
        'catalog_revision', '2026-09-30-business-tier',
        'annual_discount_percent', 10,
        'yearly_list_price', 4200,
        'sales_mode_limit', 1,
        'default_sales_modes', jsonb_build_array('general_sale'),
        'ai_included', false,
        'ai_addon_available', false,
        'full_feature_bundle', false
      ),
    updated_at = now()
where code = 'starter';

-- Growth: 550/month, 5,940/year effective (10% off 6,600 list).
update public.subscription_packages
set name = 'Growth',
    monthly_price = 550,
    yearly_price = 5940,
    max_branches = 1,
    max_devices = 2,
    max_users = 9,
    max_products = 2000,
    monthly_bill_limit = 5000,
    storage_limit_gb = 5,
    retention_months = 12,
    max_staff_users = 5,
    max_owner_users = 2,
    max_manager_users = 2,
    csv_export_enabled = true,
    tablet_pos_enabled = true,
    windows_pos_enabled = true,
    quota_mode = 'standard',
    display_order = 2,
    is_active = true,
    status = 'active',
    metadata = (coalesce(metadata,'{}'::jsonb)
      - 'catalog_hidden' - 'audit_history_only' - 'legacy_reference_only' - 'retired_reason' - 'superseded_by')
      || jsonb_build_object(
        'public_package', true,
        'canonical_package', true,
        'recommended', true,
        'catalog_revision', '2026-09-30-business-tier',
        'annual_discount_percent', 10,
        'yearly_list_price', 6600,
        'sales_mode_limit', 3,
        'default_sales_modes', jsonb_build_array('general_sale','takeaway','dine_in'),
        'ai_included', false,
        'ai_addon_available', true,
        'ai_addon_monthly_price', 299,
        'ai_addon_monthly_requests', 500,
        'full_feature_bundle', false
      ),
    updated_at = now()
where code = 'growth';

-- Re-activate the historical Business row when it exists.
update public.subscription_packages
set name = 'Business',
    monthly_price = 1500,
    yearly_price = 16200,
    max_branches = 2,
    max_devices = 4,
    max_users = 20,
    max_products = 5000,
    monthly_bill_limit = 10000,
    storage_limit_gb = 10,
    retention_months = 24,
    max_staff_users = 14,
    max_owner_users = 3,
    max_manager_users = 3,
    csv_export_enabled = true,
    tablet_pos_enabled = true,
    windows_pos_enabled = true,
    mobile_app_enabled = false,
    quota_mode = 'standard',
    display_order = 3,
    is_active = true,
    status = 'active',
    metadata = (coalesce(metadata,'{}'::jsonb)
      - 'catalog_hidden' - 'audit_history_only' - 'legacy_reference_only' - 'retired_reason' - 'superseded_by' - 'runtime_entitlements_removed')
      || jsonb_build_object(
        'public_package', true,
        'canonical_package', true,
        'recommended_premium', true,
        'catalog_revision', '2026-09-30-business-tier',
        'annual_discount_percent', 10,
        'yearly_list_price', 18000,
        'sales_mode_limit', 5,
        'default_sales_modes', jsonb_build_array('general_sale','takeaway','dine_in','buffet_table','delivery'),
        'ai_included', true,
        'ai_monthly_requests', 2000,
        'full_feature_bundle', true
      ),
    updated_at = now()
where code = 'business';

-- Create Business if a very old database has no historical row.
insert into public.subscription_packages (
  code, name, monthly_price, yearly_price, max_branches, max_devices, max_users,
  max_products, monthly_bill_limit, storage_limit_gb, retention_months,
  max_staff_users, max_owner_users, max_manager_users,
  csv_export_enabled, tablet_pos_enabled, windows_pos_enabled, mobile_app_enabled,
  quota_mode, display_order, is_active, status, metadata
)
select
  'business','Business',1500,16200,2,4,20,
  5000,10000,10,24,14,3,3,
  true,true,true,false,
  'standard',3,true,'active',
  jsonb_build_object(
    'public_package', true,
    'canonical_package', true,
    'recommended_premium', true,
    'catalog_revision', '2026-09-30-business-tier',
    'annual_discount_percent', 10,
    'yearly_list_price', 18000,
    'sales_mode_limit', 5,
    'default_sales_modes', jsonb_build_array('general_sale','takeaway','dine_in','buffet_table','delivery'),
    'ai_included', true,
    'ai_monthly_requests', 2000,
    'full_feature_bundle', true
  )
where not exists (select 1 from public.subscription_packages where code = 'business');

update public.subscription_packages
set name = 'CUSTOM',
    monthly_price = 0,
    yearly_price = 0,
    display_order = 4,
    is_active = true,
    status = 'active',
    quota_mode = 'custom',
    metadata = (coalesce(metadata,'{}'::jsonb)
      - 'catalog_hidden' - 'audit_history_only' - 'legacy_reference_only' - 'retired_reason' - 'superseded_by')
      || jsonb_build_object(
        'public_package', true,
        'canonical_package', true,
        'contact_sales', true,
        'custom_contract_required', true,
        'it_admin_managed', true,
        'catalog_revision', '2026-09-30-business-tier',
        'sales_mode_limit', null,
        'ai_included', true,
        'ai_quota_source', 'tenant_contract'
      ),
    updated_at = now()
where code = 'custom';

-- Only the four commercial plans are selectable.
update public.subscription_packages
set is_active = false,
    status = 'retired',
    display_order = null,
    metadata = (coalesce(metadata,'{}'::jsonb)
      - 'public_package' - 'canonical_package')
      || jsonb_build_object(
        'public_package', false,
        'canonical_package', false,
        'catalog_hidden', true,
        'audit_history_only', true,
        'retired_reason', 'replaced_by_2026_09_business_tier'
      ),
    updated_at = now()
where code not in ('starter','growth','business','custom')
  and (is_active = true or status <> 'retired');

-- CpiPOS AI is a commercial add-on / included feature.
insert into public.package_feature_catalog(
  code,name,description,default_monthly_price,default_yearly_price,default_perpetual_price,
  included_by_default,priced_per_branch,is_active
)
values (
  'cpipos_ai',
  'CpiPOS AI',
  'AI assistant for sales, margin, stock and marketing analysis. Growth may buy the add-on; Business includes it.',
  299,3229,0,false,false,true
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    default_monthly_price = excluded.default_monthly_price,
    default_yearly_price = excluded.default_yearly_price,
    default_perpetual_price = excluded.default_perpetual_price,
    included_by_default = excluded.included_by_default,
    priced_per_branch = excluded.priced_per_branch,
    is_active = true,
    updated_at = now();

-- Business includes the full commercial POS feature catalog.
insert into public.subscription_package_features(package_id, feature_code, included)
select p.id, f.code, true
from public.subscription_packages p
join public.package_feature_catalog f on f.is_active = true
where p.code = 'business'
  and f.code not like 'pos.%'
on conflict (package_id, feature_code)
do update set included = excluded.included;

-- AI package policy: Starter/Growth do not include AI by default.
-- Growth can be enabled as the 299 THB/month add-on through the tenant AI override.
insert into public.pos_ai_package_quotas(
  package_id,is_enabled,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd
)
select id,
       case code when 'starter' then false when 'growth' then false else true end,
       case code when 'business' then 2000 else null end,
       case code when 'business' then 20000000 else null end,
       case code when 'business' then 10 else null end
from public.subscription_packages
where code in ('starter','growth','business','custom')
on conflict (package_id) do update
set is_enabled = excluded.is_enabled,
    monthly_request_limit = excluded.monthly_request_limit,
    monthly_token_limit = excluded.monthly_token_limit,
    monthly_cost_limit_usd = excluded.monthly_cost_limit_usd,
    updated_at = now();

-- Internal sales-demo stores remain able to test AI regardless of their commercial
-- package. Customer Growth stores must buy the add-on via an explicit tenant override.
insert into public.pos_ai_tenant_quota_overrides(
  tenant_id,quota_mode,is_enabled_override,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd
)
select tdl.tenant_id,'unlimited',true,null,null,null
from public.tenant_data_lifecycle tdl
where tdl.lifecycle_status = 'sales_demo'
on conflict (tenant_id) do update
set quota_mode = 'unlimited',
    is_enabled_override = true,
    monthly_request_limit = null,
    monthly_token_limit = null,
    monthly_cost_limit_usd = null,
    updated_at = now();

commit;

                then (tdl.metadata->>'sales_retention_months')::integer
              else null
            end,
            6
          )
        else coalesce(sp.retention_months,6)
      end
    )
  )
  from public.tenants t
  left join public.subscription_packages sp on sp.id = t.package_id
  left join public.tenant_data_lifecycle tdl on tdl.tenant_id = t.id
  left join public.tenant_custom_package_terms cpt
    on cpt.tenant_id = t.id
   and cpt.package_id = sp.id
   and cpt.status in ('approved','active')
  where t.id = p_tenant_id;
$;

revoke all on function app.sales_retention_months_for_tenant(uuid) from public, anon, authenticated;
grant execute on function app.sales_retention_months_for_tenant(uuid) to service_role;

-- Starter: 350/month, 3,780/year effective (10% off 4,200 list).
update public.subscription_packages
set name = 'Starter',
    monthly_price = 350,
    yearly_price = 3780,
    max_branches = 1,
    max_devices = 1,
    max_users = 4,
    max_products = 1000,
    monthly_bill_limit = 3000,
    storage_limit_gb = 3,
    retention_months = 6,
    max_staff_users = 2,
    max_owner_users = 1,
    max_manager_users = 1,
    csv_export_enabled = true,
    tablet_pos_enabled = true,
    windows_pos_enabled = true,
    quota_mode = 'standard',
    display_order = 1,
    is_active = true,
    status = 'active',
    metadata = (coalesce(metadata,'{}'::jsonb)
      - 'catalog_hidden' - 'audit_history_only' - 'legacy_reference_only' - 'retired_reason' - 'superseded_by')
      || jsonb_build_object(
        'public_package', true,
        'canonical_package', true,
        'catalog_revision', '2026-09-30-business-tier',
        'annual_discount_percent', 10,
        'yearly_list_price', 4200,
        'sales_mode_limit', 1,
        'default_sales_modes', jsonb_build_array('general_sale'),
        'ai_included', false,
        'ai_addon_available', false,
        'full_feature_bundle', false
      ),
    updated_at = now()
where code = 'starter';

-- Growth: 550/month, 5,940/year effective (10% off 6,600 list).
update public.subscription_packages
set name = 'Growth',
    monthly_price = 550,
    yearly_price = 5940,
    max_branches = 1,
    max_devices = 2,
    max_users = 9,
    max_products = 2000,
    monthly_bill_limit = 5000,
    storage_limit_gb = 5,
    retention_months = 12,
    max_staff_users = 5,
    max_owner_users = 2,
    max_manager_users = 2,
    csv_export_enabled = true,
    tablet_pos_enabled = true,
    windows_pos_enabled = true,
    quota_mode = 'standard',
    display_order = 2,
    is_active = true,
    status = 'active',
    metadata = (coalesce(metadata,'{}'::jsonb)
      - 'catalog_hidden' - 'audit_history_only' - 'legacy_reference_only' - 'retired_reason' - 'superseded_by')
      || jsonb_build_object(
        'public_package', true,
        'canonical_package', true,
        'recommended', true,
        'catalog_revision', '2026-09-30-business-tier',
        'annual_discount_percent', 10,
        'yearly_list_price', 6600,
        'sales_mode_limit', 3,
        'default_sales_modes', jsonb_build_array('general_sale','takeaway','dine_in'),
        'ai_included', false,
        'ai_addon_available', true,
        'ai_addon_monthly_price', 299,
        'ai_addon_monthly_requests', 500,
        'full_feature_bundle', false
      ),
    updated_at = now()
where code = 'growth';

-- Re-activate the historical Business row when it exists.
update public.subscription_packages
set name = 'Business',
    monthly_price = 1500,
    yearly_price = 16200,
    max_branches = 2,
    max_devices = 4,
    max_users = 20,
    max_products = 5000,
    monthly_bill_limit = 10000,
    storage_limit_gb = 10,
    retention_months = 24,
    max_staff_users = 14,
    max_owner_users = 3,
    max_manager_users = 3,
    csv_export_enabled = true,
    tablet_pos_enabled = true,
    windows_pos_enabled = true,
    mobile_app_enabled = false,
    quota_mode = 'standard',
    display_order = 3,
    is_active = true,
    status = 'active',
    metadata = (coalesce(metadata,'{}'::jsonb)
      - 'catalog_hidden' - 'audit_history_only' - 'legacy_reference_only' - 'retired_reason' - 'superseded_by' - 'runtime_entitlements_removed')
      || jsonb_build_object(
        'public_package', true,
        'canonical_package', true,
        'recommended_premium', true,
        'catalog_revision', '2026-09-30-business-tier',
        'annual_discount_percent', 10,
        'yearly_list_price', 18000,
        'sales_mode_limit', 5,
        'default_sales_modes', jsonb_build_array('general_sale','takeaway','dine_in','buffet_table','delivery'),
        'ai_included', true,
        'ai_monthly_requests', 2000,
        'full_feature_bundle', true
      ),
    updated_at = now()
where code = 'business';

-- Create Business if a very old database has no historical row.
insert into public.subscription_packages (
  code, name, monthly_price, yearly_price, max_branches, max_devices, max_users,
  max_products, monthly_bill_limit, storage_limit_gb, retention_months,
  max_staff_users, max_owner_users, max_manager_users,
  csv_export_enabled, tablet_pos_enabled, windows_pos_enabled, mobile_app_enabled,
  quota_mode, display_order, is_active, status, metadata
)
select
  'business','Business',1500,16200,2,4,20,
  5000,10000,10,24,14,3,3,
  true,true,true,false,
  'standard',3,true,'active',
  jsonb_build_object(
    'public_package', true,
    'canonical_package', true,
    'recommended_premium', true,
    'catalog_revision', '2026-09-30-business-tier',
    'annual_discount_percent', 10,
    'yearly_list_price', 18000,
    'sales_mode_limit', 5,
    'default_sales_modes', jsonb_build_array('general_sale','takeaway','dine_in','buffet_table','delivery'),
    'ai_included', true,
    'ai_monthly_requests', 2000,
    'full_feature_bundle', true
  )
where not exists (select 1 from public.subscription_packages where code = 'business');

update public.subscription_packages
set name = 'CUSTOM',
    monthly_price = 0,
    yearly_price = 0,
    display_order = 4,
    is_active = true,
    status = 'active',
    quota_mode = 'custom',
    metadata = (coalesce(metadata,'{}'::jsonb)
      - 'catalog_hidden' - 'audit_history_only' - 'legacy_reference_only' - 'retired_reason' - 'superseded_by')
      || jsonb_build_object(
        'public_package', true,
        'canonical_package', true,
        'contact_sales', true,
        'custom_contract_required', true,
        'it_admin_managed', true,
        'catalog_revision', '2026-09-30-business-tier',
        'sales_mode_limit', null,
        'ai_included', true,
        'ai_quota_source', 'tenant_contract'
      ),
    updated_at = now()
where code = 'custom';

-- Only the four commercial plans are selectable.
update public.subscription_packages
set is_active = false,
    status = 'retired',
    display_order = null,
    metadata = (coalesce(metadata,'{}'::jsonb)
      - 'public_package' - 'canonical_package')
      || jsonb_build_object(
        'public_package', false,
        'canonical_package', false,
        'catalog_hidden', true,
        'audit_history_only', true,
        'retired_reason', 'replaced_by_2026_09_business_tier'
      ),
    updated_at = now()
where code not in ('starter','growth','business','custom')
  and (is_active = true or status <> 'retired');

-- CpiPOS AI is a commercial add-on / included feature.
insert into public.package_feature_catalog(
  code,name,description,default_monthly_price,default_yearly_price,default_perpetual_price,
  included_by_default,priced_per_branch,is_active
)
values (
  'cpipos_ai',
  'CpiPOS AI',
  'AI assistant for sales, margin, stock and marketing analysis. Growth may buy the add-on; Business includes it.',
  299,3229,0,false,false,true
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    default_monthly_price = excluded.default_monthly_price,
    default_yearly_price = excluded.default_yearly_price,
    default_perpetual_price = excluded.default_perpetual_price,
    included_by_default = excluded.included_by_default,
    priced_per_branch = excluded.priced_per_branch,
    is_active = true,
    updated_at = now();

-- Business includes the full commercial POS feature catalog.
insert into public.subscription_package_features(package_id, feature_code, included)
select p.id, f.code, true
from public.subscription_packages p
join public.package_feature_catalog f on f.is_active = true
where p.code = 'business'
  and f.code not like 'pos.%'
on conflict (package_id, feature_code)
do update set included = excluded.included;

-- AI package policy: Starter/Growth do not include AI by default.
-- Growth can be enabled as the 299 THB/month add-on through the tenant AI override.
insert into public.pos_ai_package_quotas(
  package_id,is_enabled,monthly_request_limit,monthly_token_limit,monthly_cost_limit_usd
)
select id,
       case code when 'starter' then false when 'growth' then false else true end,
       case code when 'business' then 2000 else null end,
       case code when 'business' then 20000000 else null end,
       case code when 'business' then 10 else null end
from public.subscription_packages
where code in ('starter','growth','business','custom')
on conflict (package_id) do update
set is_enabled = excluded.is_enabled,
    monthly_request_limit = excluded.monthly_request_limit,
    monthly_token_limit = excluded.monthly_token_limit,
    monthly_cost_limit_usd = excluded.monthly_cost_limit_usd,
    updated_at = now();

commit;
