create or replace function public.it_retention_maintenance_overview()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, app, cron
as $$
with operational as (
  select public.it_operational_cleanup_preview_7d() as value
),
package_rows as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', sp.code,
        'name', sp.name,
        'retention_months', sp.retention_months,
        'is_active', sp.is_active,
        'status', sp.status,
        'display_order', sp.display_order
      )
      order by sp.display_order nulls last, sp.code
    ),
    '[]'::jsonb
  ) as value
  from public.subscription_packages sp
),
cron_rows as (
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'jobname', j.jobname,
        'schedule', j.schedule,
        'active', j.active
      )
      order by j.jobname
    ),
    '[]'::jsonb
  ) as value
  from cron.job j
  where j.jobname in ('cpipos_sales_retention_daily','cpipos_operational_retention_7d')
),
sales_status as (
  select coalesce(
    jsonb_object_agg(status, batches),
    '{}'::jsonb
  ) as value
  from (
    select status, count(*)::bigint as batches
    from public.sales_retention_batches
    group by status
  ) s
),
recent_sales as (
  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.created_at desc),
    '[]'::jsonb
  ) as value
  from (
    select
      b.id,
      b.tenant_id,
      t.name as tenant_name,
      b.package_code,
      b.retention_months,
      b.status,
      b.recipient_email,
      b.order_count,
      b.item_count,
      b.payment_count,
      b.shift_count,
      b.stock_movement_count,
      b.export_attempt_count,
      b.email_attempt_count,
      b.exported_at,
      b.email_sent_at,
      b.purge_after,
      b.purged_at,
      b.last_error,
      b.created_at,
      b.updated_at
    from public.sales_retention_batches b
    left join public.tenants t on t.id=b.tenant_id
    order by b.created_at desc
    limit 25
  ) x
),
recent_cleanup as (
  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.created_at desc),
    '[]'::jsonb
  ) as value
  from (
    select
      r.id,
      r.scope,
      r.mode,
      r.cutoff_at,
      r.source,
      r.actor_role,
      r.deleted_counts,
      r.created_at
    from public.it_data_cleanup_runs r
    order by r.created_at desc
    limit 25
  ) x
)
select jsonb_build_object(
  'timezone','Asia/Bangkok',
  'database',jsonb_build_object(
    'size_bytes',pg_database_size(current_database()),
    'size_pretty',pg_size_pretty(pg_database_size(current_database()))
  ),
  'operational',(select value from operational),
  'cron_jobs',(select value from cron_rows),
  'packages',(select value from package_rows),
  'sales_status',(select value from sales_status),
  'recent_sales_batches',(select value from recent_sales),
  'recent_cleanup_runs',(select value from recent_cleanup)
);
$$;

revoke all on function public.it_retention_maintenance_overview() from public, anon, authenticated;
grant execute on function public.it_retention_maintenance_overview() to service_role;

create or replace function public.it_invoke_sales_retention_worker()
returns bigint
language sql
security definer
set search_path = pg_catalog, public, app
as $$
  select app.invoke_sales_retention_worker();
$$;

revoke all on function public.it_invoke_sales_retention_worker() from public, anon, authenticated;
grant execute on function public.it_invoke_sales_retention_worker() to service_role;
