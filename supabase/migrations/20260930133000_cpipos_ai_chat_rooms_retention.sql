-- CpiPOS AI multi-room chat index + package-controlled chat retention.
-- Full chat content remains in OpenAI Conversations. CpiPOS stores only tiny room
-- metadata/pointers required to list rooms, enforce ownership, and apply retention.

create table if not exists public.pos_ai_chat_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references public.users_profiles(id) on delete cascade,
  openai_conversation_id text not null unique,
  title text not null default 'แชทใหม่'
    check (char_length(title) between 1 and 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists idx_pos_ai_chat_rooms_scope_updated
  on public.pos_ai_chat_rooms(tenant_id, branch_id, user_id, updated_at desc);
create index if not exists idx_pos_ai_chat_rooms_retention
  on public.pos_ai_chat_rooms(last_message_at asc);

drop trigger if exists trg_pos_ai_chat_rooms_touch on public.pos_ai_chat_rooms;
create trigger trg_pos_ai_chat_rooms_touch
before update on public.pos_ai_chat_rooms
for each row execute function app.touch_updated_at();

alter table public.pos_ai_chat_rooms enable row level security;

comment on table public.pos_ai_chat_rooms is
  'Small room index only. Message/tool content is stored in OpenAI Conversations. One row maps an Owner/Manager room to one OpenAI conversation.';

-- Migrate the existing one-conversation-per-user pointer into the first room.
insert into public.pos_ai_chat_rooms(
  tenant_id, branch_id, user_id, openai_conversation_id, title,
  created_at, updated_at, last_message_at
)
select
  l.tenant_id,
  l.branch_id,
  l.user_id,
  l.openai_conversation_id,
  'บทสนทนาเดิม',
  l.created_at,
  l.updated_at,
  l.updated_at
from public.pos_ai_conversation_links l
where not exists (
  select 1
  from public.pos_ai_chat_rooms r
  where r.openai_conversation_id = l.openai_conversation_id
)
on conflict (openai_conversation_id) do nothing;

alter table public.pos_ai_package_quotas
  add column if not exists history_retention_days integer null
    check (history_retention_days is null or history_retention_days between 1 and 3650);

alter table public.pos_ai_tenant_quota_overrides
  add column if not exists history_retention_days integer null
    check (history_retention_days is null or history_retention_days between 1 and 3650);

-- Defaults follow the commercial data-retention posture:
-- Growth AI add-on: 365 days, Business: 730 days, CUSTOM: IT/contract managed.
update public.pos_ai_package_quotas q
set history_retention_days = case p.code
  when 'growth' then 365
  when 'business' then 730
  when 'starter' then 30
  else q.history_retention_days
end,
updated_at = now()
from public.subscription_packages p
where p.id = q.package_id
  and p.code in ('starter','growth','business');

comment on column public.pos_ai_package_quotas.history_retention_days is
  'How long OpenAI-backed chat rooms are retained for the package. NULL means IT/contract managed.';
comment on column public.pos_ai_tenant_quota_overrides.history_retention_days is
  'Optional tenant-specific CpiPOS AI chat retention override in days.';

-- Support fast IT/retention cleanup by conversation id while usage accounting remains.
create index if not exists idx_pos_ai_usage_events_conversation
  on public.pos_ai_usage_events(openai_conversation_id, requested_at desc)
  where openai_conversation_id is not null;
