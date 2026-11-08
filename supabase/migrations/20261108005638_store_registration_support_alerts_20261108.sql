-- Additive, service-only delivery outbox for new public store applications.
-- Existing customer requests are intentionally not backfilled or re-emailed.
create table if not exists public.store_registration_alert_deliveries (
  registration_id uuid primary key references public.store_registration_requests(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists store_registration_alert_retry_idx
  on public.store_registration_alert_deliveries (status, last_attempt_at, created_at)
  where status in ('pending', 'failed', 'sending');
alter table public.store_registration_alert_deliveries enable row level security;
revoke all on public.store_registration_alert_deliveries from public, anon, authenticated;
grant select, insert, update on public.store_registration_alert_deliveries to service_role;

create or replace function public.queue_store_registration_alert_delivery()
returns trigger language plpgsql
set search_path = ''
as $function$
begin
  insert into public.store_registration_alert_deliveries(registration_id)
  values(new.id)
  on conflict (registration_id) do nothing;
  return new;
end;
$function$;
revoke all on function public.queue_store_registration_alert_delivery() from public, anon, authenticated;
drop trigger if exists queue_store_registration_alert_delivery on public.store_registration_requests;
create trigger queue_store_registration_alert_delivery
after insert on public.store_registration_requests
for each row execute function public.queue_store_registration_alert_delivery();

comment on table public.store_registration_alert_deliveries is
'Internal at-least-once support email delivery state for new store applications; service role only.';
