-- System-generated events have no authenticated human actor.
-- Keep the FK and human attribution invariant. No synthetic user is created.
-- Existing client RLS policies remain unchanged; restrictive policy preserves
-- the former NOT NULL requirement for all non-bypass callers.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_actor_required_unless_system
  CHECK (actor_user_id IS NOT NULL OR actor_role = 'system');
ALTER TABLE public.audit_logs ALTER COLUMN actor_user_id DROP NOT NULL;

CREATE POLICY audit_logs_client_actor_required
  ON public.audit_logs
  AS RESTRICTIVE
  FOR INSERT
  TO PUBLIC
  WITH CHECK (actor_user_id IS NOT NULL);
