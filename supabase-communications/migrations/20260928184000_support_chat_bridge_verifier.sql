-- Support Chat cross-project bridge verifier for CpiPOS-Communications.
-- The private.support_chat_bridge_config secret row is provisioned operationally
-- and must never be committed to source control.

create schema if not exists private;

create table if not exists private.support_chat_bridge_config (
  id text primary key,
  secret text not null,
  updated_at timestamptz not null default now()
);

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function public.verify_support_chat_bridge_token(
  p_payload jsonb,
  p_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions
as $$
declare
  v_secret text;
  v_expected text;
  v_exp bigint;
begin
  select secret into v_secret
  from private.support_chat_bridge_config
  where id='v1';

  if v_secret is null or p_payload is null or coalesce(p_signature,'') = '' then
    return null;
  end if;

  v_expected := encode(
    hmac(convert_to(p_payload::text,'UTF8'), convert_to(v_secret,'UTF8'), 'sha256'),
    'hex'
  );

  if v_expected <> lower(p_signature) then
    return null;
  end if;

  v_exp := nullif(p_payload->>'exp','')::bigint;
  if v_exp is null or v_exp < floor(extract(epoch from now()))::bigint then
    return null;
  end if;

  if coalesce((p_payload->>'v')::int,0) <> 1 then
    return null;
  end if;

  return p_payload;
end;
$$;

revoke all on function public.verify_support_chat_bridge_token(jsonb,text)
  from public, anon, authenticated;
grant execute on function public.verify_support_chat_bridge_token(jsonb,text)
  to service_role;
