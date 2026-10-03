create index if not exists customer_email_deliveries_daily_sales_tenant_created_idx
  on public.customer_email_deliveries(event_type, tenant_id, created_at desc)
  where event_type='daily_sales_summary';
