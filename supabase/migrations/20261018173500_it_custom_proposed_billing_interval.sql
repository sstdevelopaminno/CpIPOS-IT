-- Per-tenant CUSTOM quote billing-cycle preference. It is a proposal only.
-- Never change tenant_subscription_contracts or create billing/payment records here.
alter table public.tenant_custom_package_terms
  add column if not exists proposed_billing_interval text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenant_custom_package_terms'::regclass
      and conname = 'tenant_custom_terms_proposed_billing_chk'
  ) then
    alter table public.tenant_custom_package_terms
      add constraint tenant_custom_terms_proposed_billing_chk
      check (proposed_billing_interval is null
          or proposed_billing_interval in ('monthly', 'yearly'));
  end if;
end
$$;

comment on column public.tenant_custom_package_terms.proposed_billing_interval
  is 'IT-selected proposed CUSTOM billing interval. Does not alter actual contract or billing until approved through existing financial workflow.';
