-- IT-managed package discounts per tenant; no changes to immutable settlements/receipts.
-- Applies to subscription billing CYCLES whose START date (Asia/Bangkok) is within the inclusive promotion window.
create extension if not exists btree_gist;

create table if not exists public.tenant_package_discounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  package_id uuid not null references public.subscription_packages(id),
  title text not null check (length(btrim(title)) between 2 and 160),
  percent numeric(5,2) not null check (percent > 0 and percent <= 100),
  valid_from date not null,
  valid_until date not null,
  duration_unit text not null check (duration_unit in ('day','month','year')),
  duration_value integer not null check (duration_value between 1 and 3650),
  status text not null default 'active' check (status in ('active','cancelled')),
  reason text not null check (length(btrim(reason)) between 4 and 600),
  created_by uuid references public.users_profiles(id) on delete set null,
  cancelled_by uuid references public.users_profiles(id) on delete set null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_package_discount_date_order check (valid_until >= valid_from),
  constraint tenant_package_discount_no_overlap exclude using gist
    (tenant_id with =, daterange(valid_from,valid_until + 1,'[)') with &&)
    where (status='active')
);
create index if not exists tenant_package_discounts_lookup
  on public.tenant_package_discounts(tenant_id,package_id,valid_from,valid_until) where status='active';

alter table public.tenant_package_discounts enable row level security;
revoke all on public.tenant_package_discounts from anon,authenticated;
grant select,insert,update,delete on public.tenant_package_discounts to service_role;

-- Shared authoritative quote for IT, POS and billing-cycle writes.
create or replace function app.tenant_discount_quote(
  p_tenant_id uuid, p_package_id uuid, p_start_date date, p_base_amount numeric
) returns jsonb language plpgsql stable security definer set search_path='pg_catalog','public','app' as $$
declare
  v_discount public.tenant_package_discounts%rowtype;
  v_base numeric(12,2);
  v_saved numeric(12,2);
begin
  v_base:=round(coalesce(p_base_amount,0),2);
  if v_base <= 0 or p_start_date is null then
    return jsonb_build_object('discount_id',null,'base_amount',v_base,'discount_amount',0,'amount_due',v_base,'percent',0);
  end if;
  select * into v_discount from public.tenant_package_discounts
  where tenant_id=p_tenant_id and package_id=p_package_id and status='active'
    and p_start_date between valid_from and valid_until
  order by valid_from desc,id desc limit 1;
  if not found then
    return jsonb_build_object('discount_id',null,'base_amount',v_base,'discount_amount',0,'amount_due',v_base,'percent',0);
  end if;
  v_saved:=round(v_base*v_discount.percent/100,2);
  return jsonb_build_object(
    'discount_id',v_discount.id,'title',v_discount.title,'percent',v_discount.percent,
    'valid_from',v_discount.valid_from,'valid_until',v_discount.valid_until,
    'base_amount',v_base,'discount_amount',v_saved,'amount_due',v_base-v_saved
  );
end $$;

revoke all on function app.tenant_discount_quote(uuid,uuid,date,numeric) from public,anon,authenticated;
grant execute on function app.tenant_discount_quote(uuid,uuid,date,numeric) to service_role;

create or replace function public.tenant_discount_quote(
  p_tenant_id uuid, p_package_id uuid, p_start_date date, p_base_amount numeric
) returns jsonb language sql stable security definer set search_path='pg_catalog','public','app' as $$
  select app.tenant_discount_quote(p_tenant_id,p_package_id,p_start_date,p_base_amount);
$$;
revoke all on function public.tenant_discount_quote(uuid,uuid,date,numeric) from public,anon,authenticated;
grant execute on function public.tenant_discount_quote(uuid,uuid,date,numeric) to service_role;

-- The canonical subscription worker re-writes amount_due from the contract each run.
-- This trigger re-applies only the currently approved, in-range tenant discount.
create or replace function app.tenant_discount_before_billing_cycle()
returns trigger language plpgsql security definer set search_path='pg_catalog','public','app' as $$
declare
  v_base numeric(12,2);
  v_quote jsonb;
begin
  if new.status in ('paid','cancelled') or coalesce(new.amount_paid,0)>0 then return new; end if;
  if tg_op='UPDATE' then
    if old.status in ('paid','cancelled') or coalesce(old.amount_paid,0)>0
       or exists(select 1 from public.tenant_subscription_settlements where billing_cycle_id=old.id)
    then return new; end if;
  end if;
  if coalesce(new.metadata->>'source','') not in ('automatic_contract_cycle','tenant_contract_admin_correction') then
    return new;
  end if;
  select amount_per_cycle into v_base from public.tenant_subscription_contracts
  where tenant_id=new.tenant_id and package_id=new.package_id
    and status not in ('cancelled','suspended')
  order by created_at desc,id desc limit 1;
  if coalesce(v_base,0)<=0 then return new; end if;
  v_quote:=app.tenant_discount_quote(new.tenant_id,new.package_id,new.period_start,v_base);
  if (v_quote->>'discount_id') is not null then
    new.amount_due:=(v_quote->>'amount_due')::numeric;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('tenant_discount',v_quote);
  elsif coalesce(new.metadata,'{}'::jsonb) ? 'tenant_discount' then
    -- The worker regenerated this still-unpaid cycle outside the promotion window.
    new.amount_due:=v_base;
    new.metadata:=new.metadata - 'tenant_discount';
  end if;
  return new;
end $$;

drop trigger if exists tenant_discount_billing_cycle_guard on public.tenant_billing_cycles;
create trigger tenant_discount_billing_cycle_guard
before insert or update of amount_due,period_start,period_end,package_id,tenant_id
on public.tenant_billing_cycles for each row
execute function app.tenant_discount_before_billing_cycle();

revoke all on function app.tenant_discount_before_billing_cycle() from public,anon,authenticated;

-- Carry forward the previously approved Christmas/New Year privilege for this
-- one store from explicit contract metadata. No current or settled bill is altered.
insert into public.tenant_package_discounts
  (tenant_id,package_id,title,percent,valid_from,valid_until,duration_unit,duration_value,reason)
select c.tenant_id,c.package_id,'CpiPOS NEW YEAR PRIVILEGE 2027',10,
       date '2026-12-13',date '2027-04-12','month',4,
       'ส่วนลดปีใหม่ 10% ที่ได้รับการอนุมัติและแจ้งลูกค้าแล้ว'
from public.tenant_subscription_contracts c
where c.id='f688670e-2822-403f-8137-73dcc16d9c55'
  and c.tenant_id='1f7380a1-197e-4483-975b-0690a7fd82fc'
  and c.metadata->'new_year_2027_discount'->>'approved'='true'
  and not exists (
    select 1 from public.tenant_package_discounts d
    where d.tenant_id=c.tenant_id and d.status='active'
      and daterange(d.valid_from,d.valid_until+1,'[)') && daterange('2026-12-13'::date,'2027-04-13'::date,'[)')
  );


-- Settlement writes the amount actually collected into amount_per_cycle.
-- A temporary discount must NOT become the permanent subscription base price.
create or replace function app.preserve_contract_base_price_for_promotion()
returns trigger language plpgsql security definer set search_path='pg_catalog','public','app' as $$
declare
  v_settlement public.tenant_subscription_settlements%rowtype;
  v_base numeric(12,2);
  v_quote jsonb;
  v_settlement_id uuid;
begin
  if tg_op='UPDATE' then
    if old.package_id<>new.package_id or old.billing_interval<>new.billing_interval
       or coalesce(old.amount_per_cycle,0)<=0
       or new.amount_per_cycle=old.amount_per_cycle then return new; end if;
    v_base:=old.amount_per_cycle;
    if coalesce(new.metadata->>'last_settlement_id','') !~ '^[0-9a-f-]{36}$' then return new; end if;
    v_settlement_id:=(new.metadata->>'last_settlement_id')::uuid;
  else
    if coalesce(new.metadata->>'settlement_id','') !~ '^[0-9a-f-]{36}$' then return new; end if;
    v_settlement_id:=(new.metadata->>'settlement_id')::uuid;
    select c.amount_per_cycle into v_base
    from public.tenant_subscription_contracts c
    where c.tenant_id=new.tenant_id and c.package_id=new.package_id
      and c.billing_interval=new.billing_interval and c.amount_per_cycle>0
    order by c.created_at desc,c.id desc limit 1;
    if coalesce(v_base,0)<=0 then return new; end if;
  end if;

  select * into v_settlement from public.tenant_subscription_settlements
    where id=v_settlement_id and tenant_id=new.tenant_id and package_id=new.package_id;
  if not found then return new; end if;
  v_quote:=app.tenant_discount_quote(new.tenant_id,new.package_id,v_settlement.period_start,v_base);
  if (v_quote->>'discount_id') is not null
     and new.amount_per_cycle=(v_quote->>'amount_due')::numeric
     and v_settlement.amount_received=new.amount_per_cycle then
    new.amount_per_cycle:=v_base;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'last_tenant_discount_settlement',jsonb_build_object(
        'discount_id',v_quote->>'discount_id','settlement_id',v_settlement.id,
        'base_amount',v_base,'discounted_payment',v_settlement.amount_received
      )
    );
  end if;
  return new;
end $$;

drop trigger if exists preserve_promo_contract_base_price on public.tenant_subscription_contracts;
create trigger preserve_promo_contract_base_price
before insert or update of amount_per_cycle on public.tenant_subscription_contracts
for each row execute function app.preserve_contract_base_price_for_promotion();
revoke all on function app.preserve_contract_base_price_for_promotion() from public,anon,authenticated;
