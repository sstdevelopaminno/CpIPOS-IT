-- IT-confirmed tenant offboarding cleanup for the Communications plane.
-- The RPC removes DB rows transactionally and returns tenant-scoped storage paths
-- for the authenticated IT application to delete through Supabase Storage.

CREATE OR REPLACE FUNCTION public.it_delete_tenant_communications(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_conversations integer:=0;
  v_messages integer:=0;
  v_participants integer:=0;
  v_attachments integer:=0;
  v_calls integer:=0;
  v_storage jsonb:='[]'::jsonb;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id_required' using errcode='22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'bucket',a.storage_bucket,
    'path',a.storage_path
  )) filter(where a.storage_bucket is not null and a.storage_path is not null),'[]'::jsonb)
  into v_storage
  from public.support_attachments a
  join public.support_conversations c on c.id=a.conversation_id
  where c.tenant_id=p_tenant_id
    and a.deleted_at is null;

  select count(*) into v_conversations
  from public.support_conversations where tenant_id=p_tenant_id;

  select count(*) into v_messages
  from public.support_messages m
  join public.support_conversations c on c.id=m.conversation_id
  where c.tenant_id=p_tenant_id;

  select count(*) into v_participants
  from public.support_participants p
  join public.support_conversations c on c.id=p.conversation_id
  where c.tenant_id=p_tenant_id;

  select count(*) into v_attachments
  from public.support_attachments a
  join public.support_conversations c on c.id=a.conversation_id
  where c.tenant_id=p_tenant_id;

  select count(*) into v_calls
  from public.support_call_sessions where tenant_id=p_tenant_id;

  delete from public.support_conversations where tenant_id=p_tenant_id;

  return jsonb_build_object(
    'deleted',true,
    'tenant_id',p_tenant_id,
    'conversations',v_conversations,
    'messages',v_messages,
    'participants',v_participants,
    'attachments',v_attachments,
    'call_sessions',v_calls,
    'storage_objects',v_storage,
    'deleted_at',now()
  );
end;
$function$;

revoke all on function public.it_delete_tenant_communications(uuid) from public,anon,authenticated;
grant execute on function public.it_delete_tenant_communications(uuid) to service_role;
