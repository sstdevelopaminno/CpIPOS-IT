-- Phase 2 WebRTC signaling room key.
-- The key is high entropy and is used only to name an ephemeral Supabase Realtime Broadcast channel.
-- SDP/ICE/audio are never persisted in this table.

alter table public.support_call_sessions
  add column if not exists signaling_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'support_call_sessions_signaling_key_length_chk'
      and conrelid = 'public.support_call_sessions'::regclass
  ) then
    alter table public.support_call_sessions
      add constraint support_call_sessions_signaling_key_length_chk
      check (signaling_key is null or char_length(signaling_key) >= 48);
  end if;
end $$;

create unique index if not exists support_call_sessions_signaling_key_idx
  on public.support_call_sessions (signaling_key)
  where signaling_key is not null;

comment on column public.support_call_sessions.signaling_key is
  'High-entropy ephemeral Realtime channel key for WebRTC signaling. No SDP, ICE candidates, audio, or recordings are persisted.';
