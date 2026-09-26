-- Allow the public company website to read only active website-targeted emergency broadcasts
-- through the publishable Supabase key. Write access remains service-role / IT-admin only.

grant select (
  id,
  enabled,
  severity,
  title_th,
  title_en,
  message_th,
  message_en,
  action_label_th,
  action_label_en,
  action_url,
  bar_color,
  text_color,
  button_color,
  button_text_color,
  target_company_web,
  dismissible,
  starts_at,
  ends_at,
  updated_at
) on table public.platform_emergency_broadcast to anon;

drop policy if exists platform_emergency_broadcast_public_company_read
  on public.platform_emergency_broadcast;

create policy platform_emergency_broadcast_public_company_read
  on public.platform_emergency_broadcast
  for select
  to anon
  using (
    enabled = true
    and target_company_web = true
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );
