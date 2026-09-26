-- Central emergency broadcast control for company website and CpIPOS clients.
create table if not exists public.platform_emergency_broadcast (
  id text primary key default 'global',
  enabled boolean not null default false,
  severity text not null default 'warning' check (severity in ('info','warning','danger','emergency')),
  title_th text not null default '',
  title_en text not null default '',
  message_th text not null default '',
  message_en text not null default '',
  action_label_th text not null default '',
  action_label_en text not null default '',
  action_url text,
  bar_color text not null default '#FACC15',
  text_color text not null default '#111827',
  button_color text not null default '#B91C1C',
  button_text_color text not null default '#FFFFFF',
  target_company_web boolean not null default true,
  target_pos boolean not null default false,
  dismissible boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_emergency_broadcast_window_chk
    check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint platform_emergency_broadcast_action_url_chk
    check (action_url is null or action_url ~ '^https://')
);

alter table public.platform_emergency_broadcast enable row level security;

revoke all on table public.platform_emergency_broadcast from anon, authenticated;
grant select, insert, update, delete on table public.platform_emergency_broadcast to service_role;

insert into public.platform_emergency_broadcast (
  id, enabled, severity,
  title_th, title_en,
  message_th, message_en,
  action_label_th, action_label_en, action_url,
  bar_color, text_color, button_color, button_text_color,
  target_company_web, target_pos, dismissible,
  starts_at, ends_at
)
values (
  'global',
  true,
  'emergency',
  'แจ้งเตือนเฝ้าระวังน้ำท่วม',
  'Flood risk alert',
  'ปภ. แจ้งเฝ้าระวังฝนตกหนักถึงหนักมาก 26–27 ก.ย. 2569 เสี่ยงน้ำท่วมฉับพลันและน้ำท่วมขัง โปรดติดตามประกาศจากหน่วยงานรัฐและหลีกเลี่ยงพื้นที่น้ำท่วม',
  'Authorities advise monitoring heavy to very heavy rain on 26–27 Sep 2026, with flash-flood and inundation risk. Follow official updates and avoid flooded areas.',
  'ตรวจสอบสถานการณ์',
  'View official update',
  'https://www.prd.go.th/th/content/category/detail/id/33/iid/545072',
  '#FACC15',
  '#111827',
  '#B91C1C',
  '#FFFFFF',
  true,
  true,
  true,
  now(),
  '2026-09-28T00:00:00+07:00'
)
on conflict (id) do nothing;
