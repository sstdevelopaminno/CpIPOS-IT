SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
CREATE INDEX IF NOT EXISTS idx_cpipos_health_snapshots_latest_id ON public.pos_device_health_snapshots (latest_id);
CREATE INDEX IF NOT EXISTS idx_cpipos_stock_movements_ingredient_fk ON public.stock_movements (ingredient_id);
CREATE INDEX IF NOT EXISTS idx_cpipos_kitchen_tickets_order_fk ON public.kitchen_tickets (order_id);
CREATE INDEX IF NOT EXISTS idx_cpipos_orders_branch_fk ON public.orders (branch_id);
