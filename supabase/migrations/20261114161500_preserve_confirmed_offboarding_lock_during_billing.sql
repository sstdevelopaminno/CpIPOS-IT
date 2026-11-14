-- Once IT has confirmed permanent tenant offboarding, billing refreshes
-- may still assess historical invoices but must NEVER unlock the store,
-- replace the tenant_deletion_confirmed lock, or create a new invoice.
-- Patch only the two installed function bodies, failing closed on drift.
do $patch$
declare
  v_refresh text;
  v_ensure text;
  v_timeout_anchor text := $anchor$'subscription_payment_review_timeout'$anchor$;
  v_timeout_replacement text := $replacement$'subscription_payment_review_timeout','tenant_deletion_confirmed'$replacement$;
  v_provisional_anchor text := $anchor$where r.tenant_id=l.tenant_id
    and r.status='under_review'$anchor$;
  v_provisional_replacement text := $replacement$where r.tenant_id=l.tenant_id
    and coalesce(l.lock_reason,'') <> 'tenant_deletion_confirmed'
    and r.status='under_review'$replacement$;
  v_ensure_anchor text := $anchor$or v_lifecycle.lifecycle_status in ('sales_demo','suspended','archived')$anchor$;
  v_ensure_replacement text := $replacement$or v_lifecycle.lifecycle_status in ('sales_demo','suspended','archived')
     or v_lifecycle.lock_reason='tenant_deletion_confirmed'$replacement$;
begin
  select pg_get_functiondef(p.oid) into v_refresh
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app' and p.proname='refresh_subscription_billing_lifecycle'
    and p.pronargs=1;
  if v_refresh is null then raise exception 'subscription_billing_refresh_missing'; end if;

  if position('tenant_deletion_confirmed' in v_refresh) = 0 then
    if (
      length(v_refresh)-length(replace(v_refresh,v_timeout_anchor,''))
    ) / length(v_timeout_anchor) <> 3 then
      raise exception 'subscription_billing_refresh_lock_guard_drift';
    end if;
    if position(v_provisional_anchor in v_refresh)=0 then
      raise exception 'subscription_billing_refresh_provisional_guard_drift';
    end if;
    execute replace(
      replace(v_refresh,v_timeout_anchor,v_timeout_replacement),
      v_provisional_anchor,v_provisional_replacement
    );
  end if;

  select pg_get_functiondef(p.oid) into v_ensure
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='app' and p.proname='ensure_tenant_subscription_billing_cycle'
    and p.pronargs=2;
  if v_ensure is null then raise exception 'subscription_cycle_ensure_missing'; end if;
  if position('tenant_deletion_confirmed' in v_ensure)=0 then
    if position(v_ensure_anchor in v_ensure)=0 then
      raise exception 'subscription_cycle_ensure_guard_drift';
    end if;
    execute replace(v_ensure,v_ensure_anchor,v_ensure_replacement);
  end if;
end
$patch$;
