-- CpiPOS acquisition reporting (additive, backwards-compatible).
-- Keep commercial source/status/tenant identifiers server-authoritative.
-- Existing records remain untagged ({} = unknown), never retroactively guessed.
alter table public.store_registration_requests
  add column if not exists marketing_attribution jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'store_registration_marketing_attribution_object'
      and conrelid = 'public.store_registration_requests'::regclass
  ) then
    alter table public.store_registration_requests
      add constraint store_registration_marketing_attribution_object
      check (jsonb_typeof(marketing_attribution) = 'object');
  end if;
end
$$;

comment on column public.store_registration_requests.marketing_attribution is
  'Validated non-personal UTM campaign tags from the public signup; {} means unknown. Never store raw referrers or IP addresses.';

-- No grants, RLS, customer data, financial records or existing source values changed.
