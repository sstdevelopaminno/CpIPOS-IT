"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type CategoryItem = {
  name: string;
  productCount: number;
};

type IngredientItem = {
  id: string;
  name: string;
  baseUnit: string;
  quantityOnHand: number;
};

type ProductItem = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  deliveryPrice: number;
};

type RecipeLineItem = {
  ingredient_id: string;
  quantity_per_item: number;
  ingredients?: { name?: string; base_unit?: string } | Array<{ name?: string; base_unit?: string }> | null;
};

type IngredientDraftLine = {
  ingredientId: string;
  selected: boolean;
  quantity: string;
  quantityUnit: "gram" | "khid" | "kg" | "piece";
};

type Props = {
  th: boolean;
  product: ProductItem;
  categories: CategoryItem[];
  ingredients: IngredientItem[];
  deliveryRates: Array<{
    channel: "line_man" | "grab" | "shopee";
    channelLabel: string;
    commissionRatePct: number;
    commissionVatRatePct: number;
  }>;
  triggerId?: string;
  compact?: boolean;
  branchId: string;
  disabled?: boolean;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

const DEFAULT_DELIVERY_RATE_ROWS: Props["deliveryRates"] = [
  { channel: "line_man", channelLabel: "LINE MAN", commissionRatePct: 30, commissionVatRatePct: 7 },
  { channel: "grab", channelLabel: "GrabFood", commissionRatePct: 30, commissionVatRatePct: 7 },
  { channel: "shopee", channelLabel: "ShopeeFood", commissionRatePct: 30, commissionVatRatePct: 7 }
];

function calculateAutoDeliveryPrice(storePrice: number, commissionRatePct: number, commissionVatRatePct: number) {
  const commissionAmount = (storePrice * Math.max(0, commissionRatePct)) / 100;
  const vatAmount = (commissionAmount * Math.max(0, commissionVatRatePct)) / 100;
  return Number((storePrice + commissionAmount + vatAmount).toFixed(2));
}

function toDraftLinesFromRecipes(ingredients: IngredientItem[], recipes: RecipeLineItem[]) {
  const ingredientBaseUnitMap = new Map(ingredients.map((item) => [item.id, String(item.baseUnit ?? "").toLowerCase()]));
  const recipeMap = new Map<string, { quantity: number; unit: "gram" | "khid" | "kg" | "piece" }>();

  for (const line of recipes) {
    const ingredientId = String(line.ingredient_id);
    const qty = Number(line.quantity_per_item ?? 0);
    if (!ingredientId || !Number.isFinite(qty) || qty <= 0) continue;

    const ingredientBaseUnit = ingredientBaseUnitMap.get(ingredientId) ?? "";
    const isPieceBaseUnit = ingredientBaseUnit === "piece" || ingredientBaseUnit === "unit" || ingredientBaseUnit === "ลูก";

    if (isPieceBaseUnit) {
      recipeMap.set(ingredientId, { quantity: qty, unit: "piece" });
      continue;
    }

    const useKhid = Math.abs(qty / 100 - Math.round(qty / 100)) < 0.00001 && qty >= 100;
    recipeMap.set(ingredientId, {
      quantity: useKhid ? qty / 100 : qty,
      unit: useKhid ? "khid" : "gram"
    });
  }

  return ingredients.map((item) => {
    const recipe = recipeMap.get(item.id);
    if (!recipe) {
      return { ingredientId: item.id, selected: false, quantity: "", quantityUnit: "gram" as const };
    }

    return {
      ingredientId: item.id,
      selected: true,
      quantity: String(recipe.quantity),
      quantityUnit: recipe.unit
    };
  });
}

export function EditProductPopupButton({
  th,
  product,
  categories,
  ingredients,
  deliveryRates,
  triggerId,
  compact = false,
  branchId,
  disabled = false
}: Props) {
  const router = useRouter();
  const closeTimerRef = useRef<number | null>(null);
  const ingredientMap = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients]);
  const normalizedDeliveryRates = useMemo(
    () => (deliveryRates.length > 0 ? deliveryRates : DEFAULT_DELIVERY_RATE_ROWS),
    [deliveryRates]
  );
  const deliveryRateMap = useMemo(
    () => new Map(normalizedDeliveryRates.map((row) => [row.channel, row])),
    [normalizedDeliveryRates]
  );

  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [loadingRecipe, setLoadingRecipe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState("");
  const [categoryName, setCategoryName] = useState(product.category ?? "");
  const [categoryCustomMode, setCategoryCustomMode] = useState(false);
  const [categoryCustomName, setCategoryCustomName] = useState("");
  const [productName, setProductName] = useState(product.name);
  const [stockQuantity, setStockQuantity] = useState("0");
  const [storePrice, setStorePrice] = useState(String(product.price));
  const [deliveryPrice, setDeliveryPrice] = useState(String(product.deliveryPrice));
  const [autoDeliveryPricing, setAutoDeliveryPricing] = useState(false);
  const [autoDeliveryChannel, setAutoDeliveryChannel] = useState<"line_man" | "grab" | "shopee">(
    normalizedDeliveryRates[0]?.channel ?? "line_man"
  );
  const [useIngredientRecipe, setUseIngredientRecipe] = useState(true);
  const [ingredientLines, setIngredientLines] = useState<IngredientDraftLine[]>(
    ingredients.map((item) => ({
      ingredientId: item.id,
      selected: false,
      quantity: "",
      quantityUnit: "gram"
    }))
  );

  useEffect(() => {
    setCategoryName(product.category ?? "");
    setProductName(product.name);
    setStorePrice(String(product.price));
    setDeliveryPrice(String(product.deliveryPrice));
    setAutoDeliveryPricing(false);
    setAutoDeliveryChannel(normalizedDeliveryRates[0]?.channel ?? "line_man");
  }, [normalizedDeliveryRates, product.category, product.deliveryPrice, product.name, product.price]);

  useEffect(() => {
    if (!autoDeliveryPricing) return;
    const selectedRate = deliveryRateMap.get(autoDeliveryChannel);
    const price = Number(storePrice);
    if (!selectedRate || !Number.isFinite(price) || price < 0) return;
    setDeliveryPrice(String(calculateAutoDeliveryPrice(price, selectedRate.commissionRatePct, selectedRate.commissionVatRatePct)));
  }, [autoDeliveryChannel, autoDeliveryPricing, deliveryRateMap, storePrice]);

  function openPopup() {
    if (disabled) return;
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    setOpen(true);
    setErrorText("");
    setNoticeOpen(false);
    setNoticeMessage("");
    setCategoryCustomMode(false);
    setCategoryCustomName("");
    setCategoryName(product.category ?? "");
    setProductName(product.name);
    setStorePrice(String(product.price));
    setDeliveryPrice(String(product.deliveryPrice));
    setAutoDeliveryPricing(false);
    setAutoDeliveryChannel(normalizedDeliveryRates[0]?.channel ?? "line_man");
    setStockQuantity("0");
    setUseIngredientRecipe(true);
    setIngredientLines(
      ingredients.map((item) => ({
        ingredientId: item.id,
        selected: false,
        quantity: "",
        quantityUnit: "gram"
      }))
    );

    window.requestAnimationFrame(() => setVisible(true));
    void loadRecipeLines();
  }

  async function loadRecipeLines() {
    setLoadingRecipe(true);
    try {
      const response = await fetch(
        `/api/backoffice/catalog?view=recipes&page=1&page_size=300&product_id=${encodeURIComponent(product.id)}&branch_id=${encodeURIComponent(branchId)}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );

      const body = (await response.json()) as ApiEnvelope<{ items: RecipeLineItem[] }>;
      if (!response.ok || body.error || !body.data) {
        throw new Error(body.error?.message ?? (th ? "โหลดสูตรไม่สำเร็จ" : "Failed to load recipes."));
      }

      const recipeItems = body.data.items ?? [];
      const hasFallbackBridge = recipeItems.some((line) => {
        const ingredientRecord = Array.isArray(line.ingredients) ? line.ingredients[0] : line.ingredients;
        return String(ingredientRecord?.name ?? "").startsWith("STOCK:");
      });

      if (hasFallbackBridge) {
        setUseIngredientRecipe(false);
        const fallbackLine = recipeItems.find((line) => {
          const ingredientRecord = Array.isArray(line.ingredients) ? line.ingredients[0] : line.ingredients;
          return String(ingredientRecord?.name ?? "").startsWith("STOCK:");
        });
        const fallbackIngredient = fallbackLine ? ingredientMap.get(String(fallbackLine.ingredient_id)) : null;
        setStockQuantity(String(Math.max(0, Number(fallbackIngredient?.quantityOnHand ?? 0))));
        setIngredientLines(
          ingredients.map((item) => ({
            ingredientId: item.id,
            selected: false,
            quantity: "",
            quantityUnit: "gram"
          }))
        );
      } else {
        setUseIngredientRecipe(true);
        setStockQuantity("0");
        setIngredientLines(toDraftLinesFromRecipes(ingredients, recipeItems));
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : th ? "โหลดสูตรไม่สำเร็จ" : "Failed to load recipes.");
    } finally {
      setLoadingRecipe(false);
    }
  }

  function closePopup() {
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setErrorText("");
      setNoticeOpen(false);
      setNoticeMessage("");
    }, 180);
  }

  function showNotice(message: string) {
    setNoticeMessage(message);
    setNoticeOpen(true);
  }

  function toggleIngredient(ingredientId: string) {
    setIngredientLines((prev) =>
      prev.map((line) =>
        line.ingredientId === ingredientId
          ? {
              ...line,
              selected: !line.selected,
              quantity: !line.selected ? line.quantity || "1" : ""
            }
          : line
      )
    );
  }

  function updateIngredientQuantity(ingredientId: string, nextValue: string) {
    setIngredientLines((prev) => prev.map((line) => (line.ingredientId === ingredientId ? { ...line, quantity: nextValue } : line)));
  }

  function updateIngredientUnit(ingredientId: string, unit: "gram" | "khid" | "kg" | "piece") {
    setIngredientLines((prev) => prev.map((line) => (line.ingredientId === ingredientId ? { ...line, quantityUnit: unit } : line)));
  }

  async function saveProduct() {
    setErrorText("");

    const resolvedCategory = categoryCustomMode ? categoryCustomName.trim() : categoryName.trim();
    const resolvedName = productName.trim();
    const resolvedStock = Number(stockQuantity);
    const resolvedStorePrice = Number(storePrice);
    const resolvedDeliveryPrice = Number(deliveryPrice);
    const deliveryPriceByChannel = normalizedDeliveryRates.reduce(
      (acc, row) => {
        const nextPrice = autoDeliveryPricing
          ? calculateAutoDeliveryPrice(resolvedStorePrice, row.commissionRatePct, row.commissionVatRatePct)
          : resolvedDeliveryPrice;
        acc[row.channel] = Number(nextPrice.toFixed(2));
        return acc;
      },
      {} as Record<"line_man" | "grab" | "shopee", number>
    );

    if (!resolvedCategory) {
      setErrorText(th ? "กรุณาเลือกหรือกรอกหมวดหมู่" : "Please select or enter category.");
      return;
    }
    if (!resolvedName) {
      setErrorText(th ? "กรุณากรอกชื่อสินค้า" : "Please enter product name.");
      return;
    }
    if (!Number.isFinite(resolvedStorePrice) || resolvedStorePrice < 0) {
      setErrorText(th ? "ราคาหน้าร้านต้องเป็น 0 หรือมากกว่า" : "Store price must be 0 or greater.");
      return;
    }
    if (autoDeliveryPricing && !Number.isFinite(resolvedStorePrice)) {
      setErrorText(th ? "ราคาหน้าร้านไม่ถูกต้องสำหรับคำนวณอัตโนมัติ" : "Store price is invalid for auto calculation.");
      return;
    }
    if (!Number.isFinite(resolvedDeliveryPrice) || resolvedDeliveryPrice < 0) {
      setErrorText(th ? "ราคาเดลิเวอรี่ต้องเป็น 0 หรือมากกว่า" : "Delivery price must be 0 or greater.");
      return;
    }
    if (!useIngredientRecipe && (!Number.isFinite(resolvedStock) || resolvedStock < 0)) {
      setErrorText(th ? "สต๊อกต้องเป็น 0 หรือมากกว่า" : "Stock quantity must be 0 or greater.");
      return;
    }

    const selectedIngredientLines = ingredientLines
      .filter((line) => line.selected)
      .map((line) => ({
        ingredient_id: line.ingredientId,
        quantity: Number(line.quantity),
        quantity_unit: line.quantityUnit
      }))
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);

    if (useIngredientRecipe && selectedIngredientLines.length === 0) {
      setErrorText(th ? "กรุณาเลือกวัตถุดิบอย่างน้อย 1 รายการ" : "Please select at least one ingredient.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_product_with_stock_setup",
          branch_id: branchId,
          product_id: product.id,
          name: resolvedName,
          category: resolvedCategory,
          stock_quantity: useIngredientRecipe ? 0 : resolvedStock,
          store_price: resolvedStorePrice,
          delivery_price: resolvedDeliveryPrice,
          delivery_prices_by_channel: deliveryPriceByChannel,
          use_ingredient_recipe: useIngredientRecipe,
          ingredient_lines: selectedIngredientLines
        })
      });

      const body = (await response.json()) as ApiEnvelope<{ product?: { name?: string } }>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? (th ? "อัปเดตไม่สำเร็จ" : "Update failed."));
      }

      showNotice(th ? "อัปเดตสินค้าเรียบร้อยแล้ว" : "Product updated successfully.");
      router.refresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : th ? "เกิดข้อผิดพลาด" : "Unknown error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        id={triggerId}
        type="button"
        onClick={openPopup}
        aria-label={th ? "แก้ไขสินค้า" : "Edit Product"}
        title={th ? "แก้ไขสินค้า" : "Edit Product"}
        disabled={disabled}
        className={
          compact
            ? "inline-flex min-h-8 items-center rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-55"
            : "inline-flex min-h-8 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-55"
        }
      >
        {compact ? (
          <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </span>
        ) : th ? (
          "แก้ไขสินค้า"
        ) : (
          "Edit Product"
        )}
      </button>

      {open ? (
        <div
          className={`fixed inset-0 z-[145] grid place-items-center p-4 transition-all duration-200 ${
            visible ? "bg-slate-900/55 opacity-100" : "bg-slate-900/0 opacity-0"
          }`}
          onClick={closePopup}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl transition-all duration-200 lg:p-4 ${
              visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">{th ? `แก้ไขสินค้า: ${product.name}` : `Edit Product: ${product.name}`}</h3>
                <p className="text-xs text-slate-500">{th ? "อัปเดตข้อมูลสินค้า ราคา และโหมดการตัดสต๊อก" : "Update product details, delivery price, and stock deduction mode."}</p>
              </div>
              <button type="button" onClick={closePopup} className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {th ? "ปิด" : "Close"}
              </button>
            </div>

            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 lg:grid-cols-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                <span>{th ? "หมวดหมู่" : "Category"}</span>
                {!categoryCustomMode ? (
                  <select value={categoryName} onChange={(event) => {
                    const value = event.target.value;
                    if (value === "__new__") {
                      setCategoryCustomMode(true);
                      setCategoryCustomName("");
                      return;
                    }
                    setCategoryName(value);
                  }} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                    <option value="">{th ? "เลือกหมวดหมู่" : "Select category"}</option>
                    {categories.map((item) => (
                      <option key={item.name} value={item.name}>{item.name} ({item.productCount})</option>
                    ))}
                    <option value="__new__">{th ? "เพิ่มหมวดหมู่ใหม่..." : "Add new category..."}</option>
                  </select>
                ) : (
                  <input value={categoryCustomName} onChange={(event) => setCategoryCustomName(event.target.value)} placeholder={th ? "หมวดหมู่ใหม่" : "New category"} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900" />
                )}
              </label>

              <label className="grid gap-1 text-xs font-semibold text-slate-700"><span>{th ? "ชื่อสินค้า" : "Product Name"}</span><input value={productName} onChange={(event) => setProductName(event.target.value)} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900" /></label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700"><span>{th ? "ราคาหน้าร้าน" : "Store Price"}</span><input value={storePrice} onChange={(event) => setStorePrice(event.target.value)} type="number" min={0} step="0.01" className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900" /></label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                <span>{th ? "ราคาเดลิเวอรี่" : "Delivery Price"}</span>
                <div className="inline-flex w-fit max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={autoDeliveryPricing}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setAutoDeliveryPricing(checked);
                      if (!checked) return;
                      const selectedRate = deliveryRateMap.get(autoDeliveryChannel);
                      const price = Number(storePrice);
                      if (!selectedRate || !Number.isFinite(price) || price < 0) return;
                      setDeliveryPrice(
                        String(calculateAutoDeliveryPrice(price, selectedRate.commissionRatePct, selectedRate.commissionVatRatePct))
                      );
                    }}
                    className="h-3.5 w-3.5 rounded border-slate-300"
                  />
                  <span>{th ? "ให้ระบบคำนวณอัตโนมัติจากคอมมิชชั่น + VAT" : "Auto-calculate from commission + VAT"}</span>
                </div>
                {autoDeliveryPricing ? (
                  <select
                    value={autoDeliveryChannel}
                    onChange={(event) =>
                      setAutoDeliveryChannel(
                        event.target.value === "grab" ? "grab" : event.target.value === "shopee" ? "shopee" : "line_man"
                      )
                    }
                    className="min-h-10 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800"
                  >
                    {normalizedDeliveryRates.map((row) => (
                      <option key={row.channel} value={row.channel}>
                        {row.channelLabel} ({row.commissionRatePct}% + VAT {row.commissionVatRatePct}%)
                      </option>
                    ))}
                  </select>
                ) : null}
                <input
                  value={deliveryPrice}
                  onChange={(event) => setDeliveryPrice(event.target.value)}
                  type="number"
                  min={0}
                  step="0.01"
                  disabled={autoDeliveryPricing}
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                />
                {autoDeliveryPricing ? (
                  <p className="text-[11px] font-medium text-emerald-700">
                    {th
                      ? "ระบบจะคำนวณราคาเดลิเวอรี่ให้ทุกช่องทาง (LINE MAN, GrabFood, ShopeeFood) อัตโนมัติ"
                      : "Auto pricing will be applied to LINE MAN, GrabFood, and ShopeeFood."}
                  </p>
                ) : null}
              </label>

              {!useIngredientRecipe ? (
                <label className="grid gap-1 text-xs font-semibold text-slate-700"><span>{th ? "จำนวนสต๊อกแบบชิ้น" : "Unit Stock Quantity"}</span><input value={stockQuantity} onChange={(event) => setStockQuantity(event.target.value)} type="number" min={0} step="1" className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900" /></label>
              ) : null}
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 p-3">
              <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-800">
                <input type="checkbox" checked={useIngredientRecipe} onChange={(event) => setUseIngredientRecipe(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                <span>{th ? "เปิดโหมดสูตรวัตถุดิบ" : "Enable ingredient recipe mode"}</span>
              </label>

              {loadingRecipe ? <p className="mt-2 text-sm text-slate-500">{th ? "กำลังโหลดสูตร..." : "Loading recipes..."}</p> : null}

              {useIngredientRecipe ? (
                <div className="mt-3 max-h-[34vh] overflow-y-auto rounded-xl border border-slate-200">
                  <table className="w-full min-w-[620px] border-collapse">
                    <thead><tr className="bg-slate-50"><th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "เลือก" : "Select"}</th><th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "วัตถุดิบ" : "Ingredient"}</th><th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "คงเหลือ" : "On Hand"}</th><th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "ต่อ 1 ชิ้น" : "Qty per item"}</th><th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "หน่วย" : "Unit"}</th></tr></thead>
                    <tbody>
                      {ingredientLines.map((line) => {
                        const ingredient = ingredientMap.get(line.ingredientId);
                        if (!ingredient) return null;
                        return (
                          <tr key={line.ingredientId}>
                            <td className="border-b border-slate-100 px-3 py-2"><input type="checkbox" checked={line.selected} onChange={() => toggleIngredient(line.ingredientId)} className="h-4 w-4 rounded border-slate-300" /></td>
                            <td className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">{ingredient.name}</td>
                            <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-600">{ingredient.quantityOnHand} {ingredient.baseUnit}</td>
                            <td className="border-b border-slate-100 px-3 py-2"><input value={line.quantity} onChange={(event) => updateIngredientQuantity(line.ingredientId, event.target.value)} type="number" min={0} step="0.01" disabled={!line.selected} className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100" /></td>
                            <td className="border-b border-slate-100 px-3 py-2">
                              <select value={line.quantityUnit} onChange={(event) => updateIngredientUnit(line.ingredientId, event.target.value === "khid" ? "khid" : event.target.value === "kg" ? "kg" : event.target.value === "piece" ? "piece" : "gram")} disabled={!line.selected} className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100">
                                {(() => {
                                  const lineIngredient = ingredientMap.get(line.ingredientId);
                                  const baseUnit = String(lineIngredient?.baseUnit ?? "").toLowerCase();
                                  const isPiece = baseUnit === "piece" || baseUnit === "unit" || baseUnit === "ลูก";
                                  if (isPiece) return <option value="piece">{th ? "ลูก/ชิ้น" : "piece"}</option>;
                                  return (<><option value="gram">{th ? "กรัม" : "gram"}</option><option value="kg">{th ? "กิโลกรัม" : "kg"}</option><option value="khid">{th ? "ขีด" : "khid (100g)"}</option></>);
                                })()}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <p className="mt-2 text-xs text-slate-500">{th ? "โหมดนี้จะตัดสต๊อกแบบชิ้นเท่านั้น" : "This mode deducts stock by unit quantity."}</p>}
            </div>

            {errorText ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{errorText}</p> : null}
            {noticeOpen ? (
              <div className="fixed inset-0 z-[170] grid place-items-center bg-slate-900/35 p-4" onClick={() => setNoticeOpen(false)}>
                <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <h4 className="text-base font-extrabold text-emerald-700">{th ? "ดำเนินการสำเร็จ" : "Completed Successfully"}</h4>
                  <p className="mt-2 text-sm font-semibold text-slate-700">{noticeMessage}</p>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setNoticeOpen(false)}
                      className="inline-flex min-h-10 items-center rounded-lg border border-emerald-600 bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
                    >
                      {th ? "ตกลง" : "OK"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={closePopup} className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">{th ? "ยกเลิก" : "Cancel"}</button>
              <button type="button" onClick={() => void saveProduct()} disabled={saving || loadingRecipe} className="inline-flex min-h-10 items-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(37,99,235,0.24)] hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{saving ? (th ? "กำลังบันทึก..." : "Saving...") : th ? "บันทึกการเปลี่ยนแปลง" : "Save Changes"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
