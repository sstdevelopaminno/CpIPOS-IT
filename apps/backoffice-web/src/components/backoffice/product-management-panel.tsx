"use client";

import { FormEvent, ReactNode, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  sell_unit: string;
  stock_deduction_mode: "unit_only" | "recipe_deduction";
  is_active: boolean;
  updated_at: string;
};

type IngredientRow = {
  id: string;
  name: string;
  base_unit: string;
  quantity_on_hand: number;
  reorder_level: number;
  avg_unit_cost: number;
  last_purchase_unit_cost: number;
  updated_at: string;
};

type CategoryRow = {
  category: string;
  count: number;
};

type RecipeRow = {
  id: string;
  product_id: string;
  ingredient_id: string;
  quantity_per_item: number;
  applies_when_takeaway_only: boolean;
  created_at: string;
  ingredients?: { name?: string; base_unit?: string } | null;
};

type ProductCostRow = {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  stock_deduction_mode: "unit_only" | "recipe_deduction";
  sale_price: number;
  estimated_cost_per_item: number;
  estimated_gross_profit: number;
  estimated_margin_pct: number;
  ingredient_lines: number;
  missing_cost_lines: number;
  updated_at: string;
};

type ApiEnvelope<T> = {
  data?: T;
  error?: { message?: string };
};

function modeLabel(mode: ProductRow["stock_deduction_mode"]) {
  if (mode === "recipe_deduction") return "เมนูปรุง + ตัดวัตถุดิบ";
  return "ขายแบบชิ้น";
}

function money(value: number) {
  return Number(value ?? 0).toFixed(2);
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-900/45 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-lg font-extrabold text-slate-900">{props.title}</h3>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            ปิด
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

export function ProductManagementPanel() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<"" | "unit_only" | "recipe_deduction">("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionNoticeOpen, setActionNoticeOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [editingProduct, setEditingProduct] = useState<ProductRow | null>(null);
  const [editingIngredient, setEditingIngredient] = useState<IngredientRow | null>(null);
  const [restockIngredient, setRestockIngredient] = useState<IngredientRow | null>(null);

  const productQuery: Record<string, string | number | undefined> = {
    view: "products",
    page,
    page_size: 10,
    search: search || undefined,
    mode: modeFilter || undefined,
    category: categoryFilter || undefined,
    reload: reloadToken
  };

  const ingredientsQuery: Record<string, string | number | undefined> = {
    view: "ingredients",
    page: 1,
    page_size: 200,
    search: search || undefined,
    reload: reloadToken
  };

  const categoriesQuery: Record<string, string | number | undefined> = {
    view: "categories",
    page: 1,
    page_size: 200,
    reload: reloadToken
  };

  const recipesQuery: Record<string, string | number | undefined> = {
    view: "recipes",
    page: 1,
    page_size: 200,
    product_id: selectedProductId || undefined,
    reload: reloadToken
  };

  const costReportQuery: Record<string, string | number | undefined> = {
    view: "cost_report",
    page,
    page_size: 10,
    search: search || undefined,
    mode: modeFilter || undefined,
    category: categoryFilter || undefined,
    reload: reloadToken
  };

  const productsApi = usePaginatedApi<ProductRow>("/api/backoffice/catalog", productQuery);
  const ingredientsApi = usePaginatedApi<IngredientRow>("/api/backoffice/catalog", ingredientsQuery);
  const categoriesApi = usePaginatedApi<CategoryRow>("/api/backoffice/catalog", categoriesQuery);
  const recipesApi = usePaginatedApi<RecipeRow>("/api/backoffice/catalog", recipesQuery);
  const costApi = usePaginatedApi<ProductCostRow>("/api/backoffice/catalog", costReportQuery);

  const selectedProduct = useMemo(
    () => productsApi.items.find((item) => item.id === selectedProductId) ?? null,
    [productsApi.items, selectedProductId]
  );

  async function runCatalogAction(payload: Record<string, unknown>, successMessage: string, reset?: () => void) {
    setSaving(true);
    setActionError(null);
    setActionSuccess(null);
    setActionNoticeOpen(false);
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await response.json()) as ApiEnvelope<Record<string, unknown>>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Action failed.");
      }
      setActionSuccess(successMessage);
      setActionNoticeOpen(true);
      setReloadToken((current) => current + 1);
      if (reset) reset();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  function handleCreateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runCatalogAction(
      {
        action: "upsert_product",
        sku: String(form.get("sku") ?? ""),
        name: String(form.get("name") ?? ""),
        category: String(form.get("category") ?? ""),
        price: Number(form.get("price") ?? 0),
        sell_unit: String(form.get("sell_unit") ?? "ชิ้น"),
        stock_deduction_mode: String(form.get("stock_deduction_mode") ?? "unit_only"),
        is_active: true
      },
      "บันทึกสินค้าแล้ว",
      () => event.currentTarget.reset()
    );
  }

  function handleCreateIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void runCatalogAction(
      {
        action: "upsert_ingredient",
        name: String(form.get("name") ?? ""),
        base_unit: String(form.get("base_unit") ?? ""),
        quantity_on_hand: Number(form.get("quantity_on_hand") ?? 0),
        reorder_level: Number(form.get("reorder_level") ?? 0),
        avg_unit_cost: Number(form.get("avg_unit_cost") ?? 0)
      },
      "บันทึกวัตถุดิบแล้ว",
      () => event.currentTarget.reset()
    );
  }

  function handleUpdateProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProduct) return;
    const form = new FormData(event.currentTarget);
    void runCatalogAction(
      {
        action: "upsert_product",
        id: editingProduct.id,
        sku: String(form.get("sku") ?? ""),
        name: String(form.get("name") ?? ""),
        category: String(form.get("category") ?? ""),
        price: Number(form.get("price") ?? 0),
        sell_unit: String(form.get("sell_unit") ?? "ชิ้น"),
        stock_deduction_mode: String(form.get("stock_deduction_mode") ?? "unit_only"),
        is_active: String(form.get("is_active") ?? "true") === "true"
      },
      "อัปเดตสินค้าแล้ว",
      () => setEditingProduct(null)
    );
  }

  function handleUpdateIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingIngredient) return;
    const form = new FormData(event.currentTarget);
    void runCatalogAction(
      {
        action: "upsert_ingredient",
        id: editingIngredient.id,
        name: String(form.get("name") ?? ""),
        base_unit: String(form.get("base_unit") ?? ""),
        quantity_on_hand: Number(form.get("quantity_on_hand") ?? 0),
        reorder_level: Number(form.get("reorder_level") ?? 0),
        avg_unit_cost: Number(form.get("avg_unit_cost") ?? 0)
      },
      "อัปเดตวัตถุดิบแล้ว",
      () => setEditingIngredient(null)
    );
  }

  function handleRestockIngredient(event: FormEvent<HTMLFormElement>, ingredientId?: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const targetId = ingredientId ?? String(form.get("ingredient_id") ?? "");
    void runCatalogAction(
      {
        action: "add_ingredient_stock",
        ingredient_id: targetId,
        quantity_delta: Number(form.get("quantity_delta") ?? 0),
        received_total_cost: Number(form.get("received_total_cost") ?? 0),
        reason: String(form.get("reason") ?? "Purchase restock")
      },
      "เพิ่มสต๊อกวัตถุดิบแล้ว",
      () => {
        event.currentTarget.reset();
        setRestockIngredient(null);
      }
    );
  }

  function handleAddRecipeLine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProductId) {
      setActionError("กรุณาเลือกสินค้าก่อนเพิ่มสูตร");
      return;
    }
    const form = new FormData(event.currentTarget);
    void runCatalogAction(
      {
        action: "upsert_recipe_line",
        product_id: selectedProductId,
        ingredient_id: String(form.get("ingredient_id") ?? ""),
        quantity_per_item: Number(form.get("quantity_per_item") ?? 0),
        applies_when_takeaway_only: String(form.get("applies_when_takeaway_only") ?? "false") === "true"
      },
      "บันทึกสูตรแล้ว",
      () => event.currentTarget.reset()
    );
  }

  function handleDeleteRecipeLine(line: RecipeRow) {
    void runCatalogAction(
      {
        action: "delete_recipe_line",
        product_id: line.product_id,
        ingredient_id: line.ingredient_id,
        applies_when_takeaway_only: line.applies_when_takeaway_only
      },
      "ลบสูตรแล้ว"
    );
  }

  function closeActionNotice() {
    setActionNoticeOpen(false);
    setActionSuccess(null);
  }

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#f8fbff_0%,#ffffff_55%,#eff6ff_100%)] p-4">
        <h2 className="text-xl font-extrabold text-slate-900">จัดการสินค้า</h2>
        <p className="mt-1 text-sm text-slate-600">
          เชื่อมเมนูจริงและฐานข้อมูล: สินค้าแบบขายชิ้น, สินค้าแบบตัดวัตถุดิบ, วัตถุดิบ, สูตรตัดสต๊อก และรายงานต้นทุนต่อเมนู
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-4">
        <input
          value={search}
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          placeholder="ค้นหาสินค้า / SKU / หมวดหมู่"
          className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
        />
        <select
          value={modeFilter}
          onChange={(event) => {
            setPage(1);
            setModeFilter(event.target.value as "" | "unit_only" | "recipe_deduction");
          }}
          className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
        >
          <option value="">ทุกประเภท</option>
          <option value="unit_only">ขายแบบชิ้น</option>
          <option value="recipe_deduction">เมนูปรุง + ตัดวัตถุดิบ</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(event) => {
            setPage(1);
            setCategoryFilter(event.target.value);
          }}
          className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm"
        >
          <option value="">ทุกหมวดหมู่</option>
          {categoriesApi.items.map((item) => (
            <option key={item.category} value={item.category}>
              {item.category} ({item.count})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setReloadToken((current) => current + 1)}
          className="min-h-11 rounded-xl border border-sky-300 bg-sky-50 px-3 text-sm font-semibold text-sky-800"
        >
          รีเฟรชข้อมูล
        </button>
      </div>

      {actionError ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{actionError}</p> : null}
      {actionNoticeOpen && actionSuccess ? (
        <div className="fixed inset-0 z-[170] grid place-items-center bg-slate-900/35 p-4" onClick={closeActionNotice}>
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h4 className="text-base font-extrabold text-emerald-700">บันทึกข้อมูลสำเร็จ</h4>
            <p className="mt-2 text-sm font-semibold text-slate-700">{actionSuccess}</p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={closeActionNotice}
                className="inline-flex min-h-10 items-center rounded-lg border border-emerald-600 bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
              >
                ตกลง
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-lg font-extrabold text-slate-900">รายการสินค้า</h3>
            {productsApi.loading ? <LoadingState label="Loading products..." /> : null}
            {productsApi.error ? <ErrorState message={productsApi.error} /> : null}
            {!productsApi.loading && !productsApi.error && productsApi.items.length === 0 ? (
              <EmptyState label="ยังไม่มีสินค้าในสาขานี้" />
            ) : null}
            {!productsApi.loading && !productsApi.error && productsApi.items.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-[860px] w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">SKU</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">สินค้า</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">ประเภท</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">ราคา</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">หน่วย</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productsApi.items.map((item) => (
                        <tr key={item.id}>
                          <td className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">{item.sku}</td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                            <p className="text-xs text-slate-500">{item.category}</p>
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2 text-xs text-slate-700">{modeLabel(item.stock_deduction_mode)}</td>
                          <td className="border-b border-slate-100 px-3 py-2 text-right text-sm font-bold text-slate-900">฿{money(item.price)}</td>
                          <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-700">{item.sell_unit}</td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <div className="flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedProductId(item.id)}
                                className="rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
                              >
                                {selectedProductId === item.id ? "กำลังแก้สูตร" : "สูตร"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingProduct(item)}
                                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                แก้ไข
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2">
                  <PaginationControls page={productsApi.pagination.page} totalPages={productsApi.pagination.total_pages} onPageChange={setPage} />
                </div>
              </>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-lg font-extrabold text-slate-900">วัตถุดิบ</h3>
            {ingredientsApi.loading ? <LoadingState label="Loading ingredients..." /> : null}
            {ingredientsApi.error ? <ErrorState message={ingredientsApi.error} /> : null}
            {!ingredientsApi.loading && !ingredientsApi.error && ingredientsApi.items.length === 0 ? (
              <EmptyState label="ยังไม่มีวัตถุดิบในสาขานี้" />
            ) : null}
            {!ingredientsApi.loading && !ingredientsApi.error && ingredientsApi.items.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="min-w-[860px] w-full border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">วัตถุดิบ</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">คงเหลือ</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">จุดเติม</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">ต้นทุนเฉลี่ย/หน่วย</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ingredientsApi.items.slice(0, 14).map((item) => (
                      <tr key={item.id}>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                          <p className="text-xs text-slate-500">{item.base_unit}</p>
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-sm text-slate-700">
                          {Number(item.quantity_on_hand).toFixed(3)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-sm text-slate-700">
                          {Number(item.reorder_level).toFixed(3)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-sm font-semibold text-slate-900">
                          ฿{Number(item.avg_unit_cost ?? 0).toFixed(4)}
                        </td>
                        <td className="border-b border-slate-100 px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => setRestockIngredient(item)}
                              className="rounded-lg border border-emerald-200 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                            >
                              เพิ่มสต๊อก
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingIngredient(item)}
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              แก้ไข
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <h3 className="text-base font-extrabold text-slate-900">เพิ่มสินค้าใหม่</h3>
            <form onSubmit={handleCreateProduct} className="mt-2 grid gap-2">
              <input required name="sku" placeholder="SKU (เช่น P001)" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <input required name="name" placeholder="ชื่อสินค้า" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <input required name="category" placeholder="หมวดหมู่" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <input required name="price" type="number" min={0} step="0.01" placeholder="ราคา" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <input name="sell_unit" defaultValue="ชิ้น" placeholder="หน่วยขาย" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <select name="stock_deduction_mode" defaultValue="unit_only" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm">
                <option value="unit_only">ประเภท 1: ขายแบบชิ้น</option>
                <option value="recipe_deduction">ประเภท 2: ตัดวัตถุดิบ (ต้องมีสูตรก่อน)</option>
              </select>
              <button type="submit" disabled={saving} className="min-h-10 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700">
                {saving ? "กำลังบันทึก..." : "บันทึกสินค้า"}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <h3 className="text-base font-extrabold text-slate-900">เพิ่มวัตถุดิบ</h3>
            <form onSubmit={handleCreateIngredient} className="mt-2 grid gap-2">
              <input required name="name" placeholder="ชื่อวัตถุดิบ" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <input required name="base_unit" placeholder="หน่วยหลัก (g, kg, ml, ชิ้น)" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <input name="quantity_on_hand" type="number" min={0} step="0.001" defaultValue={0} placeholder="คงเหลือเริ่มต้น" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <input name="reorder_level" type="number" min={0} step="0.001" defaultValue={0} placeholder="จุดเติมขั้นต่ำ" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <input name="avg_unit_cost" type="number" min={0} step="0.0001" defaultValue={0} placeholder="ต้นทุนเฉลี่ยต่อหน่วย" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <button type="submit" disabled={saving} className="min-h-10 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700">
                {saving ? "กำลังบันทึก..." : "บันทึกวัตถุดิบ"}
              </button>
            </form>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-3">
            <h3 className="text-base font-extrabold text-slate-900">
              สูตรตัดวัตถุดิบ: {selectedProduct ? `${selectedProduct.name} (${selectedProduct.sku})` : "ยังไม่ได้เลือกสินค้า"}
            </h3>
            <form onSubmit={handleAddRecipeLine} className="mt-2 grid gap-2">
              <select required name="ingredient_id" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm">
                <option value="">เลือกวัตถุดิบ</option>
                {ingredientsApi.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.base_unit})
                  </option>
                ))}
              </select>
              <input required name="quantity_per_item" type="number" min={0.001} step="0.001" placeholder="ใช้ต่อ 1 รายการ" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
              <select name="applies_when_takeaway_only" defaultValue="false" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm">
                <option value="false">ใช้ทุกโหมดขาย</option>
                <option value="true">ใช้เฉพาะกลับบ้าน/เดลิเวอรี่</option>
              </select>
              <button
                type="submit"
                disabled={saving || !selectedProductId}
                className="min-h-10 rounded-lg bg-indigo-600 px-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "กำลังบันทึก..." : "เพิ่มสูตร"}
              </button>
            </form>

            <div className="mt-3">
              {selectedProductId && recipesApi.loading ? <LoadingState label="Loading recipe lines..." /> : null}
              {selectedProductId && recipesApi.error ? <ErrorState message={recipesApi.error} /> : null}
              {selectedProductId && !recipesApi.loading && !recipesApi.error && recipesApi.items.length === 0 ? (
                <EmptyState label="ยังไม่มีสูตรของสินค้านี้" />
              ) : null}
              {selectedProductId && !recipesApi.loading && !recipesApi.error && recipesApi.items.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-[520px] w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">วัตถุดิบ</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">ต่อ 1 รายการ</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">เงื่อนไข</th>
                        <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recipesApi.items.map((line) => (
                        <tr key={line.id}>
                          <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-700">
                            {line.ingredients?.name ?? line.ingredient_id} ({line.ingredients?.base_unit ?? "-"})
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2 text-right text-sm text-slate-700">
                            {Number(line.quantity_per_item).toFixed(3)}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-700">
                            {line.applies_when_takeaway_only ? "เฉพาะกลับบ้าน/เดลิเวอรี่" : "ทุกโหมดขาย"}
                          </td>
                          <td className="border-b border-slate-100 px-3 py-2">
                            <button
                              type="button"
                              onClick={() => handleDeleteRecipeLine(line)}
                              disabled={saving}
                              className="rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                            >
                              ลบ
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <h3 className="mb-2 text-lg font-extrabold text-slate-900">รายงานต้นทุนต่อเมนู (Cost Report)</h3>
        <p className="mb-2 text-sm text-slate-600">
          ต้นทุนคำนวณจากสูตรวัตถุดิบ x ต้นทุนเฉลี่ยต่อหน่วยของวัตถุดิบ (avg unit cost) เพื่อดู margin โดยประมาณ
        </p>
        {costApi.loading ? <LoadingState label="Loading cost report..." /> : null}
        {costApi.error ? <ErrorState message={costApi.error} /> : null}
        {!costApi.loading && !costApi.error && costApi.items.length === 0 ? <EmptyState label="ยังไม่มีข้อมูลสำหรับรายงานต้นทุน" /> : null}
        {!costApi.loading && !costApi.error && costApi.items.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="min-w-[980px] w-full border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">สินค้า</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">โหมด</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">ราคาขาย</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">ต้นทุน/ชิ้น</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">กำไรขั้นต้น</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">Margin %</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">สูตร</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">สูตรไม่มีต้นทุน</th>
                </tr>
              </thead>
              <tbody>
                {costApi.items.map((item) => (
                  <tr key={item.product_id}>
                    <td className="border-b border-slate-100 px-3 py-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {item.name} ({item.sku})
                      </p>
                      <p className="text-xs text-slate-500">{item.category}</p>
                    </td>
                    <td className="border-b border-slate-100 px-3 py-2 text-xs text-slate-700">{modeLabel(item.stock_deduction_mode)}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right text-sm font-semibold text-slate-900">฿{money(item.sale_price)}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right text-sm text-slate-700">฿{money(item.estimated_cost_per_item)}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right text-sm font-semibold text-slate-900">฿{money(item.estimated_gross_profit)}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right text-sm font-semibold text-slate-900">{Number(item.estimated_margin_pct).toFixed(2)}%</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right text-sm text-slate-700">{item.ingredient_lines}</td>
                    <td className="border-b border-slate-100 px-3 py-2 text-right text-sm">
                      {item.missing_cost_lines > 0 ? (
                        <span className="font-semibold text-amber-700">{item.missing_cost_lines}</span>
                      ) : (
                        <span className="text-emerald-700">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {editingProduct ? (
        <Modal title={`แก้ไขสินค้า: ${editingProduct.name}`} onClose={() => setEditingProduct(null)}>
          <form onSubmit={handleUpdateProduct} className="grid gap-2 md:grid-cols-2">
            <input required name="sku" defaultValue={editingProduct.sku} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input required name="name" defaultValue={editingProduct.name} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input required name="category" defaultValue={editingProduct.category} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input required name="price" type="number" min={0} step="0.01" defaultValue={editingProduct.price} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input name="sell_unit" defaultValue={editingProduct.sell_unit} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <select name="stock_deduction_mode" defaultValue={editingProduct.stock_deduction_mode} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm">
              <option value="unit_only">ประเภท 1: ขายแบบชิ้น</option>
              <option value="recipe_deduction">ประเภท 2: ตัดวัตถุดิบ (ต้องมีสูตรแล้ว)</option>
            </select>
            <select name="is_active" defaultValue={editingProduct.is_active ? "true" : "false"} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm">
              <option value="true">active</option>
              <option value="false">inactive</option>
            </select>
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                {saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editingIngredient ? (
        <Modal title={`แก้ไขวัตถุดิบ: ${editingIngredient.name}`} onClose={() => setEditingIngredient(null)}>
          <form onSubmit={handleUpdateIngredient} className="grid gap-2 md:grid-cols-2">
            <input required name="name" defaultValue={editingIngredient.name} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input required name="base_unit" defaultValue={editingIngredient.base_unit} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input
              name="quantity_on_hand"
              type="number"
              min={0}
              step="0.001"
              defaultValue={editingIngredient.quantity_on_hand}
              className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm"
            />
            <input
              name="reorder_level"
              type="number"
              min={0}
              step="0.001"
              defaultValue={editingIngredient.reorder_level}
              className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm"
            />
            <input
              name="avg_unit_cost"
              type="number"
              min={0}
              step="0.0001"
              defaultValue={editingIngredient.avg_unit_cost}
              className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm"
            />
            <div className="min-h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Last purchase cost: ฿{Number(editingIngredient.last_purchase_unit_cost ?? 0).toFixed(4)}
            </div>
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                {saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {restockIngredient ? (
        <Modal title={`เพิ่มสต๊อก: ${restockIngredient.name}`} onClose={() => setRestockIngredient(null)}>
          <form onSubmit={(event) => handleRestockIngredient(event, restockIngredient.id)} className="grid gap-2 md:grid-cols-2">
            <div className="min-h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              คงเหลือปัจจุบัน: {Number(restockIngredient.quantity_on_hand).toFixed(3)} {restockIngredient.base_unit}
            </div>
            <div className="min-h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              ต้นทุนเฉลี่ยปัจจุบัน: ฿{Number(restockIngredient.avg_unit_cost ?? 0).toFixed(4)}
            </div>
            <input required name="quantity_delta" type="number" min={0.001} step="0.001" placeholder="จำนวนที่รับเข้า" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm" />
            <input
              name="received_total_cost"
              type="number"
              min={0}
              step="0.01"
              defaultValue={0}
              placeholder="มูลค่าที่ซื้อรวม (บาท)"
              className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm"
            />
            <input name="reason" defaultValue="Purchase restock" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm md:col-span-2" />
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                {saving ? "กำลังบันทึก..." : "ยืนยันเพิ่มสต๊อก"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
