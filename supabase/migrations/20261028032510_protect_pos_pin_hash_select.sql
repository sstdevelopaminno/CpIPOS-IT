-- Keep PIN hashes available only to trusted server-side/service-role flows.
-- RLS remains unchanged; this hardens Data API column exposure for browser roles.

revoke select on table public.users_profiles from anon, authenticated;

grant select (
  id,
  email,
  full_name,
  platform_role,
  is_active,
  created_at,
  updated_at,
  archived_at,
  avatar_url
) on table public.users_profiles to authenticated;

revoke select on table public.pos_user_approval_permissions from anon, authenticated;

grant select (
  tenant_id,
  branch_id,
  user_id,
  action,
  is_enabled,
  granted_by,
  granted_at,
  updated_at
) on table public.pos_user_approval_permissions to authenticated;
