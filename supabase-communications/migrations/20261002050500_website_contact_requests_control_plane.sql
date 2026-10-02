create table if not exists public.website_contact_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  phone text not null check (char_length(phone) between 1 and 50),
  email text null check (email is null or char_length(email) <= 120),
  message text not null check (char_length(message) between 5 and 2000),
  locale text not null default 'th' check (locale in ('th','en','lo')),
  source text not null default 'company_website',
  status text not null default 'new' check (status in ('new','in_progress','contacted','closed')),
  internal_note text null check (internal_note is null or char_length(internal_note) <= 3000),
  assigned_user_id uuid null, assigned_user_name text null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  updated_by uuid null, last_contacted_at timestamptz null
);
create index if not exists website_contact_requests_created_idx on public.website_contact_requests(created_at desc);
create index if not exists website_contact_requests_status_created_idx on public.website_contact_requests(status,created_at desc);
alter table public.website_contact_requests enable row level security;
create table if not exists public.website_contact_request_events (
  id bigint generated always as identity primary key,
  contact_request_id uuid null, action text not null check (action in ('created','updated','deleted')),
  actor_user_id uuid null, actor_role text null, snapshot jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists website_contact_request_events_request_idx on public.website_contact_request_events(contact_request_id,created_at desc);
alter table public.website_contact_request_events enable row level security;
