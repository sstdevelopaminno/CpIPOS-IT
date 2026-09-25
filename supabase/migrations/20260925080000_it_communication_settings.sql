-- Shared CpiPOS-001 contact addresses. No SMTP/Apps Script credentials are stored here.
create table if not exists public.it_communication_settings (
  id text primary key default 'default' check (id='default'),
  billing_email text not null default 'cuttingpointtech@gmail.com',
  support_email text not null default 'cuttingpointtech.support@gmail.com',
  billing_sender_name text not null default 'CUTTING POINTTECH',
  support_sender_name text not null default 'Cutting Point Tech Support',
  updated_by uuid references public.users_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint billing_email_format check (billing_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  constraint support_email_format check (support_email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
);
alter table public.it_communication_settings enable row level security;
revoke all on table public.it_communication_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.it_communication_settings to service_role;
insert into public.it_communication_settings(id) values ('default') on conflict (id) do nothing;
comment on table public.it_communication_settings is
  'IT-only configurable business and support contact identities; actual Gmail sender identity is configured separately in OAuth/Apps Script.';
