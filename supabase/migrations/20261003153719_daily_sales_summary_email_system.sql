alter table public.it_communication_settings
  add column if not exists auto_send_daily_sales_summary boolean not null default true;

alter table public.customer_email_deliveries
  drop constraint if exists customer_email_deliveries_event_type_check;

alter table public.customer_email_deliveries
  add constraint customer_email_deliveries_event_type_check
  check (event_type = any (array[
    'store_activation'::text,
    'payment_confirmation'::text,
    'sales_retention_export'::text,
    'daily_sales_summary'::text
  ]));

create table if not exists public.tenant_daily_sales_email_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  updated_by uuid references public.users_profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists tenant_daily_sales_email_settings_enabled_idx
  on public.tenant_daily_sales_email_settings(enabled, updated_at desc);

alter table public.tenant_daily_sales_email_settings enable row level security;
revoke all on table public.tenant_daily_sales_email_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_daily_sales_email_settings to service_role;

comment on table public.tenant_daily_sales_email_settings is
  'Per-tenant IT switch for the automatic daily sales summary email. Recipient email is resolved live from tenants.primary_owner_user_id -> users_profiles.email at send time.';

create schema if not exists private;

create table if not exists private.daily_sales_summary_worker_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

revoke all on table private.daily_sales_summary_worker_tokens from public, anon, authenticated;
grant select, insert, update, delete on table private.daily_sales_summary_worker_tokens to service_role;

create or replace function public.daily_sales_summary_candidates(p_business_date date default null)
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
enabled_tenants as (
  select
    t.id as tenant_id,
    coalesce(nullif(t.display_name,''), t.name) as store_name,
    t.primary_owner_user_id as owner_user_id,
    coalesce(nullif(up.full_name,''), nullif(t.owner_name,''), nullif(t.display_name,''), t.name) as owner_name,
    coalesce(up.email,'') as owner_email
  from public.tenant_daily_sales_email_settings s
  join public.tenants t on t.id=s.tenant_id and t.is_active=true
  left join public.users_profiles up
    on up.id=t.primary_owner_user_id
   and up.is_active=true
   and up.archived_at is null
  where s.enabled=true
),
window_orders as (
  select o.*
  from public.orders o
  join enabled_tenants e on e.tenant_id=o.tenant_id
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
from enabled_tenants e
cross join bounds b
join order_summary s on s.tenant_id=e.tenant_id
left join payment_summary p on p.tenant_id=e.tenant_id
left join top_products tp on tp.tenant_id=e.tenant_id
where s.completed_count > 0
order by e.store_name;
$$;

revoke all on function public.daily_sales_summary_candidates(date) from public, anon, authenticated;
grant execute on function public.daily_sales_summary_candidates(date) to service_role;

create or replace function app.consume_daily_sales_summary_worker_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private, app, extensions
as $$
declare
  v_id uuid;
begin
  if coalesce(length(trim(p_token)),0) < 32 then
    return false;
  end if;

  select id into v_id
  from private.daily_sales_summary_worker_tokens
  where token_hash=encode(digest(p_token,'sha256'),'hex')
    and consumed_at is null
    and expires_at > now()
  order by created_at desc
  limit 1
  for update;

  if v_id is null then
    return false;
  end if;

  update private.daily_sales_summary_worker_tokens
  set consumed_at=now()
  where id=v_id;

  return true;
end;
$$;

create or replace function public.consume_daily_sales_summary_worker_token(p_token text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public, app
as $$
  select app.consume_daily_sales_summary_worker_token(p_token);
$$;

revoke all on function public.consume_daily_sales_summary_worker_token(text) from public, anon, authenticated;
grant execute on function public.consume_daily_sales_summary_worker_token(text) to service_role;

create or replace function app.invoke_daily_sales_summary_worker()
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, private, app, extensions, net
as $$
declare
  v_token text := encode(gen_random_bytes(32),'hex');
  v_request_id bigint;
begin
  delete from private.daily_sales_summary_worker_tokens
  where expires_at < now() - interval '1 day'
     or consumed_at is not null;

  insert into private.daily_sales_summary_worker_tokens(token_hash,expires_at)
  values (
    encode(digest(v_token,'sha256'),'hex'),
    now() + interval '5 minutes'
  );

  select net.http_post(
    url := 'https://cp-ipos-it-web.vercel.app/api/internal/daily-sales-summary/run',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('token',v_token),
    timeout_milliseconds := 8000
  ) into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.it_invoke_daily_sales_summary_worker()
returns bigint
language sql
security definer
set search_path = pg_catalog, public, app
as $$
  select app.invoke_daily_sales_summary_worker();
$$;

revoke all on function public.it_invoke_daily_sales_summary_worker() from public, anon, authenticated;
grant execute on function public.it_invoke_daily_sales_summary_worker() to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname='cpipos_daily_sales_summary_email';

select cron.schedule(
  'cpipos_daily_sales_summary_email',
  '15 17 * * *',
  $$select app.invoke_daily_sales_summary_worker();$$
);
