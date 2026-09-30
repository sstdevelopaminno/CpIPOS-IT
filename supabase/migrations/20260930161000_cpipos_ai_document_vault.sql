-- CpiPOS AI document vault.
-- Binary/document payloads live in Supabase Storage. Postgres stores only small metadata
-- and package/tenant policy so database growth stays bounded.

alter table public.pos_ai_package_quotas
  add column if not exists document_storage_mb integer null
    check (document_storage_mb is null or document_storage_mb between 1 and 102400),
  add column if not exists document_retention_days integer null
    check (document_retention_days is null or document_retention_days between 1 and 3650),
  add column if not exists document_max_file_mb integer null
    check (document_max_file_mb is null or document_max_file_mb between 1 and 25);

alter table public.pos_ai_tenant_quota_overrides
  add column if not exists document_storage_mb integer null
    check (document_storage_mb is null or document_storage_mb between 1 and 102400),
  add column if not exists document_retention_days integer null
    check (document_retention_days is null or document_retention_days between 1 and 3650),
  add column if not exists document_max_file_mb integer null
    check (document_max_file_mb is null or document_max_file_mb between 1 and 25);

insert into public.package_feature_catalog(
  code,name,description,default_monthly_price,default_yearly_price,default_perpetual_price,
  included_by_default,priced_per_branch,is_active
)
values (
  'ai_document_vault',
  'AI Document Vault',
  'Private document storage for AI-generated sales, stock, accounting and marketing summaries.',
  0,0,0,false,false,true
)
on conflict (code) do update
set name=excluded.name,
    description=excluded.description,
    is_active=true,
    updated_at=now();

insert into public.subscription_package_features(package_id,feature_code,included)
select p.id,'ai_document_vault',
       case when p.code in ('business','custom') then true else false end
from public.subscription_packages p
where p.code in ('starter','growth','business','custom')
on conflict (package_id,feature_code)
do update set included=excluded.included;

update public.pos_ai_package_quotas q
set document_storage_mb = case p.code
      when 'growth' then 256
      when 'business' then 1024
      else q.document_storage_mb
    end,
    document_retention_days = case p.code
      when 'growth' then 180
      when 'business' then 365
      else q.document_retention_days
    end,
    document_max_file_mb = case p.code
      when 'growth' then 3
      when 'business' then 5
      else coalesce(q.document_max_file_mb,5)
    end,
    updated_at=now()
from public.subscription_packages p
where p.id=q.package_id
  and p.code in ('growth','business');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'cpipos-ai-documents',
  'cpipos-ai-documents',
  false,
  5242880,
  array['text/plain','text/markdown','text/csv','text/html','application/json','application/pdf']::text[]
)
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.pos_ai_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  user_id uuid not null references public.users_profiles(id) on delete cascade,
  room_id uuid null references public.pos_ai_chat_rooms(id) on delete set null,
  title text not null check (char_length(title) between 1 and 180),
  file_name text not null check (char_length(file_name) between 1 and 220),
  format text not null check (format in ('markdown','csv','html','json','pdf')),
  mime_type text not null,
  object_path text not null unique,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  source_message_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz null
);

create index if not exists idx_pos_ai_documents_scope
  on public.pos_ai_documents(tenant_id,branch_id,user_id,created_at desc);
create index if not exists idx_pos_ai_documents_retention
  on public.pos_ai_documents(expires_at)
  where expires_at is not null;

drop trigger if exists trg_pos_ai_documents_touch on public.pos_ai_documents;
create trigger trg_pos_ai_documents_touch
before update on public.pos_ai_documents
for each row execute function app.touch_updated_at();

alter table public.pos_ai_documents enable row level security;

comment on table public.pos_ai_documents is
  'Metadata only. Document bytes live in private Supabase Storage bucket cpipos-ai-documents.';
