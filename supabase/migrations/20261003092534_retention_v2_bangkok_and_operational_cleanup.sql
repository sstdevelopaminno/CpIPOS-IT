-- Sales retention v2: Bangkok midnight schedule, shift/stock archive manifests,
-- plus a separate 7-day operational retention policy.

alter table public.sales_retention_batches
  add column if not exists shift_count integer not null default 0 check (shift_count >= 0),
  add column if not exists stock_movement_count integer not null default 0 check (stock_movement_count >= 0),
  add column if not exists shifts_object_path text,
  add column if not exists stock_movements_object_path text,
  add column if not exists purged_shift_count integer not null default 0 check (purged_shift_count >= 0),
  add column if not exists purged_stock_movement_count integer not null default 0 check (purged_stock_movement_count >= 0);

create table if not exists public.sales_retention_batch_shifts (
  shift_id uuid primary key references public.shifts(id) on delete cascade,
  batch_id uuid not null references public.sales_retention_batches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  shift_closed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.sales_retention_batch_shifts enable row level security;
revoke all on table public.sales_retention_batch_shifts from anon, authenticated;

create index if not exists sales_retention_batch_shifts_batch_idx
  on public.sales_retention_batch_shifts(batch_id);

create table if not exists public.sales_retention_batch_stock_movements (
  stock_movement_id uuid primary key references public.stock_movements(id) on delete cascade,
  batch_id uuid not null references public.sales_retention_batches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  movement_created_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.sales_retention_batch_stock_movements enable row level security;
revoke all on table public.sales_retention_batch_stock_movements from anon, authenticated;

create index if not exists sales_retention_batch_stock_movements_batch_idx
  on public.sales_retention_batch_stock_movements(batch_id);

create table if not exists public.it_data_cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  mode text not null,
  cutoff_at timestamptz,
  source text not null default 'manual',
  actor_user_id uuid,
  actor_role text,
  deleted_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint it_data_cleanup_runs_scope_check
    check (scope in ('all','audit','monitoring','incidents','print_history')),
  constraint it_data_cleanup_runs_mode_check
    check (mode in ('expired','all'))
);
alter table public.it_data_cleanup_runs enable row level security;
revoke all on table public.it_data_cleanup_runs from anon, authenticated;

create index if not exists it_data_cleanup_runs_created_idx
  on public.it_data_cleanup_runs(created_at desc);

create or replace function public.it_run_operational_cleanup_7d(
  p_scope text default 'all',
  p_mode text default 'expired',
  p_actor_user_id uuid default null,
  p_actor_role text default 'system'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_scope text := lower(coalesce(p_scope,'all'));
  v_mode text := lower(coalesce(p_mode,'expired'));
  v_cutoff timestamptz :=
    (date_trunc('day', now() at time zone 'Asia/Bangkok') - interval '7 days')
      at time zone 'Asia/Bangkok';
  v_counts jsonb := '{}'::jsonb;
  v_count integer := 0;
begin
  if v_scope not in ('all','audit','monitoring','incidents','print_history') then
    raise exception 'invalid_cleanup_scope';
  end if;
  if v_mode not in ('expired','all') then
    raise exception 'invalid_cleanup_mode';
  end if;

  if v_scope in ('all','audit') then
    if v_mode = 'all' then
      delete from public.audit_logs;
    else
      delete from public.audit_logs where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('audit_logs', v_count);
  end if;

  if v_scope in ('all','monitoring') then
    if v_mode = 'all' then
      delete from public.pos_device_health_snapshots;
    else
      delete from public.pos_device_health_snapshots where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('pos_device_health_snapshots', v_count);

    if v_mode = 'all' then
      delete from public.table_management_perf_events;
    else
      delete from public.table_management_perf_events where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('table_management_perf_events', v_count);

    if v_mode = 'all' then
      delete from public.login_attempts;
    else
      delete from public.login_attempts where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('login_attempts', v_count);

    if v_mode = 'all' then
      delete from public.printer_device_history;
    else
      delete from public.printer_device_history where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('printer_device_history', v_count);
  end if;

  if v_scope in ('all','print_history') then
    if v_mode = 'all' then
      delete from public.print_job_attempts;
    else
      delete from public.print_job_attempts where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('print_job_attempts', v_count);

    if v_mode = 'all' then
      delete from public.print_jobs where status::text in ('printed','failed');
    else
      delete from public.print_jobs
      where status::text in ('printed','failed') and created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('print_jobs', v_count);
  end if;

  if v_scope in ('all','incidents') then
    if v_mode = 'all' then
      delete from public.pos_device_incidents;
    else
      delete from public.pos_device_incidents
      where resolved_at is not null and resolved_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('pos_device_incidents', v_count);

    if v_mode = 'all' then
      delete from public.it_manual_incidents;
    else
      delete from public.it_manual_incidents
      where resolved_at is not null and resolved_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('it_manual_incidents', v_count);
  end if;

  insert into public.it_data_cleanup_runs(
    scope, mode, cutoff_at, source, actor_user_id, actor_role, deleted_counts
  ) values (
    v_scope,
    v_mode,
    case when v_mode='expired' then v_cutoff else null end,
    case when p_actor_user_id is null then 'automatic' else 'manual' end,
    p_actor_user_id,
    left(coalesce(p_actor_role,'system'),80),
    v_counts
  );

  return jsonb_build_object(
    'ok', true,
    'scope', v_scope,
    'mode', v_mode,
    'cutoff_at', case when v_mode='expired' then v_cutoff else null end,
    'deleted', v_counts
  );
end;
$$;

revoke all on function public.it_run_operational_cleanup_7d(text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.it_run_operational_cleanup_7d(text,text,uuid,text) to service_role;

create or replace function app.claim_due_sales_retention_batch(p_max_orders integer default 2000)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_tenant_id uuid;
  v_package_code text;
  v_retention_months integer;
  v_cutoff timestamptz;
  v_batch_id uuid;
  v_count integer;
  v_shift_count integer;
  v_stock_count integer;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_max_orders is null or p_max_orders < 1 or p_max_orders > 5000 then
    raise exception 'invalid_retention_batch_size';
  end if;

  if not pg_try_advisory_xact_lock(hashtext('cpipos_sales_retention_claim')) then
    return null;
  end if;

  select
    o.tenant_id,
    sp.code,
    app.sales_retention_months_for_tenant(o.tenant_id)
  into v_tenant_id, v_package_code, v_retention_months
  from public.orders o
  join public.tenants t on t.id = o.tenant_id and t.is_active = true
  left join public.tenant_data_lifecycle tdl on tdl.tenant_id = o.tenant_id
  left join public.subscription_packages sp on sp.id = t.package_id
  where o.status in ('completed','cancelled')
    and coalesce(tdl.lifecycle_status,'active') <> 'sales_demo'
    and o.created_at <
      (
        date_trunc('day', now() at time zone 'Asia/Bangkok')
        - make_interval(months => app.sales_retention_months_for_tenant(o.tenant_id))
      ) at time zone 'Asia/Bangkok'
    and not exists (
      select 1 from public.sales_retention_batch_orders bro where bro.order_id = o.id
    )
    and not exists (
      select 1 from public.pos_tax_invoices ti where ti.order_id = o.id
    )
  order by o.created_at asc
  limit 1;

  if v_tenant_id is null then
    return null;
  end if;

  v_cutoff :=
    (
      date_trunc('day', now() at time zone 'Asia/Bangkok')
      - make_interval(months => v_retention_months)
    ) at time zone 'Asia/Bangkok';

  insert into public.sales_retention_batches (
    tenant_id, package_code, retention_months, cutoff_at, status, metadata
  ) values (
    v_tenant_id, v_package_code, v_retention_months, v_cutoff, 'claimed',
    jsonb_build_object(
      'policy_source','package_or_tenant_override',
      'timezone','Asia/Bangkok',
      'run_boundary','00:00',
      'tax_invoice_orders_excluded',true,
      'email_required_before_purge',true,
      'archive_includes',jsonb_build_array('orders','order_items','payments','shifts','stock_movements')
    )
  )
  returning id into v_batch_id;

  insert into public.sales_retention_batch_orders(order_id,batch_id,tenant_id,order_created_at)
  select o.id,v_batch_id,o.tenant_id,o.created_at
  from public.orders o
  where o.tenant_id=v_tenant_id
    and o.status in ('completed','cancelled')
    and o.created_at < v_cutoff
    and not exists (
      select 1 from public.sales_retention_batch_orders bro where bro.order_id=o.id
    )
    and not exists (
      select 1 from public.pos_tax_invoices ti where ti.order_id=o.id
    )
  order by o.created_at asc
  limit p_max_orders
  on conflict (order_id) do nothing;

  select count(*), min(order_created_at), max(order_created_at)
  into v_count,v_start,v_end
  from public.sales_retention_batch_orders
  where batch_id=v_batch_id;

  if coalesce(v_count,0)=0 then
    delete from public.sales_retention_batches where id=v_batch_id;
    return null;
  end if;

  insert into public.sales_retention_batch_shifts(
    shift_id,batch_id,tenant_id,shift_closed_at
  )
  select s.id,v_batch_id,s.tenant_id,s.closed_at
  from public.shifts s
  where s.tenant_id=v_tenant_id
    and s.status::text='closed'
    and coalesce(s.closed_at,s.created_at) < v_cutoff
    and not exists (
      select 1 from public.sales_retention_batch_shifts x where x.shift_id=s.id
    )
    and not exists (
      select 1
      from public.orders o
      where o.shift_id=s.id
        and not exists (
          select 1 from public.sales_retention_batch_orders bro
          where bro.batch_id=v_batch_id and bro.order_id=o.id
        )
    )
    and not exists (
      select 1
      from public.payments p
      where p.shift_id=s.id
        and (
          p.order_id is null
          or not exists (
            select 1 from public.sales_retention_batch_orders bro
            where bro.batch_id=v_batch_id and bro.order_id=p.order_id
          )
        )
    )
  on conflict (shift_id) do nothing;

  insert into public.sales_retention_batch_stock_movements(
    stock_movement_id,batch_id,tenant_id,movement_created_at
  )
  select sm.id,v_batch_id,sm.tenant_id,sm.created_at
  from public.stock_movements sm
  where sm.tenant_id=v_tenant_id
    and sm.created_at < v_cutoff
    and not exists (
      select 1 from public.sales_retention_batch_stock_movements x
      where x.stock_movement_id=sm.id
    )
  order by sm.created_at asc
  limit 5000
  on conflict (stock_movement_id) do nothing;

  select count(*) into v_shift_count
  from public.sales_retention_batch_shifts where batch_id=v_batch_id;

  select count(*) into v_stock_count
  from public.sales_retention_batch_stock_movements where batch_id=v_batch_id;

  update public.sales_retention_batches
  set order_count=v_count,
      shift_count=coalesce(v_shift_count,0),
      stock_movement_count=coalesce(v_stock_count,0),
      range_start_at=v_start,
      range_end_at=v_end,
      updated_at=now()
  where id=v_batch_id;

  return v_batch_id;
end;
$$;

create or replace function public.complete_sales_retention_export_v2(
  p_batch_id uuid,
  p_orders_object_path text,
  p_items_object_path text,
  p_payments_object_path text,
  p_shifts_object_path text,
  p_stock_movements_object_path text,
  p_manifest_object_path text,
  p_checksums jsonb,
  p_order_count integer,
  p_item_count integer,
  p_payment_count integer,
  p_shift_count integer,
  p_stock_movement_count integer,
  p_gross_total numeric,
  p_paid_total numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.sales_retention_batches
  set status='exported',
      orders_object_path=p_orders_object_path,
      items_object_path=p_items_object_path,
      payments_object_path=p_payments_object_path,
      shifts_object_path=p_shifts_object_path,
      stock_movements_object_path=p_stock_movements_object_path,
      manifest_object_path=p_manifest_object_path,
      checksums=coalesce(p_checksums,'{}'::jsonb),
      order_count=greatest(0,coalesce(p_order_count,0)),
      item_count=greatest(0,coalesce(p_item_count,0)),
      payment_count=greatest(0,coalesce(p_payment_count,0)),
      shift_count=greatest(0,coalesce(p_shift_count,0)),
      stock_movement_count=greatest(0,coalesce(p_stock_movement_count,0)),
      gross_total=coalesce(p_gross_total,0),
      paid_total=coalesce(p_paid_total,0),
      exported_at=now(),
      last_error=null,
      updated_at=now()
  where id=p_batch_id
    and status in ('claimed','exporting','failed');

  if not found then
    raise exception 'retention_batch_not_exportable';
  end if;
end;
$$;

revoke all on function public.complete_sales_retention_export_v2(
  uuid,text,text,text,text,text,text,jsonb,integer,integer,integer,integer,integer,numeric,numeric
) from public, anon, authenticated;
grant execute on function public.complete_sales_retention_export_v2(
  uuid,text,text,text,text,text,text,jsonb,integer,integer,integer,integer,integer,numeric,numeric
) to service_role;

create or replace function app.purge_sales_retention_batch(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_order_count integer;
  v_shift_count integer;
  v_stock_count integer;
begin
  perform 1
  from public.sales_retention_batches
  where id=p_batch_id
    and status='purge_ready'
    and exported_at is not null
    and email_sent_at is not null
    and purge_after is not null
    and purge_after <= now()
    and orders_object_path is not null
    and items_object_path is not null
    and payments_object_path is not null
    and shifts_object_path is not null
    and stock_movements_object_path is not null
    and manifest_object_path is not null
  for update;

  if not found then
    raise exception 'retention_batch_not_purgeable';
  end if;

  if exists (
    select 1
    from public.sales_retention_batch_orders bro
    join public.pos_tax_invoices ti on ti.order_id=bro.order_id
    where bro.batch_id=p_batch_id
  ) then
    raise exception 'retention_batch_contains_tax_invoice_order';
  end if;

  select count(*) into v_order_count
  from public.sales_retention_batch_orders where batch_id=p_batch_id;

  select count(*) into v_stock_count
  from public.sales_retention_batch_stock_movements where batch_id=p_batch_id;

  delete from public.stock_movements sm
  using public.sales_retention_batch_stock_movements bsm
  where bsm.batch_id=p_batch_id
    and sm.id=bsm.stock_movement_id;

  delete from public.orders o
  using public.sales_retention_batch_orders bro
  where bro.batch_id=p_batch_id
    and o.id=bro.order_id
    and o.status in ('completed','cancelled');

  with deleted as (
    delete from public.shifts s
    using public.sales_retention_batch_shifts bs
    where bs.batch_id=p_batch_id
      and s.id=bs.shift_id
      and s.status::text='closed'
      and not exists (select 1 from public.orders o where o.shift_id=s.id)
      and not exists (select 1 from public.payments p where p.shift_id=s.id)
    returning s.id
  )
  select count(*) into v_shift_count from deleted;

  update public.sales_retention_batches
  set status='purged',
      purged_at=now(),
      purged_order_count=coalesce(v_order_count,0),
      purged_shift_count=coalesce(v_shift_count,0),
      purged_stock_movement_count=coalesce(v_stock_count,0),
      last_error=null,
      updated_at=now()
  where id=p_batch_id;

  return coalesce(v_order_count,0);
end;
$$;

create or replace function public.purge_sales_retention_batch(p_batch_id uuid)
returns integer
language sql
security definer
set search_path = pg_catalog, public, app
as $$
  select app.purge_sales_retention_batch(p_batch_id);
$$;
revoke all on function public.purge_sales_retention_batch(uuid) from public, anon, authenticated;
grant execute on function public.purge_sales_retention_batch(uuid) to service_role;

select cron.alter_job(
  (select jobid from cron.job where jobname='cpipos_sales_retention_daily' limit 1),
  schedule => '0 17 * * *'
)
where exists (select 1 from cron.job where jobname='cpipos_sales_retention_daily');

select cron.unschedule(jobid)
from cron.job
where jobname='cpipos_operational_retention_7d';

select cron.schedule(
  'cpipos_operational_retention_7d',
  '10 17 * * *',
  $$select public.it_run_operational_cleanup_7d('all','expired',null,'system_cron');$$
);
