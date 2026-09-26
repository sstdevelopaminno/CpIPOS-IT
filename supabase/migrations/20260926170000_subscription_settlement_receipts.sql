-- Atomic paid-subscription settlement and immutable receipt ledger.
-- Shared authority: CpiPOS-001. Only trusted IT server/service-role may call the settlement RPC.
-- A customer-uploaded slip is never enough to create a settlement or receipt.

create sequence if not exists public.subscription_receipt_number_seq;

create table if not exists public.tenant_subscription_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_request_id uuid not null unique references public.tenant_subscription_payment_requests(id) on delete restrict,
  billing_cycle_id uuid not null unique references public.tenant_billing_cycles(id) on delete restrict,
  package_id uuid not null references public.subscription_packages(id) on delete restrict,
  billing_interval text not null check (billing_interval in ('monthly','yearly')),
  amount_received numeric(12,2) not null check (amount_received > 0),
  currency text not null default 'THB',
  bank_transaction_reference text not null,
  bank_received_at timestamptz not null,
  verified_by uuid,
  verified_at timestamptz not null default now(),
  period_start date not null,
  period_end date not null,
  previous_expiry timestamptz,
  new_expiry timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (period_end > period_start),
  check (new_expiry > coalesce(previous_expiry, '-infinity'::timestamptz))
);

create unique index if not exists tenant_subscription_settlements_bank_ref_uidx
  on public.tenant_subscription_settlements (lower(bank_transaction_reference));

create index if not exists tenant_subscription_settlements_tenant_created_idx
  on public.tenant_subscription_settlements (tenant_id, created_at desc);

create table if not exists public.tenant_subscription_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  settlement_id uuid not null unique references public.tenant_subscription_settlements(id) on delete restrict,
  payment_request_id uuid not null unique references public.tenant_subscription_payment_requests(id) on delete restrict,
  billing_cycle_id uuid not null unique references public.tenant_billing_cycles(id) on delete restrict,
  receipt_number text not null unique,
  issued_at timestamptz not null default now(),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'THB',
  issuer_snapshot jsonb not null,
  customer_snapshot jsonb not null,
  package_snapshot jsonb not null,
  payment_snapshot jsonb not null,
  document_version integer not null default 1 check (document_version = 1),
  created_at timestamptz not null default now()
);

create index if not exists tenant_subscription_receipts_tenant_issued_idx
  on public.tenant_subscription_receipts (tenant_id, issued_at desc);

alter table public.tenant_subscription_settlements enable row level security;
alter table public.tenant_subscription_receipts enable row level security;

revoke all on table public.tenant_subscription_settlements from public, anon, authenticated;
revoke all on table public.tenant_subscription_receipts from public, anon, authenticated;
revoke all on sequence public.subscription_receipt_number_seq from public, anon, authenticated;
grant all on table public.tenant_subscription_settlements to service_role;
grant all on table public.tenant_subscription_receipts to service_role;
grant usage, select on sequence public.subscription_receipt_number_seq to service_role;

create or replace function app.prevent_subscription_financial_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $function$
begin
  raise exception 'immutable_subscription_financial_record';
end;
$function$;

drop trigger if exists trg_subscription_settlements_immutable on public.tenant_subscription_settlements;
create trigger trg_subscription_settlements_immutable
before update or delete on public.tenant_subscription_settlements
for each row execute function app.prevent_subscription_financial_mutation();

drop trigger if exists trg_subscription_receipts_immutable on public.tenant_subscription_receipts;
create trigger trg_subscription_receipts_immutable
before update or delete on public.tenant_subscription_receipts
for each row execute function app.prevent_subscription_financial_mutation();

create or replace function public.settle_subscription_payment(
  p_request_id uuid,
  p_actor_id uuid,
  p_bank_transaction_reference text,
  p_bank_received_at timestamptz,
  p_amount_received numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $function$
declare
  v_req public.tenant_subscription_payment_requests%rowtype;
  v_package public.subscription_packages%rowtype;
  v_lifecycle public.tenant_data_lifecycle%rowtype;
  v_tenant public.tenants%rowtype;
  v_contract public.tenant_subscription_contracts%rowtype;
  v_existing_settlement public.tenant_subscription_settlements%rowtype;
  v_existing_receipt public.tenant_subscription_receipts%rowtype;
  v_issuer record;
  v_owner_email text;
  v_interval text;
  v_expected numeric(12,2);
  v_now timestamptz := now();
  v_previous_expiry timestamptz;
  v_base timestamptz;
  v_new_expiry timestamptz;
  v_first_paid boolean;
  v_cycle_id uuid;
  v_settlement_id uuid;
  v_receipt_id uuid;
  v_receipt_number text;
  v_reference text := trim(coalesce(p_bank_transaction_reference,''));
  v_note text := nullif(left(trim(coalesce(p_note,'')),500),'');
  v_event_action text;
  v_retention_until timestamptz;
begin
  if p_request_id is null then raise exception 'request_required'; end if;
  if p_actor_id is null then raise exception 'actor_required'; end if;
  if char_length(v_reference) < 4 or char_length(v_reference) > 160 then
    raise exception 'bank_reference_invalid';
  end if;
  if p_bank_received_at is null
     or p_bank_received_at > v_now + interval '1 hour'
     or p_bank_received_at < v_now - interval '2 years' then
    raise exception 'bank_received_at_invalid';
  end if;
  if p_amount_received is null or p_amount_received <= 0 or p_amount_received > 10000000 then
    raise exception 'amount_received_invalid';
  end if;

  select * into v_req
  from public.tenant_subscription_payment_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'request_not_found'; end if;

  select * into v_existing_settlement
  from public.tenant_subscription_settlements
  where payment_request_id = p_request_id;

  if found then
    select * into v_existing_receipt
    from public.tenant_subscription_receipts
    where settlement_id = v_existing_settlement.id;
    return jsonb_build_object(
      'already_settled', true,
      'settlement_id', v_existing_settlement.id,
      'billing_cycle_id', v_existing_settlement.billing_cycle_id,
      'receipt_id', v_existing_receipt.id,
      'receipt_number', v_existing_receipt.receipt_number,
      'new_expiry', v_existing_settlement.new_expiry
    );
  end if;

  if v_req.status <> 'under_review' then raise exception 'request_not_under_review'; end if;
  if coalesce(v_req.metadata->>'kind','') <> 'payment_notice' then
    raise exception 'payment_notice_required';
  end if;
  if v_req.requested_package_id is null then raise exception 'requested_package_missing'; end if;

  select * into v_package
  from public.subscription_packages
  where id = v_req.requested_package_id and is_active = true;
  if not found then raise exception 'package_not_found'; end if;

  v_interval := case when v_req.metadata->>'billing_interval' = 'yearly' then 'yearly'
                     when v_req.metadata->>'billing_interval' = 'monthly' then 'monthly'
                     else null end;
  if v_interval is null then raise exception 'billing_interval_invalid'; end if;

  if coalesce(v_req.metadata->>'expected_amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then
    v_expected := (v_req.metadata->>'expected_amount')::numeric(12,2);
  else
    v_expected := case when v_interval = 'yearly' then v_package.yearly_price else v_package.monthly_price end;
  end if;
  if v_expected is null or v_expected <= 0 then raise exception 'expected_amount_missing'; end if;
  if round(p_amount_received::numeric,2) <> round(v_expected::numeric,2) then
    raise exception 'verified_amount_mismatch';
  end if;

  select * into v_tenant from public.tenants where id = v_req.tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  select * into v_lifecycle
  from public.tenant_data_lifecycle
  where tenant_id = v_req.tenant_id
  for update;
  if not found then raise exception 'tenant_lifecycle_not_found'; end if;

  if v_lifecycle.lifecycle_status = 'sales_demo'
     or coalesce(v_lifecycle.metadata->>'quota_exempt','false') = 'true' then
    raise exception 'internal_demo_not_billable';
  end if;
  if v_lifecycle.data_home <> 'primary' or v_lifecycle.migration_status not in ('idle','complete') then
    raise exception 'primary_data_migration_not_ready';
  end if;

  select * into v_contract
  from public.tenant_subscription_contracts
  where tenant_id = v_req.tenant_id
  order by created_at desc, id desc
  limit 1
  for update;

  v_previous_expiry := case
    when v_lifecycle.lifecycle_status in ('active','grace') then v_lifecycle.subscription_expires_at
    else null
  end;
  v_base := greatest(v_now, coalesce(v_previous_expiry, v_now));
  v_new_expiry := case when v_interval = 'yearly'
    then v_base + interval '1 year'
    else v_base + interval '1 month'
  end;
  v_first_paid := v_lifecycle.first_package_started_at is null
    or not exists (
      select 1 from public.tenant_subscription_settlements s where s.tenant_id = v_req.tenant_id
    );

  insert into public.tenant_billing_cycles(
    tenant_id, package_id, period_start, period_end,
    amount_due, amount_paid, status
  ) values (
    v_req.tenant_id, v_package.id, v_base::date, v_new_expiry::date,
    v_expected, p_amount_received, 'paid'
  ) returning id into v_cycle_id;

  begin
    insert into public.tenant_subscription_settlements(
      tenant_id, payment_request_id, billing_cycle_id, package_id,
      billing_interval, amount_received, currency,
      bank_transaction_reference, bank_received_at, verified_by,
      period_start, period_end, previous_expiry, new_expiry, metadata
    ) values (
      v_req.tenant_id, v_req.id, v_cycle_id, v_package.id,
      v_interval, p_amount_received, coalesce(nullif(v_req.currency,''),'THB'),
      v_reference, p_bank_received_at, p_actor_id,
      v_base::date, v_new_expiry::date, v_previous_expiry, v_new_expiry,
      jsonb_build_object(
        'request_type', v_req.request_type,
        'reported_amount', v_req.amount_reported,
        'first_paid_activation', v_first_paid
      )
    ) returning id into v_settlement_id;
  exception when unique_violation then
    raise exception 'bank_reference_already_used';
  end;

  if v_contract.id is not null
     and v_contract.status = 'active'
     and v_contract.package_id = v_package.id
     and v_contract.billing_interval = v_interval
     and v_lifecycle.lifecycle_status in ('active','grace') then
    update public.tenant_subscription_contracts
      set ended_at = v_new_expiry,
          amount_per_cycle = v_expected,
          currency = coalesce(nullif(v_req.currency,''),'THB'),
          max_branches = v_package.max_branches,
          branch_limit = greatest(1,coalesce(v_package.max_branches,1)),
          max_devices = v_package.max_devices,
          terminal_limit_per_branch = greatest(1,coalesce(v_package.max_devices,1)),
          max_users = v_package.max_users,
          updated_at = v_now,
          metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'last_settlement_id', v_settlement_id,
            'last_payment_request_id', v_req.id,
            'last_verified_at', v_now
          )
    where id = v_contract.id;
  else
    update public.tenant_subscription_contracts
      set status = 'cancelled',
          ended_at = least(coalesce(ended_at,v_now),v_now),
          updated_at = v_now
    where tenant_id = v_req.tenant_id and status in ('active','trial');

    insert into public.tenant_subscription_contracts(
      tenant_id, package_id, contract_type, billing_interval, deployment_mode,
      status, branch_limit, terminal_limit_per_branch, amount_per_cycle, currency,
      auto_renew, started_at, ended_at, max_branches, max_devices, max_users, metadata
    ) values (
      v_req.tenant_id, v_package.id, 'saas', v_interval, 'hybrid',
      'active', greatest(1,coalesce(v_package.max_branches,1)),
      greatest(1,coalesce(v_package.max_devices,1)), v_expected,
      coalesce(nullif(v_req.currency,''),'THB'), false, v_now, v_new_expiry,
      v_package.max_branches, v_package.max_devices, v_package.max_users,
      jsonb_build_object(
        'settlement_id', v_settlement_id,
        'payment_request_id', v_req.id,
        'verified_activation', true
      )
    );
  end if;

  v_retention_until := case
    when v_package.retention_months is null then null
    else coalesce(v_lifecycle.first_package_started_at,v_now)
      + make_interval(months => v_package.retention_months)
  end;

  update public.tenants
    set package_id = v_package.id, updated_at = v_now
  where id = v_req.tenant_id;

  update public.tenant_data_lifecycle
    set lifecycle_status = 'active',
        desired_data_home = 'primary',
        first_package_started_at = coalesce(first_package_started_at,v_now),
        current_package_started_at = case
          when v_contract.id is null
            or v_contract.status <> 'active'
            or v_contract.package_id <> v_package.id
            or v_contract.billing_interval <> v_interval then v_now
          else current_package_started_at
        end,
        subscription_expires_at = v_new_expiry,
        retention_until = v_retention_until,
        access_locked = false,
        lock_reason = null,
        payment_review_status = 'approved',
        payment_reviewed_at = v_now,
        payment_reviewed_by = p_actor_id,
        updated_at = v_now,
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'last_verified_settlement_id', v_settlement_id,
          'last_verified_payment_request_id', v_req.id,
          'last_verified_at', v_now,
          'package_code', v_package.code
        )
  where tenant_id = v_req.tenant_id;

  select
    billing_legal_name_th, billing_legal_name_en, billing_registered_address,
    billing_registration_no, billing_email, billing_vat_registered
  into v_issuer
  from public.it_communication_settings
  where id = 'default';

  if v_tenant.primary_owner_user_id is not null then
    select email into v_owner_email
    from public.users_profiles
    where id = v_tenant.primary_owner_user_id;
  end if;

  v_receipt_number := 'CPR-' || to_char(v_now,'YYYY') || '-' ||
    lpad(nextval('public.subscription_receipt_number_seq')::text,6,'0');

  insert into public.tenant_subscription_receipts(
    tenant_id, settlement_id, payment_request_id, billing_cycle_id,
    receipt_number, issued_at, amount, currency,
    issuer_snapshot, customer_snapshot, package_snapshot, payment_snapshot
  ) values (
    v_req.tenant_id, v_settlement_id, v_req.id, v_cycle_id,
    v_receipt_number, v_now, p_amount_received,
    coalesce(nullif(v_req.currency,''),'THB'),
    jsonb_build_object(
      'legal_name_th', coalesce(v_issuer.billing_legal_name_th,''),
      'legal_name_en', coalesce(v_issuer.billing_legal_name_en,''),
      'registered_address', coalesce(v_issuer.billing_registered_address,''),
      'registration_no', coalesce(v_issuer.billing_registration_no,''),
      'billing_email', coalesce(v_issuer.billing_email,''),
      'vat_registered', coalesce(v_issuer.billing_vat_registered,false)
    ),
    jsonb_build_object(
      'tenant_id', v_tenant.id,
      'store_code', v_tenant.code,
      'store_name', coalesce(v_tenant.display_name,v_tenant.name),
      'owner_name', v_tenant.owner_name,
      'address', v_tenant.company_address,
      'phone', coalesce(v_tenant.contact_phone,v_tenant.owner_phone),
      'email', v_owner_email
    ),
    jsonb_build_object(
      'package_id', v_package.id,
      'package_code', v_package.code,
      'package_name', v_package.name,
      'billing_interval', v_interval,
      'period_start', v_base::date,
      'period_end', v_new_expiry::date,
      'expected_amount', v_expected,
      'first_paid_activation', v_first_paid
    ),
    jsonb_build_object(
      'settlement_id', v_settlement_id,
      'payment_request_id', v_req.id,
      'bank_transaction_reference', v_reference,
      'bank_received_at', p_bank_received_at,
      'amount_received', p_amount_received,
      'currency', coalesce(nullif(v_req.currency,''),'THB'),
      'payer_name', v_req.metadata->>'payer_name',
      'customer_transfer_reference', v_req.metadata->>'transfer_reference'
    )
  ) returning id into v_receipt_id;

  update public.tenant_subscription_payment_requests
    set status = 'approved',
        reviewed_at = v_now,
        reviewed_by = p_actor_id,
        review_note = coalesce(v_note,review_note),
        updated_at = v_now,
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'settlement_id', v_settlement_id,
          'billing_cycle_id', v_cycle_id,
          'receipt_id', v_receipt_id,
          'receipt_number', v_receipt_number,
          'settled_at', v_now
        )
  where id = v_req.id;

  v_event_action := case when v_first_paid then 'approve' else 'renewal' end;
  insert into public.tenant_subscription_approval_events(
    tenant_id, payment_request_id, action, actor_id,
    from_status, to_status, metadata
  ) values (
    v_req.tenant_id, v_req.id, v_event_action, p_actor_id,
    v_req.status, 'approved',
    jsonb_build_object(
      'settlement_id', v_settlement_id,
      'billing_cycle_id', v_cycle_id,
      'receipt_id', v_receipt_id,
      'receipt_number', v_receipt_number,
      'package_code', v_package.code,
      'billing_interval', v_interval,
      'new_expiry', v_new_expiry
    )
  );

  return jsonb_build_object(
    'already_settled', false,
    'settlement_id', v_settlement_id,
    'billing_cycle_id', v_cycle_id,
    'receipt_id', v_receipt_id,
    'receipt_number', v_receipt_number,
    'first_paid_activation', v_first_paid,
    'period_start', v_base::date,
    'period_end', v_new_expiry::date,
    'new_expiry', v_new_expiry
  );
end;
$function$;

revoke all on function public.settle_subscription_payment(uuid,uuid,text,timestamptz,numeric,text)
  from public, anon, authenticated;
grant execute on function public.settle_subscription_payment(uuid,uuid,text,timestamptz,numeric,text)
  to service_role;

comment on table public.tenant_subscription_settlements is
  'Immutable trusted settlement ledger. Rows are created only after IT independently verifies money received.';
comment on table public.tenant_subscription_receipts is
  'Immutable non-VAT subscription receipt snapshots; one receipt per verified settlement.';
comment on function public.settle_subscription_payment(uuid,uuid,text,timestamptz,numeric,text) is
  'Atomically verifies a reviewed payment request into settlement + paid billing cycle + entitlement update + immutable receipt.';
