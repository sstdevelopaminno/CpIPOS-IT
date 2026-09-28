-- CpiPOS-Communications canonical Support Chat Phase 1 schema.
-- This migration belongs to the separate communications Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  store_code text not null,
  store_name text not null,
  store_logo_url text,
  subject text not null check (char_length(subject) between 2 and 180),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  status text not null default 'new'
    check (status in ('new','unassigned','in_progress','waiting_store','waiting_it','closed')),
  assigned_role text
    check (assigned_role is null or assigned_role in ('it_admin','it_support')),
  assigned_user_id uuid,
  assigned_user_name text,
  assigned_user_avatar_url text,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_type text
    check (last_sender_type is null or last_sender_type in ('store','it','system')),
  unread_it_count integer not null default 0 check (unread_it_count >= 0),
  unread_store_count integer not null default 0 check (unread_store_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  sender_type text not null check (sender_type in ('store','it','system')),
  sender_user_id uuid,
  sender_name text not null,
  sender_role text,
  sender_avatar_url text,
  message_body text not null check (char_length(message_body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create table if not exists public.support_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  participant_type text not null check (participant_type in ('store','it')),
  user_id uuid,
  display_name text not null,
  role text,
  avatar_url text,
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

create index if not exists support_conversations_tenant_created_idx
  on public.support_conversations (tenant_id, created_at desc);
create index if not exists support_conversations_status_latest_idx
  on public.support_conversations (status, last_message_at desc nulls last);
create index if not exists support_conversations_assigned_latest_idx
  on public.support_conversations (assigned_user_id, last_message_at desc nulls last);
create index if not exists support_messages_conversation_created_idx
  on public.support_messages (conversation_id, created_at asc);
create index if not exists support_participants_conversation_idx
  on public.support_participants (conversation_id, joined_at asc);

alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_participants enable row level security;

comment on table public.support_conversations is
  'Canonical support conversations. Server-side service access only in Phase 1.';
comment on table public.support_messages is
  'Canonical support chat messages. Browser direct access is intentionally denied by RLS.';
comment on table public.support_participants is
  'Support conversation participant history.';
