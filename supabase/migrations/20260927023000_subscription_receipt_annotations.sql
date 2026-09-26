-- Non-destructive administrative annotations for immutable subscription receipts.
-- The original financial receipt row remains immutable; IT may add a correction note
-- or mark the document void without deleting settlement evidence.
create table if not exists public.tenant_subscription_receipt_annotations (
  receipt_id uuid primary key references public.tenant_subscription_receipts(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  correction_note text,
  voided_at timestamptz,
  voided_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  constraint tenant_subscription_receipt_annotations_note_len
    check (correction_note is null or char_length(correction_note) <= 1000)
);

create index if not exists tenant_subscription_receipt_annotations_tenant_idx
  on public.tenant_subscription_receipt_annotations(tenant_id, updated_at desc);

alter table public.tenant_subscription_receipt_annotations enable row level security;
revoke all on public.tenant_subscription_receipt_annotations from public, anon, authenticated;
grant all on public.tenant_subscription_receipt_annotations to service_role;

comment on table public.tenant_subscription_receipt_annotations is
  'Administrative correction/void overlay for immutable subscription receipts. Original receipt/settlement rows are never updated or deleted.';
