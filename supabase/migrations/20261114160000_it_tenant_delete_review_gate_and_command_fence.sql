-- Permanent tenant erasure is separate from suspension and paid grace.
-- Zero tenant business data is deleted by this migration.
-- Guard the EXISTING transactional purge RPC without reimplementing its FK
-- cleanup; fail the migration if the deployed function signature has drifted.

do $approval_gate$
declare
  v_definition text;
  v_anchor text := $anchor$  if v_tenant.is_active then raise exception 'tenant_must_be_inactive'; end if;$anchor$;
  v_residual_anchor text := $anchor$      and cols.table_name <> 'it_tenant_deletion_cleanup'$anchor$;
  v_residual_replacement text := $anchor$      and cols.table_name <> all(array['it_tenant_deletion_cleanup','it_tenant_communications_cleanup'])$anchor$;
  v_replacement text := $replacement$  if v_tenant.is_active then raise exception 'tenant_must_be_inactive'; end if;

  -- Every deletion path, including direct Store Control calls to this RPC,
  -- must pass the same IT Support review and data retention requirements.
  if not exists (
    select 1 from public.users_profiles up
    where up.id = p_actor_user_id and up.platform_role = 'it_support'
      and up.is_active = true
  ) then
    raise exception 'tenant_delete_it_support_required';
  end if;

  if not exists (
    select 1
      from public.tenant_lifecycle_deletion_reviews review
      join public.tenant_data_lifecycle lifecycle
        on lifecycle.tenant_id = review.tenant_id
    where review.tenant_id = p_tenant_id
      and review.review_status = 'ready_to_delete'
      and review.confirmed_at is not null
      and review.confirmed_by is not null
      and review.deletion_review_at <= now()
      and review.access_grace_until <= now()
      and (not review.mdm_release_required or review.mdm_release_completed_at is not null)
      and lifecycle.access_locked = true
      and lifecycle.lock_reason = 'tenant_deletion_confirmed'
      and review.service_ended_at = (
        case
          when lifecycle.first_package_started_at is null then lifecycle.trial_expires_at
          else lifecycle.subscription_expires_at
        end
      )
  ) then
    raise exception 'tenant_delete_review_required';
  end if;$replacement$;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'it_delete_tenant_cascade'
    and p.pronargs = 4;

  if v_definition is null then
    raise exception 'it_delete_tenant_cascade_missing';
  end if;

  if position('tenant_delete_review_required' in v_definition) > 0 then
    return; -- already migrated
  end if;

  if position(v_anchor in v_definition) = 0 then
    raise exception 'it_delete_tenant_cascade_signature_drift';
  end if;

  if position(v_residual_anchor in v_definition) = 0 then
    raise exception 'it_delete_tenant_cascade_residual_guard_drift';
  end if;

  -- Communications cleanup is a deliberately retained post-delete journal.
  -- It must not be mistaken for leftover tenant business data by the
  -- existing transactional residual-table detector.
  execute replace(
    replace(v_definition, v_anchor, v_replacement),
    v_residual_anchor,
    v_residual_replacement
  );
end
$approval_gate$;

-- When IT chooses permanent deletion, revoke live POS sessions and disable
-- unexecuted device commands even if MDM Device Owner release is pending.
-- Preserve the MDM release transport until the device acknowledges release.
create or replace function app.stop_tenant_operations_on_it_delete_approval()
returns trigger
language plpgsql security definer set search_path = ''
as $stop$
begin
  if new.confirmed_at is not null
     and new.review_status in ('mdm_release_pending', 'ready_to_delete')
     and (old.review_status is distinct from new.review_status
          or old.confirmed_at is distinct from new.confirmed_at)
  then
    update public.pos_sessions
       set status = 'revoked', revoked_at = now(), updated_at = now()
     where tenant_id = new.tenant_id and status = 'active';

    update public.device_commands
       set status = 'expired', expires_at = now()
     where tenant_id = new.tenant_id and status = 'pending';

    update public.mdm_commands
       set status = 'cancelled',
           command_result = coalesce(command_result, '{}'::jsonb)
             || jsonb_build_object('reason','it_confirmed_tenant_deletion'),
           updated_at = now()
     where tenant_id = new.tenant_id
       and status in ('queued', 'picked_up', 'running')
       and command_type <> 'release_device_owner';

    update public.mdm_remote_support_sessions
       set status = 'ended', ended_at = now(), updated_at = now()
     where tenant_id = new.tenant_id
       and status in ('requested', 'active');
  end if;
  return new;
end;
$stop$;

revoke all on function app.stop_tenant_operations_on_it_delete_approval()
  from public, anon, authenticated;

drop trigger if exists trg_stop_tenant_operations_on_it_delete_approval
  on public.tenant_lifecycle_deletion_reviews;
create trigger trg_stop_tenant_operations_on_it_delete_approval
after update of review_status, confirmed_at
on public.tenant_lifecycle_deletion_reviews
for each row execute function app.stop_tenant_operations_on_it_delete_approval();

-- Prevent new commands being queued after approval. The sole exception is
-- release_device_owner during MDM offboarding: device-owner lock must be
-- removed safely before the tenant's MDM credentials and records are erased.
create or replace function app.reject_commands_for_approved_tenant_deletion()
returns trigger
language plpgsql security definer set search_path = ''
as $guard$
declare
  v_review_status text;
begin
  select r.review_status into v_review_status
  from public.tenant_lifecycle_deletion_reviews r
  where r.tenant_id = new.tenant_id
    and r.confirmed_at is not null
    and r.review_status in ('mdm_release_pending', 'ready_to_delete');

  if v_review_status is not null then
    if tg_table_name = 'mdm_commands'
       and new.command_type = 'release_device_owner'
       and v_review_status = 'mdm_release_pending'
    then
      return new;
    end if;
    raise exception 'tenant_offboarding_commands_blocked';
  end if;
  return new;
end;
$guard$;

revoke all on function app.reject_commands_for_approved_tenant_deletion()
  from public, anon, authenticated;

drop trigger if exists trg_reject_tenant_device_commands_after_approval
  on public.device_commands;
create trigger trg_reject_tenant_device_commands_after_approval
before insert on public.device_commands
for each row execute function app.reject_commands_for_approved_tenant_deletion();

drop trigger if exists trg_reject_tenant_mdm_commands_after_approval
  on public.mdm_commands;
create trigger trg_reject_tenant_mdm_commands_after_approval
before insert on public.mdm_commands
for each row execute function app.reject_commands_for_approved_tenant_deletion();
