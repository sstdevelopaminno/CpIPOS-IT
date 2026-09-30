-- CpiPOS AI document archive: private file storage + small metadata index.
alter table public.pos_ai_package_quotas
  add column if not exists document_retention_days integer null
    check (document_retention_days is null or document_retention_days between 1 and 3650),
  add column if not exists document_storage_mb integer null
    check (document_storage_mb is null or document_storage_mb between 1 and 102400),
  add column if not exists document_file_limit integer null
    check (document_file_limit is null or document_file_limit between 1 and 100000);

alter table public.pos_ai_tenant_quota_overrides
  add column if not exists document_retention_days integer null
    check (document_retention_days is null or document_retention_days between 1 and 3650),
  add column if not exists document_storage_mb integer null
    check (document_storage_mb is null or document_storage_mb between 1 and 102400),
  add column if not exists document_file_limit integer null
    check (document_file_limit is null or document_file_limit between 1 and 100000);

update public.pos_ai_package_quotas q
set document_retention_days = case p.code when 'growth' then 365 when 'business' then 730 else q.document_retention_days end,
    document_storage_mb = case p.code when 'growth' then 100 when 'business' then 500 else q.document_storage_mb end,
    document_file_limit = case p.code when 'growth' then 100 when 'business' then 500 else q.document_file_limit end,
    updated_at = now()
from public.subscription_packages p
where p.id = q.package_id and p.code in ('growth','business');

create table if not exists public.pos_ai_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references public.users_profiles(id) on delete cascade,
  source_room_id uuid null references public.pos_ai_chat_rooms(id) on delete set null,
  title text not null check (char_length(title) between 1 and 180),
  document_type text not null default 'ai_summary'
    check (document_type in ('ai_summary','sales_report','stock_report','marketing_plan','accounting_summary','guide','other')),
  file_name text not null,
  mime_type text not null default 'text/html',
  storage_path text not null unique,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz null
);

create index if not exists idx_pos_ai_documents_scope_created
  on public.pos_ai_documents(tenant_id, branch_id, user_id, created_at desc);
create index if not exists idx_pos_ai_documents_retention
  on public.pos_ai_documents(expires_at)
  where expires_at is not null;

alter table public.pos_ai_documents enable row level security;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'cpipos-ai-documents',
  'cpipos-ai-documents',
  false,
  10485760,
  array['text/html','text/plain','text/csv','application/json']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

comment on table public.pos_ai_documents is
  'Small metadata index for AI-generated store documents. File bytes live in private Supabase Storage, not PostgreSQL.';
