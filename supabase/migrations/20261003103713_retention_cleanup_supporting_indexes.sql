create index if not exists pos_device_health_snapshots_retention_created_idx
  on public.pos_device_health_snapshots(created_at);

create index if not exists table_management_perf_events_retention_created_idx
  on public.table_management_perf_events(created_at);

create index if not exists login_attempts_retention_created_idx
  on public.login_attempts(created_at);

create index if not exists printer_device_history_retention_created_idx
  on public.printer_device_history(created_at);

create index if not exists print_job_attempts_retention_created_idx
  on public.print_job_attempts(created_at);

create index if not exists print_jobs_retention_created_idx
  on public.print_jobs(created_at);

create index if not exists pos_device_incidents_retention_resolved_idx
  on public.pos_device_incidents(resolved_at)
  where resolved_at is not null;

create index if not exists it_manual_incidents_retention_resolved_idx
  on public.it_manual_incidents(resolved_at)
  where resolved_at is not null;
