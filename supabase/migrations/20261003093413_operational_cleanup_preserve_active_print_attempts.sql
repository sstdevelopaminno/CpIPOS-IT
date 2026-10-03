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
    if v_mode = 'all' then delete from public.audit_logs;
    else delete from public.audit_logs where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('audit_logs', v_count);
  end if;

  if v_scope in ('all','monitoring') then
    if v_mode = 'all' then delete from public.pos_device_health_snapshots;
    else delete from public.pos_device_health_snapshots where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('pos_device_health_snapshots', v_count);

    if v_mode = 'all' then delete from public.table_management_perf_events;
    else delete from public.table_management_perf_events where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('table_management_perf_events', v_count);

    if v_mode = 'all' then delete from public.login_attempts;
    else delete from public.login_attempts where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('login_attempts', v_count);

    if v_mode = 'all' then delete from public.printer_device_history;
    else delete from public.printer_device_history where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('printer_device_history', v_count);
  end if;

  if v_scope in ('all','print_history') then
    if v_mode = 'all' then
      delete from public.print_job_attempts a
      where not exists (
        select 1 from public.print_jobs j
        where j.id = a.print_job_id
          and j.status::text not in ('printed','failed')
      );
    else
      delete from public.print_job_attempts a
      where a.created_at < v_cutoff
        and not exists (
          select 1 from public.print_jobs j
          where j.id = a.print_job_id
            and j.status::text not in ('printed','failed')
        );
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
    if v_mode = 'all' then delete from public.pos_device_incidents;
    else delete from public.pos_device_incidents where resolved_at is not null and resolved_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('pos_device_incidents', v_count);

    if v_mode = 'all' then delete from public.it_manual_incidents;
    else delete from public.it_manual_incidents where resolved_at is not null and resolved_at < v_cutoff;
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
