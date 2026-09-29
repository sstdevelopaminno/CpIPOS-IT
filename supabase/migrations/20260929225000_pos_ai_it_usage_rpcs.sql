create or replace function public.pos_ai_admin_tenant_usage(
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns table (
  tenant_id uuid,
  request_count bigint,
  user_count bigint,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  total_cost_usd numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.tenant_id,
    count(*)::bigint,
    count(distinct e.user_id)::bigint,
    coalesce(sum(e.input_tokens),0)::bigint,
    coalesce(sum(e.output_tokens),0)::bigint,
    coalesce(sum(e.total_tokens),0)::bigint,
    coalesce(sum(e.total_cost_usd),0)::numeric
  from public.pos_ai_usage_events e
  where e.requested_at >= p_started_at
    and e.requested_at < p_ended_at
  group by e.tenant_id;
$$;

create or replace function public.pos_ai_admin_usage_series(
  p_tenant_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_grain text
)
returns table (
  bucket_start date,
  request_count bigint,
  user_count bigint,
  input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  total_cost_usd numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (case
      when p_grain = 'year' then date_trunc('year', e.requested_at at time zone 'Asia/Bangkok')
      when p_grain = 'month' then date_trunc('month', e.requested_at at time zone 'Asia/Bangkok')
      else date_trunc('day', e.requested_at at time zone 'Asia/Bangkok')
    end)::date as bucket_start,
    count(*)::bigint,
    count(distinct e.user_id)::bigint,
    coalesce(sum(e.input_tokens),0)::bigint,
    coalesce(sum(e.output_tokens),0)::bigint,
    coalesce(sum(e.total_tokens),0)::bigint,
    coalesce(sum(e.total_cost_usd),0)::numeric
  from public.pos_ai_usage_events e
  where e.tenant_id = p_tenant_id
    and e.requested_at >= p_started_at
    and e.requested_at < p_ended_at
  group by 1
  order by 1 desc;
$$;

revoke all on function public.pos_ai_admin_tenant_usage(timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.pos_ai_admin_usage_series(uuid,timestamptz,timestamptz,text) from public, anon, authenticated;
grant execute on function public.pos_ai_admin_tenant_usage(timestamptz,timestamptz) to service_role;
grant execute on function public.pos_ai_admin_usage_series(uuid,timestamptz,timestamptz,text) to service_role;
