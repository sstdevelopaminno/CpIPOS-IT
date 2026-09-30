-- CpiPOS AI document vault: private object storage + small metadata rows.
-- Chat messages remain in provider conversation state; generated documents are stored
-- in Supabase Storage so binary/text content does not bloat PostgreSQL.
begin;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'cpipos-ai-documents',
  'cpipos-ai-documents',
  false,
  5242880,
  array['text/markdown','text/plain','text/csv','application/json','application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.pos_ai_document_package_policies (
  package_id uuid primary key references public.subscription_packages(id) on delete cascade,
  is_enabled boolean not null default false,
  retention_days integer null check (retention_days is null or retention_days between 1 and 3650),
  storage_limit_mb integer null check (storage_limit_mb is null or storage_limit_mb between 1 and 1048576),
  max_files integer null check (max_files is null or max_files between 1 and 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users_profiles(id) on delete set null
);

create table if not exists public.pos_ai_document_tenant_overrides (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  policy_mode text not null default 'inherit' check (policy_mode in ('inherit','custom','unlimited')),
  is_enabled_override boolean null,
  retention_days integer null check (retention_days is null or retention_days between 1 and 3650),
  storage_limit_mb integer null check (storage_limit_mb is null or storage_limit_mb between 1 and 1048576),
  max_files integer null check (max_files is null or max_files between 1 and 100000),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.users_profiles(id) on delete set null
);

create table if not exists public.pos_ai_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references public.users_profiles(id) on delete cascade,
  room_id uuid null references public.pos_ai_chat_rooms(id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  category text not null default 'general' check (category in ('general','sales','stock','cost','marketing','accounting','guide')),
  object_path text not null unique,
  mime_type text not null default 'text/markdown',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  source_message_id text null,
  created_at timestamptz not null default now(),
  expires_at timestamptz null
);

create index if not exists idx_pos_ai_documents_tenant_created
  on public.pos_ai_documents(tenant_id, created_at desc);
create index if not exists idx_pos_ai_documents_scope_created
  on public.pos_ai_documents(tenant_id, branch_id, user_id, created_at desc);
create index if not exists idx_pos_ai_documents_expires
  on public.pos_ai_documents(expires_at)
  where expires_at is not null;

alter table public.pos_ai_document_package_policies enable row level security;
alter table public.pos_ai_document_tenant_overrides enable row level security;
alter table public.pos_ai_documents enable row level security;

comment on table public.pos_ai_documents is
  'Metadata only. Generated AI document bodies live in the private cpipos-ai-documents Storage bucket.';
comment on table public.pos_ai_document_package_policies is
  'IT-managed package policy for AI-generated document retention and object-storage quota.';
comment on table public.pos_ai_document_tenant_overrides is
  'Optional IT tenant override for AI-generated document retention and storage quota.';

create or replace function public.pos_ai_document_admin_usage()
returns table(
  tenant_id uuid,
  file_count bigint,
  total_bytes bigint,
  last_created_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select d.tenant_id,
         count(*)::bigint as file_count,
         coalesce(sum(d.size_bytes),0)::bigint as total_bytes,
         max(d.created_at) as last_created_at
  from public.pos_ai_documents d
  group by d.tenant_id;
$fn$;

revoke all on function public.pos_ai_document_admin_usage() from public, anon, authenticated;
grant execute on function public.pos_ai_document_admin_usage() to service_role;

insert into public.pos_ai_document_package_policies(package_id,is_enabled,retention_days,storage_limit_mb,max_files)
select
  p.id,
  case when p.code = 'starter' then false else true end,
  case
    when p.code = 'growth' then 180
    when p.code = 'business' then 365
    when p.code = 'custom' then null
    else null
  end,
  case
    when p.code = 'growth' then 256
    when p.code = 'business' then 1024
    when p.code = 'custom' then null
    else null
  end,
  case
    when p.code = 'growth' then 100
    when p.code = 'business' then 500
    when p.code = 'custom' then null
    else null
  end
from public.subscription_packages p
where p.code in ('starter','growth','business','custom')
on conflict (package_id) do update
set is_enabled = excluded.is_enabled,
    retention_days = excluded.retention_days,
    storage_limit_mb = excluded.storage_limit_mb,
    max_files = excluded.max_files,
    updated_at = now();

commit;
