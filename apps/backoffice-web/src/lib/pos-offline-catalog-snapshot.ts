import { saveOfflineCatalogSnapshot, setOfflineMeta } from "@/lib/pos-offline-sale-store";

type CachePosSalesOfflineCatalogSnapshotInput = {
  tenant_id: string;
  branch_id: string;
  branch_code?: string | null;
  device_code?: string | null;
  products: readonly unknown[];
  categories: readonly string[];
  tables?: readonly unknown[];
  tax_settings?: unknown;
  inventory_settings?: unknown;
  store_profile?: unknown;
  payment_account?: unknown;
  payment_providers?: unknown;
  notification_settings?: unknown;
  device_policy?: unknown;
  delivery_configs?: unknown;
  delivery_prices_by_product?: unknown;
};

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return { value };
}

function toRecordArray(items: readonly unknown[] | undefined): Array<Record<string, unknown>> {
  return (items ?? []).map((item) => toRecord(item));
}

export async function cachePosSalesOfflineCatalogSnapshot(input: CachePosSalesOfflineCatalogSnapshotInput) {
  if (typeof window === "undefined") return null;

  const tenantId = input.tenant_id.trim();
  const branchId = input.branch_id.trim();

  if (!tenantId || !branchId || input.products.length === 0) {
    return null;
  }

  const snapshot = await saveOfflineCatalogSnapshot({
    tenant_id: tenantId,
    branch_id: branchId,
    branch_code: input.branch_code ?? null,
    device_code: input.device_code ?? null,
    products: toRecordArray(input.products),
    categories: [...input.categories],
    tables: toRecordArray(input.tables),
    tax_rules: input.tax_settings ? [toRecord(input.tax_settings)] : [],
    metadata: {
      source: "pos_sales_module",
      saved_reason: "online_sales_load",
      inventory_settings: input.inventory_settings ?? null,
      store_profile: input.store_profile ?? null,
      payment_account: input.payment_account ?? null,
      payment_providers: input.payment_providers ?? null,
      notification_settings: input.notification_settings ?? null,
      device_policy: input.device_policy ?? null,
      delivery_configs: input.delivery_configs ?? null,
      delivery_prices_by_product: input.delivery_prices_by_product ?? null
    }
  });

  await Promise.allSettled([
    setOfflineMeta("last_catalog_snapshot_id", snapshot.id),
    setOfflineMeta(`last_catalog_snapshot:${tenantId}:${branchId}`, {
      id: snapshot.id,
      tenant_id: tenantId,
      branch_id: branchId,
      saved_at: snapshot.saved_at,
      product_count: snapshot.products.length,
      category_count: snapshot.categories.length
    })
  ]);

  return snapshot;
}
