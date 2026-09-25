-- Add editable invoicing identity and receiving-account metadata to the existing IT-only singleton.
-- This is NOT the restaurant's POS payment account and does not change sales/payment tables.
alter table public.it_communication_settings
  add column if not exists billing_legal_name_th text not null default 'บริษัท คัตติ้งพอยท์ เทค จำกัด',
  add column if not exists billing_legal_name_en text not null default 'CUTTING POINT TECH CO., LTD.',
  add column if not exists billing_registered_address text not null default '',
  add column if not exists billing_registration_no text not null default '',
  add column if not exists billing_bank_name text not null default '',
  add column if not exists billing_bank_account_name text not null default '',
  add column if not exists billing_bank_account_number text not null default '',
  add column if not exists billing_promptpay_id text not null default '',
  add column if not exists billing_vat_registered boolean not null default false;

comment on column public.it_communication_settings.billing_vat_registered is
  'Current issuer VAT registration status. False until the company has verified VAT registration; do not infer that a payment notice is a tax invoice.';

-- Preserve existing RLS/service-only access. Do not grant access to POS users or browsers.
revoke all on public.it_communication_settings from anon, authenticated;
