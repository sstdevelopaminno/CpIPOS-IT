-- Keep the privileged AI Add-on settlement RPC server-side only.
-- The IT settlement route uses the primary service-role client after requireItAdmin().
revoke execute on function public.settle_ai_addon_payment(uuid, uuid, text, timestamptz, numeric, text)
  from public, anon, authenticated;

grant execute on function public.settle_ai_addon_payment(uuid, uuid, text, timestamptz, numeric, text)
  to service_role;
