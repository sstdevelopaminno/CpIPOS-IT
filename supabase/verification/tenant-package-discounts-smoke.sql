-- CpiPOS-001 read-only post-migration acceptance for NEW YEAR PRIVILEGE 2027.
-- Run with a trusted database role after migration is applied.
-- Never run payments or modify invoices from this script.
with target as (
  select c.tenant_id,c.package_id,c.amount_per_cycle as normal_price
  from public.tenant_subscription_contracts c
  where c.id='f688670e-2822-403f-8137-73dcc16d9c55'
    and c.tenant_id='1f7380a1-197e-4483-975b-0690a7fd82fc'
),
billing_windows as (
  select unnest(array[
    date '2026-11-13',date '2026-12-13',date '2027-01-13',
    date '2027-02-13',date '2027-03-13',date '2027-04-13'
  ]) as cycle_start
)
select
  b.cycle_start,
  t.normal_price,
  (public.tenant_discount_quote(t.tenant_id,t.package_id,b.cycle_start,t.normal_price)->>'percent')::numeric as discount_percent,
  (public.tenant_discount_quote(t.tenant_id,t.package_id,b.cycle_start,t.normal_price)->>'amount_due')::numeric as expected_amount_due,
  case
    when b.cycle_start in (date '2026-11-13',date '2027-04-13') then
      (public.tenant_discount_quote(t.tenant_id,t.package_id,b.cycle_start,t.normal_price)->>'amount_due')::numeric=t.normal_price
    else
      (public.tenant_discount_quote(t.tenant_id,t.package_id,b.cycle_start,t.normal_price)->>'amount_due')::numeric=495
  end as accepted
from target t cross join billing_windows b
order by b.cycle_start;

-- Check only the historical Nov cycle; it must stay at the original amount.
select period_start,period_end,amount_due,amount_paid,status
from public.tenant_billing_cycles
where tenant_id='1f7380a1-197e-4483-975b-0690a7fd82fc'
order by period_start desc limit 10;
