-- Bounded aggregate used by POS document quota checks without scanning rows into Vercel memory.
create or replace function public.pos_ai_document_tenant_usage(p_tenant_id uuid)
returns table(file_count bigint,total_bytes bigint)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select count(*)::bigint,
         coalesce(sum(d.size_bytes),0)::bigint
  from public.pos_ai_documents d
  where d.tenant_id = p_tenant_id;
$fn$;

revoke all on function public.pos_ai_document_tenant_usage(uuid) from public, anon, authenticated;
grant execute on function public.pos_ai_document_tenant_usage(uuid) to service_role;
