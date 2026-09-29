create or replace function public.get_it_database_metrics()
returns jsonb
language sql
security definer
set search_path = pg_catalog
as $$
  with totals as (
    select
      pg_database_size(current_database())::bigint as database_bytes,
      coalesce(sum(s.n_live_tup), 0)::bigint as estimated_rows,
      count(*)::integer as user_tables
    from pg_stat_user_tables s
  ),
  connections as (
    select
      count(*)::integer as connections_total,
      count(*) filter (where a.state = 'active')::integer as connections_active
    from pg_stat_activity a
    where a.datname = current_database()
  ),
  top_tables as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'schema', ranked.schemaname,
          'table', ranked.relname,
          'estimated_rows', ranked.estimated_rows,
          'total_bytes', ranked.total_bytes
        )
        order by ranked.total_bytes desc
      ),
      '[]'::jsonb
    ) as items
    from (
      select
        s.schemaname,
        s.relname,
        s.n_live_tup::bigint as estimated_rows,
        pg_total_relation_size(s.relid)::bigint as total_bytes
      from pg_stat_user_tables s
      order by pg_total_relation_size(s.relid) desc
      limit 8
    ) ranked
  )
  select jsonb_build_object(
    'database_bytes', totals.database_bytes,
    'estimated_rows', totals.estimated_rows,
    'user_tables', totals.user_tables,
    'connections_total', connections.connections_total,
    'connections_active', connections.connections_active,
    'top_tables', top_tables.items,
    'checked_at', now()
  )
  from totals
  cross join connections
  cross join top_tables;
$$;

revoke all on function public.get_it_database_metrics() from public, anon, authenticated;
grant execute on function public.get_it_database_metrics() to service_role;
