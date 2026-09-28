-- Support Chat Phase 2: realtime UX metadata, private image attachments and durable IT notes.
-- Canonical data remains in CpiPOS-Communications. Browser clients never receive service credentials.

alter table public.support_conversations
  add column if not exists internal_note text;

create table if not exists public.support_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  message_id uuid not null references public.support_messages(id) on delete cascade,
  storage_bucket text not null default 'support-chat-images',
  storage_path text not null unique,
  original_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 2097152),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists support_attachments_conversation_idx
  on public.support_attachments (conversation_id, created_at);
create index if not exists support_attachments_message_idx
  on public.support_attachments (message_id, created_at);
create index if not exists support_attachments_active_idx
  on public.support_attachments (conversation_id, deleted_at)
  where deleted_at is null;

alter table public.support_attachments enable row level security;

comment on column public.support_conversations.internal_note is
  'IT-only durable note. The support Edge Function must omit this field from store responses.';
comment on table public.support_attachments is
  'Private image metadata. Storage objects are removed immediately when a conversation is closed; rows remain as deletion audit metadata.';

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'support-chat-images',
  'support-chat-images',
  false,
  2097152,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

revoke all on public.support_attachments from anon, authenticated;
grant all on public.support_attachments to service_role;
