-- Cross-plane deletion proof now goes through the authenticated Primary Edge gateway.
-- Remove the temporary authenticated SECURITY DEFINER verifier so this fix does
-- not add another Security Advisor finding.

revoke all on function public.it_verify_tenant_deleted_for_cross_plane_cleanup(uuid)
from public, anon, authenticated, service_role;

drop function if exists public.it_verify_tenant_deleted_for_cross_plane_cleanup(uuid);
