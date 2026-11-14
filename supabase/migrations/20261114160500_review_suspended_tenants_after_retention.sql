-- Suspended or soft-disabled stores must still progress through IT retention
-- review AFTER the configured deadline. Do not automatically erase anything.
-- A paid shop keeps its 2-calendar-month grace + 30-day retention; Trial
-- remains 7 days access and deletion review after day 15.
do $refresh$
declare
  v_def text;
  v_old text := $old$    where t.is_active=true
      and l.lifecycle_status not in ('sales_demo','suspended','archived')$old$;
  v_new text := $new$    where l.lifecycle_status not in ('sales_demo','archived')$new$;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname='app' and p.proname='refresh_tenant_deletion_reviews'
    and p.pronargs=1;

  if v_def is null then
    raise exception 'tenant_deletion_review_refresh_missing';
  end if;
  if position(v_old in v_def) = 0 then
    if position(v_new in v_def) > 0 then return; end if;
    raise exception 'tenant_deletion_review_refresh_schema_drift';
  end if;

  -- Inclusion in the review queue is NOT authorization to delete.
  -- The separate IT Support confirmation and DB hard gate remain mandatory.
  execute replace(v_def, v_old, v_new);
end
$refresh$;
