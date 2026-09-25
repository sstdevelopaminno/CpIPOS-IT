-- These SECURITY DEFINER helpers return trigger and must never be public RPCs.
-- The existing trigger bindings remain, and server-side service_role stays allowed.
revoke execute on function public.fg0003_close_generated_qr_review_child_event() from public, anon, authenticated;
revoke execute on function public.fg0003_close_pending_qr_on_terminal_table_session() from public, anon, authenticated;
revoke execute on function public.fg0003_mark_internal_qr_review_child_nonpending() from public, anon, authenticated;
revoke execute on function public.null_missing_product_channel_price_audit_refs() from public, anon, authenticated;

grant execute on function public.fg0003_close_generated_qr_review_child_event() to service_role;
grant execute on function public.fg0003_close_pending_qr_on_terminal_table_session() to service_role;
grant execute on function public.fg0003_mark_internal_qr_review_child_nonpending() to service_role;
grant execute on function public.null_missing_product_channel_price_audit_refs() to service_role;
