"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { ProductManagementPanel } from "@/components/backoffice/product-management-panel";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";

type StockView = "product_management" | "ingredients" | "movements" | "delivery_configs" | "delivery_prices";

type IngredientRow = {
  id: string;
  name: string;
  base_unit: string;
  quantity_on_hand: number;
  reorder_level: number;
  updated_at: string;
};

type MovementRow = {
  id: string;
  ingredient_id: string;
  movement_type: string;
  quantity_delta: number;
  reason: string;
  created_at: string;
  ingredients?: { name?: string } | null;
};

type DeliveryConfigRow = {
  id?: string;
  channel: string;
  commission_rate_pct: number;
  commission_vat_rate_pct: number;
  order_code_rule: "free_text" | "regex";
  order_code_regex: string | null;
  order_code_example?: string | null;
  source_title?: string | null;
  source_url?: string | null;
  source_checked_at?: string | null;
  is_active?: boolean;
  updated_at?: string;
};

type DeliveryPriceRow = {
  id: string;
  product_id: string;
  channel: string;
  app_price: number;
  is_active: boolean;
  updated_at: string;
  products?: {
    name?: string;
    sku?: string | null;
    price?: number;
  } | null;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string };
};

const DELIVERY_CHANNEL_OPTIONS = [
  { value: "line_man", label: "LINE MAN" },
  { value: "grab", label: "GrabFood" },
  { value: "shopee", label: "ShopeeFood" },
  { value: "foodpanda", label: "foodpanda" },
  { value: "merchant_app", label: "Merchant App" },
  { value: "other", label: "Other" }
] as const;

export function StockModule() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<StockView>("product_management");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [movementType, setMovementType] = useState("");
  const [deliveryChannelFilter, setDeliveryChannelFilter] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [adjustSuccess, setAdjustSuccess] = useState<string | null>(null);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [deliverySuccess, setDeliverySuccess] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const fromQuery = searchParams.get("view");
    if (
      fromQuery === "product_management" ||
      fromQuery === "ingredients" ||
      fromQuery === "movements" ||
      fromQuery === "delivery_configs" ||
      fromQuery === "delivery_prices"
    ) {
      setView(fromQuery);
      setPage(1);
    }
  }, [searchParams]);

  const endpoint =
    view === "delivery_configs" || view === "delivery_prices"
      ? "/api/backoffice/delivery-pricing"
      : view === "product_management"
        ? "/api/backoffice/catalog"
        : "/api/backoffice/stock";

  const endpointQuery: Record<string, string | number | undefined> = useMemo(() => {
    if (view === "delivery_configs") {
      return {
        view: "configs",
        page: 1,
        page_size: 50,
        reload: reloadToken
      };
    }
    if (view === "delivery_prices") {
      return {
        view: "prices",
        page,
        page_size: 10,
        search: search || undefined,
        channel: deliveryChannelFilter || undefined,
        reload: reloadToken
      };
    }
    if (view === "product_management") {
      return {
        view: "products",
        page,
        page_size: 10,
        search: search || undefined,
        reload: reloadToken
      };
    }
    const query: Record<string, string | number | undefined> = {
      view,
      page,
      page_size: 10,
      search: search || undefined,
      reload: reloadToken
    };
    if (view === "ingredients") {
      query.low_stock = lowStockOnly ? "true" : undefined;
    } else {
      query.movement_type = movementType || undefined;
    }
    return query;
  }, [deliveryChannelFilter, lowStockOnly, movementType, page, reloadToken, search, view]);

  const { loading, error, items, pagination } = usePaginatedApi<
    IngredientRow | MovementRow | DeliveryConfigRow | DeliveryPriceRow
  >(endpoint, endpointQuery);

  async function handleAdjustmentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdjusting(true);
    setAdjustError(null);
    setAdjustSuccess(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      ingredient_id: String(form.get("ingredient_id") ?? ""),
      quantity_delta: Number(form.get("quantity_delta") ?? 0),
      reason: String(form.get("reason") ?? ""),
      approval_id: String(form.get("approval_id") ?? "")
    };

    try {
      const response = await fetch("/api/backoffice/stock/adjust", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": `adj-${crypto.randomUUID()}`
        },
        body: JSON.stringify(payload)
      });
      const body = (await response.json()) as ApiEnvelope<{ id: string }>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Stock adjustment failed.");
      }
      setAdjustSuccess(`Adjustment recorded: ${body.data?.id ?? "-"}`);
      setPage(1);
      setReloadToken((current) => current + 1);
    } catch (submitError) {
      setAdjustError(submitError instanceof Error ? submitError.message : "Unknown error");
    } finally {
      setAdjusting(false);
    }
  }

  async function handleSeedDefaults() {
    setDeliverySaving(true);
    setDeliveryError(null);
    setDeliverySuccess(null);
    try {
      const response = await fetch("/api/backoffice/delivery-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed_defaults" })
      });
      const body = (await response.json()) as ApiEnvelope<{ seeded?: number }>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Seed defaults failed.");
      }
      setDeliverySuccess(`Seeded ${body.data?.seeded ?? 0} channels.`);
      setReloadToken((current) => current + 1);
    } catch (seedError) {
      setDeliveryError(seedError instanceof Error ? seedError.message : "Unknown error");
    } finally {
      setDeliverySaving(false);
    }
  }

  async function handleConfigSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeliverySaving(true);
    setDeliveryError(null);
    setDeliverySuccess(null);

    const form = new FormData(event.currentTarget);
    const orderCodeRule = String(form.get("order_code_rule") ?? "free_text") as "free_text" | "regex";
    const payload = {
      action: "upsert_config",
      channel: String(form.get("channel") ?? ""),
      commission_rate_pct: Number(form.get("commission_rate_pct") ?? 0),
      commission_vat_rate_pct: Number(form.get("commission_vat_rate_pct") ?? 7),
      order_code_rule: orderCodeRule,
      order_code_regex: orderCodeRule === "regex" ? String(form.get("order_code_regex") ?? "").trim() || null : null,
      order_code_example: String(form.get("order_code_example") ?? "").trim() || null,
      source_title: String(form.get("source_title") ?? "").trim() || null,
      source_url: String(form.get("source_url") ?? "").trim() || null,
      source_checked_at: String(form.get("source_checked_at") ?? "").trim() || null,
      is_active: String(form.get("is_active") ?? "true") === "true"
    };

    try {
      const response = await fetch("/api/backoffice/delivery-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await response.json()) as ApiEnvelope<Record<string, unknown>>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Delivery config update failed.");
      }
      setDeliverySuccess("Delivery channel config updated.");
      setReloadToken((current) => current + 1);
    } catch (submitError) {
      setDeliveryError(submitError instanceof Error ? submitError.message : "Unknown error");
    } finally {
      setDeliverySaving(false);
    }
  }

  async function handlePriceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeliverySaving(true);
    setDeliveryError(null);
    setDeliverySuccess(null);

    const form = new FormData(event.currentTarget);
    const payload = {
      action: "upsert_price",
      product_id: String(form.get("product_id") ?? ""),
      channel: String(form.get("channel") ?? ""),
      app_price: Number(form.get("app_price") ?? 0),
      is_active: String(form.get("is_active") ?? "true") === "true"
    };

    try {
      const response = await fetch("/api/backoffice/delivery-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await response.json()) as ApiEnvelope<Record<string, unknown>>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Delivery price update failed.");
      }
      setDeliverySuccess("Product delivery price updated.");
      setReloadToken((current) => current + 1);
    } catch (submitError) {
      setDeliveryError(submitError instanceof Error ? submitError.message : "Unknown error");
    } finally {
      setDeliverySaving(false);
    }
  }

  const showSearch = view === "ingredients" || view === "movements" || view === "delivery_prices";

  if (view === "product_management") {
    return (
      <section className="surface">
        <ProductManagementPanel />
      </section>
    );
  }

  return (
    <section className="surface">
      <h2>จัดการสินค้า</h2>
      <p style={{ color: "var(--muted)" }}>
        จัดการวัตถุดิบ สต๊อก และการตั้งค่าเดลิเวอรี่ในหน้าเดียว
      </p>

      <div className="grid cols-4" style={{ marginBottom: 12 }}>
        <select
          value={view}
          onChange={(event) => {
            setPage(1);
            setSearch("");
            setMovementType("");
            setDeliveryChannelFilter("");
            setView(event.target.value as StockView);
          }}
          style={{ minHeight: 42 }}
        >
          <option value="product_management">จัดการสินค้า (หลัก)</option>
          <option value="ingredients">Ingredients</option>
          <option value="movements">Stock Movements</option>
          <option value="delivery_configs">Delivery Channel Config</option>
          <option value="delivery_prices">Delivery Product Prices</option>
        </select>
        {showSearch ? (
          <input
            placeholder={
              view === "ingredients"
                ? "Search ingredient name"
                : view === "movements"
                  ? "Search reason"
                  : "Search product name / SKU"
            }
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            style={{ minHeight: 42, padding: "8px 10px" }}
          />
        ) : (
          <div />
        )}
        {view === "ingredients" ? (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(event) => {
                setPage(1);
                setLowStockOnly(event.target.checked);
              }}
            />
            Low Stock Only
          </label>
        ) : null}
        {view === "movements" ? (
          <select
            value={movementType}
            onChange={(event) => {
              setPage(1);
              setMovementType(event.target.value);
            }}
            style={{ minHeight: 42 }}
          >
            <option value="">All Movements</option>
            <option value="sale_deduction">sale_deduction</option>
            <option value="manual_adjustment">manual_adjustment</option>
            <option value="purchase">purchase</option>
            <option value="waste">waste</option>
          </select>
        ) : null}
        {view === "delivery_prices" ? (
          <select
            value={deliveryChannelFilter}
            onChange={(event) => {
              setPage(1);
              setDeliveryChannelFilter(event.target.value);
            }}
            style={{ minHeight: 42 }}
          >
            <option value="">All Channels</option>
            {DELIVERY_CHANNEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {view === "delivery_configs" ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <h3 style={{ marginBottom: 8 }}>Delivery Channel Commission Config</h3>
            <button type="button" onClick={handleSeedDefaults} disabled={deliverySaving} style={{ minHeight: 38 }}>
              {deliverySaving ? "Saving..." : "Seed Default Channels"}
            </button>
          </div>
          <form className="grid cols-4" onSubmit={handleConfigSubmit}>
            <select name="channel" required style={{ minHeight: 42 }}>
              {DELIVERY_CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input required name="commission_rate_pct" type="number" step="0.001" min={0} max={100} placeholder="Commission %" style={{ minHeight: 42, padding: "8px 10px" }} />
            <input name="commission_vat_rate_pct" type="number" step="0.001" min={0} max={100} defaultValue={7} placeholder="VAT % on Commission" style={{ minHeight: 42, padding: "8px 10px" }} />
            <select name="order_code_rule" defaultValue="regex" style={{ minHeight: 42 }}>
              <option value="free_text">free_text</option>
              <option value="regex">regex</option>
            </select>
            <input name="order_code_regex" placeholder="Order code regex (e.g. ^GF-[A-Z0-9-]+$)" style={{ minHeight: 42, padding: "8px 10px" }} />
            <input name="order_code_example" placeholder="Order code example" style={{ minHeight: 42, padding: "8px 10px" }} />
            <input name="source_title" placeholder="Source title" style={{ minHeight: 42, padding: "8px 10px" }} />
            <input name="source_url" placeholder="Source URL (official docs)" style={{ minHeight: 42, padding: "8px 10px" }} />
            <input name="source_checked_at" placeholder="Checked date (YYYY-MM-DD)" style={{ minHeight: 42, padding: "8px 10px" }} />
            <select name="is_active" defaultValue="true" style={{ minHeight: 42 }}>
              <option value="true">active</option>
              <option value="false">inactive</option>
            </select>
            <button type="submit" disabled={deliverySaving} style={{ minHeight: 42 }}>
              {deliverySaving ? "Submitting..." : "Save Channel Config"}
            </button>
          </form>
        </>
      ) : null}

      {view === "delivery_prices" ? (
        <>
          <h3 style={{ marginBottom: 8 }}>Product Delivery App Price</h3>
          <form className="grid cols-4" onSubmit={handlePriceSubmit}>
            <input required name="product_id" placeholder="product_id (uuid)" style={{ minHeight: 42, padding: "8px 10px" }} />
            <select name="channel" required style={{ minHeight: 42 }}>
              {DELIVERY_CHANNEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input required name="app_price" type="number" min={0} step="0.01" placeholder="App price" style={{ minHeight: 42, padding: "8px 10px" }} />
            <select name="is_active" defaultValue="true" style={{ minHeight: 42 }}>
              <option value="true">active</option>
              <option value="false">inactive</option>
            </select>
            <button type="submit" disabled={deliverySaving} style={{ minHeight: 42 }}>
              {deliverySaving ? "Submitting..." : "Save Product Price"}
            </button>
          </form>
        </>
      ) : null}

      {deliveryError ? <p style={{ color: "#b42318" }}>{deliveryError}</p> : null}
      {deliverySuccess ? <p style={{ color: "#067647" }}>{deliverySuccess}</p> : null}

      {loading ? <LoadingState label="Loading data..." /> : null}
      {!loading && error ? <ErrorState message={error} /> : null}
      {!loading && !error && items.length === 0 ? <EmptyState label="No records found for current filters." /> : null}

      {!loading && !error && items.length > 0 ? (
        <>
          <div style={{ overflowX: "auto" }}>
            {view === "ingredients" ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Ingredient</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Unit</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>On Hand</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Reorder Level</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {(items as IngredientRow[]).map((item) => (
                    <tr key={item.id}>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{item.name}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{item.base_unit}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                        {Number(item.quantity_on_hand).toFixed(3)}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                        {Number(item.reorder_level).toFixed(3)}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{new Date(item.updated_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {view === "movements" ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Ingredient</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Type</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Delta</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Reason</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(items as MovementRow[]).map((item) => (
                    <tr key={item.id}>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{item.ingredients?.name ?? item.ingredient_id}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{item.movement_type}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                        {Number(item.quantity_delta).toFixed(3)}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{item.reason}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{new Date(item.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {view === "delivery_configs" ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Channel</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Commission %</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>VAT %</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Order Rule</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Source</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {(items as DeliveryConfigRow[]).map((item) => (
                    <tr key={item.id ?? item.channel}>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{item.channel}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                        {Number(item.commission_rate_pct).toFixed(3)}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                        {Number(item.commission_vat_rate_pct).toFixed(3)}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        {item.order_code_rule}
                        {item.order_code_regex ? ` | ${item.order_code_regex}` : ""}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        {item.source_url ? (
                          <a href={item.source_url} target="_blank" rel="noreferrer">
                            {item.source_url}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        {item.updated_at ? new Date(item.updated_at).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {view === "delivery_prices" ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Product</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Channel</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>Store Price</th>
                    <th style={{ textAlign: "right", borderBottom: "1px solid var(--border)", padding: 8 }}>App Price</th>
                    <th style={{ textAlign: "left", borderBottom: "1px solid var(--border)", padding: 8 }}>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {(items as DeliveryPriceRow[]).map((item) => (
                    <tr key={item.id}>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>
                        {item.products?.name ?? item.product_id}
                        {item.products?.sku ? ` (${item.products.sku})` : ""}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{item.channel}</td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                        {Number(item.products?.price ?? 0).toFixed(2)}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8, textAlign: "right" }}>
                        {Number(item.app_price).toFixed(2)}
                      </td>
                      <td style={{ borderBottom: "1px solid var(--border)", padding: 8 }}>{new Date(item.updated_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
          <div style={{ marginTop: 10 }}>
            <PaginationControls page={pagination.page} totalPages={pagination.total_pages} onPageChange={setPage} />
          </div>
        </>
      ) : null}

      {view === "ingredients" || view === "movements" ? (
        <>
          <hr style={{ margin: "18px 0", borderColor: "var(--border)" }} />
          <h3 style={{ marginTop: 0 }}>Manual Stock Adjustment</h3>
          <form className="grid cols-4" onSubmit={handleAdjustmentSubmit}>
            <input required name="ingredient_id" placeholder="ingredient_id (uuid)" style={{ minHeight: 42, padding: "8px 10px" }} />
            <input required name="quantity_delta" type="number" step="0.001" placeholder="quantity_delta (e.g. -2 or 5)" style={{ minHeight: 42, padding: "8px 10px" }} />
            <input required name="reason" placeholder="reason" style={{ minHeight: 42, padding: "8px 10px" }} />
            <input required name="approval_id" placeholder="approval_id (manager/owner PIN)" style={{ minHeight: 42, padding: "8px 10px" }} />
            <button type="submit" disabled={adjusting} style={{ minHeight: 42 }}>
              {adjusting ? "Submitting..." : "Submit Adjustment"}
            </button>
          </form>
          {adjustError ? <p style={{ color: "#b42318" }}>{adjustError}</p> : null}
          {adjustSuccess ? <p style={{ color: "#067647" }}>{adjustSuccess}</p> : null}
        </>
      ) : null}
    </section>
  );
}
