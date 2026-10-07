-- Financial settlements and receipt snapshots are immutable.
-- Contract corrections update the mutable billing-cycle schedule and add a
-- receipt annotation overlay for corrected service-period presentation.

create or replace function app.reconcile_subscription_billing_period_to_contract(
  p_contract_id uuid,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog,public,app
as $function$
declare
  v_contract public.tenant_subscription_contracts%rowtype;
  v_settlement public.tenant_subscription_settlements%rowtype;
  v_cycle public.tenant_billing_cycles%rowtype;
  v_receipt public.tenant_subscription_receipts%rowtype;
  v_start date;
  v_end date;
  v_actor uuid;
  v_reason text:=nullif(left(trim(coalesce(p_reason,'')),600),'');
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_contract
  from public.tenant_subscription_contracts
  where id=p_contract_id
  for update;
  if not found then raise exception 'contract_not_found'; end if;
  if v_contract.started_at is null or v_contract.ended_at is null or v_contract.ended_at<=v_contract.started_at then
    return jsonb_build_object('reconciled',false,'reason','contract_window_invalid');
  end if;

  select * into v_settlement
  from public.tenant_subscription_settlements
  where tenant_id=v_contract.tenant_id
    and package_id=v_contract.package_id
    and coalesce((metadata->>'first_paid_activation')::boolean,false)=true
  order by created_at,id
  limit 1;
  if not found then
    return jsonb_build_object('reconciled',false,'reason','no_first_paid_settlement');
  end if;

  select * into v_cycle
  from public.tenant_billing_cycles
  where id=v_settlement.billing_cycle_id
  for update;
  if not found then raise exception 'billing_cycle_not_found'; end if;

  select * into v_receipt
  from public.tenant_subscription_receipts
  where billing_cycle_id=v_cycle.id
  order by issued_at,id
  limit 1;

  v_start := (v_contract.started_at at time zone 'Asia/Bangkok')::date;
  v_end := (v_contract.ended_at at time zone 'Asia/Bangkok')::date;
  if v_start>=v_end then raise exception 'contract_window_invalid'; end if;

  if v_cycle.period_start=v_start and v_cycle.period_end=v_end then
    return jsonb_build_object(
      'reconciled',false,'reason','already_aligned',
      'billing_cycle_id',v_cycle.id,'settlement_id',v_settlement.id,'receipt_id',v_receipt.id
    );
  end if;

  v_before:=jsonb_build_object(
    'contract_id',v_contract.id,
    'contract_start',v_contract.started_at,
    'contract_end',v_contract.ended_at,
    'cycle_start',v_cycle.period_start,
    'cycle_end',v_cycle.period_end,
    'immutable_settlement_start',v_settlement.period_start,
    'immutable_settlement_end',v_settlement.period_end,
    'immutable_receipt_period_start',v_receipt.package_snapshot->>'period_start',
    'immutable_receipt_period_end',v_receipt.package_snapshot->>'period_end'
  );

  update public.tenant_billing_cycles
  set period_start=v_start,period_end=v_end
  where id=v_cycle.id and tenant_id=v_contract.tenant_id;

  if v_receipt.id is not null then
    insert into public.tenant_subscription_receipt_annotations(
      receipt_id,tenant_id,correction_note,updated_at,updated_by,metadata
    ) values (
      v_receipt.id,v_contract.tenant_id,
      coalesce(v_reason,'แก้ไขช่วงบริการให้ตรงตามสัญญา Tenants / Stores')||
        ' · ช่วงบริการที่ถูกต้อง '||v_start::text||' ถึง '||v_end::text||
        ' · ยอดรับเงินจริง เลขอ้างอิงธนาคาร เลขที่ใบเสร็จ และ Settlement เดิมไม่เปลี่ยนแปลง',
      now(),p_actor_id,
      jsonb_build_object(
        'source','tenant_contract_period_reconciliation',
        'contract_id',v_contract.id,
        'original_period_start',v_receipt.package_snapshot->>'period_start',
        'original_period_end',v_receipt.package_snapshot->>'period_end',
        'corrected_period_start',v_start,
        'corrected_period_end',v_end,
        'settlement_immutable',true,
        'receipt_snapshot_immutable',true
      )
    )
    on conflict(receipt_id) do update set
      correction_note=excluded.correction_note,
      updated_at=excluded.updated_at,
      updated_by=excluded.updated_by,
      metadata=coalesce(public.tenant_subscription_receipt_annotations.metadata,'{}'::jsonb)||excluded.metadata;
  end if;

  update public.tenant_data_lifecycle
  set first_package_started_at=v_contract.started_at,
      current_package_started_at=v_contract.started_at,
      subscription_expires_at=v_contract.ended_at,
      updated_at=now()
  where tenant_id=v_contract.tenant_id
    and lifecycle_status in ('active','grace','expired');

  v_after:=jsonb_build_object(
    'contract_id',v_contract.id,
    'period_start',v_start,
    'period_end',v_end,
    'billing_cycle_id',v_cycle.id,
    'settlement_id',v_settlement.id,
    'receipt_id',v_receipt.id,
    'settlement_immutable',true,
    'receipt_snapshot_immutable',true
  );

  select id into v_actor from public.users_profiles where id=p_actor_id;
  if v_actor is not null then
    insert into public.audit_logs(
      tenant_id,actor_user_id,actor_role,action,target_table,target_id,metadata,
      user_id,role,module,entity_type,entity_id,before_data,after_data
    ) values (
      v_contract.tenant_id,v_actor,'it_admin',
      'subscription_billing_period_contract_reconciled',
      'tenant_billing_cycles',v_cycle.id,
      jsonb_build_object(
        'reason',v_reason,'contract_id',v_contract.id,'settlement_id',v_settlement.id,'receipt_id',v_receipt.id,
        'financial_records_immutable',true
      ),
      v_actor,'it_admin','it_admin','tenant_billing_cycles',v_cycle.id::text,v_before,v_after
    );
  end if;

  return jsonb_build_object(
    'reconciled',true,
    'tenant_id',v_contract.tenant_id,
    'contract_id',v_contract.id,
    'billing_cycle_id',v_cycle.id,
    'settlement_id',v_settlement.id,
    'receipt_id',v_receipt.id,
    'period_start',v_start,
    'period_end',v_end,
    'financial_records_immutable',true
  );
end;
$function$;

revoke all on function app.reconcile_subscription_billing_period_to_contract(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function app.reconcile_subscription_billing_period_to_contract(uuid,uuid,text)
to service_role;
