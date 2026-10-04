-- CpIPOS Support voice-call control plane.
-- Stores call state/assignment only. No audio, RTP, recordings, or media payloads are persisted.

create table if not exists public.support_call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  tenant_id uuid not null,
  direction text not null check (direction in ('store_to_it','it_to_store')),
  requested_by_type text not null check (requested_by_type in ('store','it')),
  requested_by_user_id uuid,
  requested_by_name text not null,
  request_origin text not null default 'web'
    check (request_origin in ('line_liff','it_web','support_mobile','cpipos_app','web')),
  status text not null default 'requested'
    check (status in ('requested','accepted','connecting','connected','declined','cancelled','ended','failed')),
  assigned_it_user_id uuid,
  assigned_it_name text,
  assigned_it_role text
    check (assigned_it_role is null or assigned_it_role in ('it_admin','it_support')),
  requested_at timestamptz not null default now(),
  accepted_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists support_call_sessions_one_active_per_conversation_idx
  on public.support_call_sessions (conversation_id)
  where status in ('requested','accepted','connecting','connected');

create unique index if not exists support_call_sessions_one_active_per_it_idx
  on public.support_call_sessions (assigned_it_user_id)
  where assigned_it_user_id is not null
    and status in ('accepted','connecting','connected');

create index if not exists support_call_sessions_queue_idx
  on public.support_call_sessions (status, requested_at asc)
  where status in ('requested','accepted','connecting','connected');

create index if not exists support_call_sessions_conversation_history_idx
  on public.support_call_sessions (conversation_id, created_at desc);

alter table public.support_call_sessions enable row level security;

revoke all on public.support_call_sessions from public, anon, authenticated;
grant all on public.support_call_sessions to service_role;

comment on table public.support_call_sessions is
  'Canonical Support voice-call control plane. Stores call state and assignment only; no audio/media is persisted.';
