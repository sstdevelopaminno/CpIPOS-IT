-- Configurable company identity and transactional email footer managed by IT.
alter table public.it_communication_settings
  add column if not exists company_thai_name text not null default 'บริษัท คัตติ้งพอยท์ เทค จำกัด',
  add column if not exists company_english_name text not null default 'Cutting Point Tech Co., Ltd.',
  add column if not exists contact_phone text not null default '098-5460-355',
  add column if not exists website_url text not null default 'https://cuttingpointinnovation.vercel.app/',
  add column if not exists email_footer_note text not null default 'หากต้องการความช่วยเหลือ กรุณาติดต่อ Support';

comment on column public.it_communication_settings.company_thai_name is 'Thai company name shown in CpIPOS transactional email footer.';
comment on column public.it_communication_settings.company_english_name is 'English company name shown in CpIPOS transactional email footer.';
comment on column public.it_communication_settings.contact_phone is 'Company contact phone shown in transactional email footer.';
comment on column public.it_communication_settings.website_url is 'Company/CpIPOS website used by the transactional email CTA and footer.';
comment on column public.it_communication_settings.email_footer_note is 'Plain-text footer note shown above the company contact block. Raw HTML is intentionally not accepted.';
