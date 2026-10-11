-- Fix pg_safeupdate SQLSTATE 21000 (DELETE requires a WHERE clause) for
-- IT Support's explicitly confirmed full-history cleanup.
-- Every table below has a NOT NULL primary-key id, so the predicates preserve
-- the existing deletion scope without disabling SQL safety globally.
-- DDL ONLY: does not invoke cleanup, remove data, or modify Cleanup Ledger.
-- Existing 7-day cutoff, print-job safeguards and ledger insertion are intact.

CREATE OR REPLACE FUNCTION public.it_run_operational_cleanup_7d(p_scope text DEFAULT 'all'::text, p_mode text DEFAULT 'expired'::text, p_actor_user_id uuid DEFAULT NULL::uuid, p_actor_role text DEFAULT 'system'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
      delete from public.audit_logs where id is not null;
    else
      delete from public.audit_logs where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('audit_logs', v_count);
  end if;

  if v_scope in ('all','monitoring') then
    if v_mode = 'all' then
      delete from public.pos_device_health_snapshots where id is not null;
    else
      delete from public.pos_device_health_snapshots where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('pos_device_health_snapshots', v_count);

    if v_mode = 'all' then
      delete from public.table_management_perf_events where id is not null;
    else
      delete from public.table_management_perf_events where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('table_management_perf_events', v_count);

    if v_mode = 'all' then
      delete from public.login_attempts where id is not null;
    else
      delete from public.login_attempts where created_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('login_attempts', v_count);

    if v_mode = 'all' then
      delete from public.printer_device_history where id is not null;
    else
      delete from public.printer_device_history where created_at < v_cutoff;
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
    if v_mode = 'all' then
      delete from public.pos_device_incidents where id is not null;
    else
      delete from public.pos_device_incidents
      where resolved_at is not null and resolved_at < v_cutoff;
    end if;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('pos_device_incidents', v_count);

    if v_mode = 'all' then
      delete from public.it_manual_incidents where id is not null;
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
$function$
