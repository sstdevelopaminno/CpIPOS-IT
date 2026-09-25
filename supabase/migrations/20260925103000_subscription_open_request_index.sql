create unique index if not exists tenant_subscription_one_open_request_idx on public.tenant_subscription_payment_requests(tenant_id) where status in ('pending','under_review');
