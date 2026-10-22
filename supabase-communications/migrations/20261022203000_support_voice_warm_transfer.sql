-- Warm transfer state for CpIPOS Support voice calls.
-- Stores routing/control state only. Audio remains peer-to-peer WebRTC and is never persisted.

alter table public.support_call_sessions
  add column if not exists transfer_status text,
  add column if not exists transfer_target_user_id uuid,
  add column if not exists transfer_target_name text,
  add column if not exists transfer_target_role text,
  add column if not exists transfer_requested_by_user_id uuid,
  add column if not exists transfer_requested_by_name text,
  add column if not exists transfer_requested_at timestamptz,
  add column if not exists transfer_accepted_at timestamptz,
  add column if not exists transfer_completed_at timestamptz,
  add column if not exists previous_it_user_id uuid,
  add column if not exists previous_it_name text,
  add column if not exists previous_it_role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'support_call_sessions_transfer_status_chk'
      and conrelid = 'public.support_call_sessions'::regclass
  ) then
    alter table public.support_call_sessions
      add constraint support_call_sessions_transfer_status_chk
      check (
        transfer_status is null
        or transfer_status in ('requested','accepted','completed','declined','cancelled','returning')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'support_call_sessions_transfer_target_role_chk'
      and conrelid = 'public.support_call_sessions'::regclass
  ) then
    alter table public.support_call_sessions
      add constraint support_call_sessions_transfer_target_role_chk
      check (
        transfer_target_role is null
        or transfer_target_role in ('it_admin','it_support')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'support_call_sessions_previous_it_role_chk'
      and conrelid = 'public.support_call_sessions'::regclass
  ) then
    alter table public.support_call_sessions
      add constraint support_call_sessions_previous_it_role_chk
      check (
        previous_it_role is null
        or previous_it_role in ('it_admin','it_support')
      );
  end if;
end $$;

create index if not exists support_call_sessions_transfer_target_user_idx
  on public.support_call_sessions (transfer_target_user_id, transfer_requested_at asc)
  where transfer_status = 'requested';

create index if not exists support_call_sessions_transfer_target_role_idx
  on public.support_call_sessions (transfer_target_role, transfer_requested_at asc)
  where transfer_status = 'requested';

comment on column public.support_call_sessions.transfer_status is
  'Warm-transfer control state only. No audio or media is stored.';
comment on column public.support_call_sessions.transfer_target_user_id is
  'Optional target IT user UUID from the primary Control Plane; intentionally no cross-project foreign key.';
