-- Public registration sales-mode limits are controlled by the canonical package catalog.
-- The public website reads metadata.sales_mode_limit through /api/store-registration.
begin;

update public.subscription_packages
set metadata = coalesce(metadata, '{}'::jsonb)
  || jsonb_build_object(
    'sales_mode_limit', 1,
    'default_sales_modes', jsonb_build_array('general_sale')
  ),
  updated_at = now()
where code = 'starter';

update public.subscription_packages
set metadata = coalesce(metadata, '{}'::jsonb)
  || jsonb_build_object(
    'sales_mode_limit', 2,
    'default_sales_modes', jsonb_build_array('general_sale', 'takeaway')
  ),
  updated_at = now()
where code = 'growth';

update public.subscription_packages
set metadata = coalesce(metadata, '{}'::jsonb)
  || jsonb_build_object(
    'sales_mode_limit', 3,
    'default_sales_modes', jsonb_build_array('general_sale', 'takeaway', 'dine_in')
  ),
  updated_at = now()
where code = 'business';

commit;
