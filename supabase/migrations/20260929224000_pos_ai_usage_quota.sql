-- CpiPOS AI usage ledger and quota controls.
-- Chat transcripts remain in OpenAI Conversations; this schema stores only
-- metering/accounting rows, quota policy, and the user prompt required by IT audit.
create table if not exists public.pos_ai_package_quotas (
  package_id uuid primary key references public.subscription_packages(id) on delete cascade,
  is_enabled boolean not null default true,
  monthly_request_limit integer null check (monthly_request_limit is null or monthly_request_limit > 0),
  monthly_token_limit bigint null check (monthly_token_limit is null or monthly_token_limit > 0),
  monthly_cost_limit_usd numeric(14,6) null check (monthly_cost_limit_usd is null or monthly_cost_limit_usd > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users_profiles(id) on delete set null
);

create table if not exists public.pos_ai_tenant_quota_overrides (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  quota_mode text not null default 'inherit'
    check (quota_mode in ('inherit','custom','unlimited')),
  is_enabled_override boolean null,
  monthly_request_limit integer null check (monthly_request_limit is null or monthly_request_limit > 0),
  monthly_token_limit bigint null check (monthly_token_limit is null or monthly_token_limit > 0),
  monthly_cost_limit_usd numeric(14,6) null check (monthly_cost_limit_usd is null or monthly_cost_limit_usd > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users_profiles(id) on delete set null
);

create table if not exists public.pos_ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references public.users_profiles(id) on delete cascade,
  openai_conversation_id text null,
  response_id text null,
  model text not null,
  prompt_text text null check (prompt_text is null or char_length(prompt_text) <= 1200),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_input_tokens bigint not null default 0 check (cached_input_tokens >= 0),
  cache_write_tokens bigint not null default 0 check (cache_write_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  reasoning_tokens bigint not null default 0 check (reasoning_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  input_cost_usd numeric(16,8) not null default 0 check (input_cost_usd >= 0),
  cached_input_cost_usd numeric(16,8) not null default 0 check (cached_input_cost_usd >= 0),
  cache_write_cost_usd numeric(16,8) not null default 0 check (cache_write_cost_usd >= 0),
  output_cost_usd numeric(16,8) not null default 0 check (output_cost_usd >= 0),
  total_cost_usd numeric(16,8) not null default 0 check (total_cost_usd >= 0),
  pricing_source text not null default 'openai_public_pricing',
  service_tier text null,
  status text not null default 'completed' check (status in ('completed','incomplete','failed')),
  requested_at timestamptz not null default now(),
  history_cleared_at timestamptz null
);

create index if not exists idx_pos_ai_usage_events_tenant_requested
  on public.pos_ai_usage_events(tenant_id, requested_at desc);
create index if not exists idx_pos_ai_usage_events_user_requested
  on public.pos_ai_usage_events(user_id, requested_at desc);
create index if not exists idx_pos_ai_usage_events_branch_requested
  on public.pos_ai_usage_events(branch_id, requested_at desc);
create index if not exists idx_pos_ai_usage_events_response
  on public.pos_ai_usage_events(response_id)
  where response_id is not null;

insert into public.pos_ai_package_quotas(package_id)
select id from public.subscription_packages
where is_active = true
on conflict (package_id) do nothing;

create trigger trg_pos_ai_package_quotas_touch
before update on public.pos_ai_package_quotas
for each row execute function app.touch_updated_at();

create trigger trg_pos_ai_tenant_quota_overrides_touch
before update on public.pos_ai_tenant_quota_overrides
for each row execute function app.touch_updated_at();

alter table public.pos_ai_package_quotas enable row level security;
alter table public.pos_ai_tenant_quota_overrides enable row level security;
alter table public.pos_ai_usage_events enable row level security;

comment on table public.pos_ai_usage_events is
  'Small CpiPOS AI metering ledger. Full assistant replies/history stay in OpenAI Conversations; prompt_text exists for IT usage/audit and can be redacted when history is cleared.';
comment on table public.pos_ai_package_quotas is
  'Default monthly CpiPOS AI quota per subscription package. NULL limits mean unlimited.';
comment on table public.pos_ai_tenant_quota_overrides is
  'Per-tenant CpiPOS AI quota override. inherit=package defaults, custom=tenant limits, unlimited=no monthly limits.';

create or replace function app.pos_ai_usage_summary(
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
  select
    count(*)::bigint,
    coalesce(sum(e.input_tokens),0)::bigint,
    coalesce(sum(e.cached_input_tokens),0)::bigint,
    coalesce(sum(e.cache_write_tokens),0)::bigint,
    coalesce(sum(e.output_tokens),0)::bigint,
    coalesce(sum(e.reasoning_tokens),0)::bigint,
    coalesce(sum(e.total_tokens),0)::bigint,
    coalesce(sum(e.total_cost_usd),0)::numeric
  from public.pos_ai_usage_events e
  where e.tenant_id = p_tenant_id
    and e.requested_at >= p_started_at
    and e.requested_at < p_ended_at;
$$;

revoke all on function app.pos_ai_usage_summary(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function app.pos_ai_usage_summary(uuid,timestamptz,timestamptz) to service_role;
