create or replace function public.pos_ai_usage_summary(
  p_tenant_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns table (
  request_count bigint,
  input_tokens bigint,
  cached_input_tokens bigint,
  cache_write_tokens bigint,
  output_tokens bigint,
  reasoning_tokens bigint,
  total_tokens bigint,
  total_cost_usd numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from app.pos_ai_usage_summary(p_tenant_id,p_started_at,p_ended_at);
$$;
revoke all on function public.pos_ai_usage_summary(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.pos_ai_usage_summary(uuid,timestamptz,timestamptz) to service_role;
