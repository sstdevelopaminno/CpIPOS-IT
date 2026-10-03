
alter table public.customer_email_deliveries
  drop constraint if exists customer_email_deliveries_event_type_check;

alter table public.customer_email_deliveries
  add constraint customer_email_deliveries_event_type_check
  check (event_type = any (array[
    'store_activation'::text,
    'payment_confirmation'::text,
    'sales_retention_export'::text,
    'daily_sales_summary'::text,
    'daily_sales_summary_test'::text
  ]));

create or replace function public.daily_sales_summary_preview(
  p_tenant_id uuid,
  p_business_date date default null
)
returns table (
  tenant_id uuid,
  store_name text,
  owner_user_id uuid,
  owner_name text,
  owner_email text,
  business_date date,
  completed_count bigint,
  cancelled_count bigint,
  gross_total numeric,
  net_total numeric,
  cash_total numeric,
  bank_transfer_total numeric,
  top_products jsonb
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
with params as (
  select coalesce(
    p_business_date,
    ((now() at time zone 'Asia/Bangkok')::date - 1)
  )::date as business_date
),
bounds as (
  select
    business_date,
    (business_date::timestamp at time zone 'Asia/Bangkok') as from_at,
    ((business_date + 1)::timestamp at time zone 'Asia/Bangkok') as until_at
  from params
),
tenant_scope as (
  select
    t.id as tenant_id,
    coalesce(nullif(t.display_name,''), t.name) as store_name,
    t.primary_owner_user_id as owner_user_id,
    coalesce(nullif(up.full_name,''), nullif(t.owner_name,''), nullif(t.display_name,''), t.name) as owner_name,
    coalesce(up.email,'') as owner_email
  from public.tenants t
  left join public.users_profiles up
    on up.id=t.primary_owner_user_id
   and up.is_active=true
   and up.archived_at is null
  where t.id=p_tenant_id
    and t.is_active=true
),
window_orders as (
  select o.*
  from public.orders o
  join tenant_scope e on e.tenant_id=o.tenant_id
  cross join bounds b
  where o.created_at >= b.from_at
    and o.created_at < b.until_at
    and o.status::text in ('completed','cancelled')
),
order_summary as (
  select
    o.tenant_id,
    count(*) filter (where o.status::text='completed')::bigint as completed_count,
    count(*) filter (where o.status::text='cancelled')::bigint as cancelled_count,
    coalesce(sum(
      case
        when o.status::text='completed' then
          case
            when coalesce(o.subtotal,0) > 0 then o.subtotal
            else coalesce(o.total_amount,0) + coalesce(o.discount_amount,0) + coalesce(o.gp_amount,0)
          end
        else 0
      end
    ),0)::numeric as gross_total,
    coalesce(sum(
      case
        when o.status::text='completed' then
          case
            when coalesce(o.grand_total,0) > 0 then o.grand_total
            else coalesce(o.total_amount,0)
          end
        else 0
      end
    ),0)::numeric as net_total
  from window_orders o
  group by o.tenant_id
),
payment_summary as (
  select
    o.tenant_id,
    coalesce(sum(p.amount) filter (where p.method::text='cash'),0)::numeric as cash_total,
    coalesce(sum(p.amount) filter (where p.method::text='bank_transfer'),0)::numeric as bank_transfer_total
  from window_orders o
  join public.payments p
    on p.tenant_id=o.tenant_id
   and p.order_id=o.id
   and p.status='paid'
  where o.status::text='completed'
  group by o.tenant_id
),
product_totals as (
  select
    o.tenant_id,
    coalesce(oi.product_id::text, 'snapshot:' || coalesce(nullif(oi.name,''),'unknown')) as product_key,
    coalesce(nullif(oi.name,''), nullif(pr.name,''), 'ไม่ระบุสินค้า') as product_name,
    coalesce(sum(oi.quantity),0)::numeric as quantity,
    coalesce(sum(oi.line_total),0)::numeric as sales_amount
  from window_orders o
  join public.order_items oi
    on oi.tenant_id=o.tenant_id
   and oi.order_id=o.id
  left join public.products pr
    on pr.id=oi.product_id
   and pr.tenant_id=o.tenant_id
  where o.status::text='completed'
  group by
    o.tenant_id,
    coalesce(oi.product_id::text, 'snapshot:' || coalesce(nullif(oi.name,''),'unknown')),
    coalesce(nullif(oi.name,''), nullif(pr.name,''), 'ไม่ระบุสินค้า')
),
ranked_products as (
  select
    p.*,
    row_number() over (
      partition by p.tenant_id
      order by p.quantity desc, p.sales_amount desc, p.product_name asc
    ) as product_rank
  from product_totals p
),
top_products as (
  select
    tenant_id,
    jsonb_agg(
      jsonb_build_object(
        'rank', product_rank,
        'name', product_name,
        'quantity', quantity,
        'sales_amount', sales_amount
      )
      order by product_rank
    ) filter (where product_rank <= 3) as products
  from ranked_products
  group by tenant_id
)
select
  e.tenant_id,
  e.store_name,
  e.owner_user_id,
  e.owner_name,
  e.owner_email,
  b.business_date,
  s.completed_count,
  s.cancelled_count,
  round(s.gross_total,2),
  round(s.net_total,2),
  round(coalesce(p.cash_total,0),2),
  round(coalesce(p.bank_transfer_total,0),2),
  coalesce(tp.products,'[]'::jsonb)
from tenant_scope e
cross join bounds b
join order_summary s on s.tenant_id=e.tenant_id
left join payment_summary p on p.tenant_id=e.tenant_id
left join top_products tp on tp.tenant_id=e.tenant_id
where s.completed_count > 0;
$$;

revoke all on function public.daily_sales_summary_preview(uuid,date) from public, anon, authenticated;
grant execute on function public.daily_sales_summary_preview(uuid,date) to service_role;
