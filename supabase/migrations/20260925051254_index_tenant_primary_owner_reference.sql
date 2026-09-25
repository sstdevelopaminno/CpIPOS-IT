-- Indexed canonical first Owner reference (already applied to shared CpiPOS-001).
create index if not exists idx_tenants_primary_owner_user_id
on public.tenants (primary_owner_user_id);
