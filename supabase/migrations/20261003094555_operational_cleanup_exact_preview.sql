create or replace function public.it_operational_cleanup_preview_7d()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
with cutoff as (
  select (
    date_trunc('day', now() at time zone 'Asia/Bangkok') - interval '7 days'
  ) at time zone 'Asia/Bangkok' as ts
),
counts as (
  select
    (select count(*) from public.audit_logs a, cutoff c where a.created_at < c.ts)::bigint as audit_logs,
    (select count(*) from public.pos_device_health_snapshots s, cutoff c where s.created_at < c.ts)::bigint as snapshots,
    (select count(*) from public.table_management_perf_events p, cutoff c where p.created_at < c.ts)::bigint as perf_events,
    (select count(*) from public.login_attempts l, cutoff c where l.created_at < c.ts)::bigint as login_attempts,
    (select count(*) from public.printer_device_history h, cutoff c where h.created_at < c.ts)::bigint as printer_history,
    (select count(*) from public.pos_device_incidents i, cutoff c
      where i.resolved_at is not null and i.resolved_at < c.ts)::bigint as system_incidents,
    (select count(*) from public.it_manual_incidents i, cutoff c
      where i.resolved_at is not null and i.resolved_at < c.ts)::bigint as manual_incidents,
    (select count(*) from public.print_job_attempts a, cutoff c
      where a.created_at < c.ts
        and not exists (
          select 1 from public.print_jobs j
          where j.id=a.print_job_id and j.status::text not in ('printed','failed')
        ))::bigint as print_attempts,
    (select count(*) from public.print_jobs j, cutoff c
      where j.created_at < c.ts and j.status::text in ('printed','failed'))::bigint as print_jobs
)
select jsonb_build_object(
  'retention_days',7,
  'timezone','Asia/Bangkok',
  'cutoff_at',(select ts from cutoff),
  'preview',jsonb_build_object(
    'audit',jsonb_build_object('audit_logs',audit_logs,'total',audit_logs),
    'monitoring',jsonb_build_object(
      'pos_device_health_snapshots',snapshots,
      'table_management_perf_events',perf_events,
      'login_attempts',login_attempts,
      'printer_device_history',printer_history,
      'total',snapshots+perf_events+login_attempts+printer_history
    ),
    'incidents',jsonb_build_object(
      'pos_device_incidents',system_incidents,
      'it_manual_incidents',manual_incidents,
      'total',system_incidents+manual_incidents
    ),
    'print_history',jsonb_build_object(
      'print_job_attempts',print_attempts,
      'print_jobs',print_jobs,
      'total',print_attempts+print_jobs
    )
  )
)
from counts;
$$;

revoke all on function public.it_operational_cleanup_preview_7d() from public,anon,authenticated;
grant execute on function public.it_operational_cleanup_preview_7d() to service_role;
