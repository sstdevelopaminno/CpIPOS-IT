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

type IngredientDraftLine = {
  ingredientId: string;
  selected: boolean;
  quantity: string;
  quantityUnit: "gram" | "khid" | "kg" | "piece";
};

type DeliveryRate = {
  channel: "line_man" | "grab" | "shopee";
  channelLabel: string;
  commissionRatePct: number;
  commissionVatRatePct: number;
};

type Props = {
  th: boolean;
  categories: CategoryItem[];
  ingredients: IngredientItem[];
  deliveryRates: DeliveryRate[];
  branchId: string;
  disabled?: boolean;
  buttonLabel?: string;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type PopupTab = "product" | "ingredient" | "bulk";
type BulkMode = "products" | "ingredients";
type PurchaseUnit = "gram" | "kg" | "khid" | "bag" | "piece";

const DEFAULT_DELIVERY_RATE_ROWS: DeliveryRate[] = [
  { channel: "line_man", channelLabel: "LINE MAN", commissionRatePct: 30, commissionVatRatePct: 7 },
  { channel: "grab", channelLabel: "GrabFood", commissionRatePct: 30, commissionVatRatePct: 7 },
  { channel: "shopee", channelLabel: "ShopeeFood", commissionRatePct: 30, commissionVatRatePct: 7 }
];

const PRODUCT_FORM_CONTROL_CLASS =
  "h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-base leading-5 text-slate-900 outline-none ring-blue-200 focus:ring-2";
const PRODUCT_FORM_NUMBER_CLASS = `${PRODUCT_FORM_CONTROL_CLASS} tabular-nums`;

const CATEGORY_FALLBACK_EVENT = "pos-product-categories-updated";

function categoryStorageKey(branchId: string) {
  return `pos_product_categories_v1:${branchId}`;
}

function readStoredCategoryNames(branchId: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(categoryStorageKey(branchId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function writeStoredCategoryNames(branchId: string, names: string[]) {
  if (typeof window === "undefined") return;
  const uniqueNames = Array.from(new Set(names.map((item) => item.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  window.localStorage.setItem(categoryStorageKey(branchId), JSON.stringify(uniqueNames));
  window.dispatchEvent(new CustomEvent(CATEGORY_FALLBACK_EVENT, { detail: { branchId, names: uniqueNames } }));
}

function mergeCategoryItems(categories: CategoryItem[], names: string[], locale: "th" | "en") {
  const merged = [...categories];
  for (const name of names) {
    if (merged.some((item) => item.name.trim().toLowerCase() === name.trim().toLowerCase())) continue;
    merged.push({ name, productCount: 0 });
  }
  return merged.sort((a, b) => a.name.localeCompare(b.name, locale));
}

function calculateAutoDeliveryPrice(storePrice: number, commissionRatePct: number, commissionVatRatePct: number) {
  const commissionAmount = (storePrice * Math.max(0, commissionRatePct)) / 100;
  const vatAmount = (commissionAmount * Math.max(0, commissionVatRatePct)) / 100;
  return Number((storePrice + commissionAmount + vatAmount).toFixed(2));
}

function normalizeIngredientBaseUnit(value: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["gram", "g", "กรัม"].includes(normalized)) return "gram";
  if (["kg", "กิโลกรัม"].includes(normalized)) return "kg";
  if (["khid", "ขีด"].includes(normalized)) return "khid";
  if (["bag", "ถุง"].includes(normalized)) return "bag";
  if (normalized === "ลูก") return "ลูก";
  if (["piece", "unit", "ชิ้น"].includes(normalized)) return "ชิ้น";
  return "gram";
}

function isPieceBaseUnit(baseUnit: string) {
  const normalized = baseUnit.trim().toLowerCase();
  return normalized === "piece" || normalized === "unit" || normalized === "ลูก";
}

export function AddProductPopupButton({
  th,
  categories,
  ingredients,
  deliveryRates,
  branchId,
  disabled = false,
  buttonLabel
}: Props) {
  const router = useRouter();
  const closeTimerRef = useRef<number | null>(null);

  const normalizedDeliveryRates = useMemo(
    () => (deliveryRates.length > 0 ? deliveryRates : DEFAULT_DELIVERY_RATE_ROWS),
    [deliveryRates]
  );
  const deliveryRateMap = useMemo(
    () => new Map(normalizedDeliveryRates.map((row) => [row.channel, row])),
    [normalizedDeliveryRates]
  );
  const ingredientMap = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients]);
  const sortedIngredients = useMemo(
    () =>
      [...ingredients].sort((a, b) =>
        a.name.localeCompare(b.name, th ? "th" : "en", {
          sensitivity: "base"
        })
      ),
    [ingredients, th]
  );

  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState("");
  const [activeTab, setActiveTab] = useState<PopupTab>("product");
  const [bulkMode, setBulkMode] = useState<BulkMode>("products");
  const [localCategories, setLocalCategories] = useState<CategoryItem[]>(categories);

  const [categoryName, setCategoryName] = useState("");
  const [categoryCustomMode, setCategoryCustomMode] = useState(false);
  const [categoryCustomName, setCategoryCustomName] = useState("");
  const [categoryCreating, setCategoryCreating] = useState(false);
  const [productName, setProductName] = useState("");
  const [stockQuantity, setStockQuantity] = useState("0");
  const [storePrice, setStorePrice] = useState("0");
  const [deliveryPrice, setDeliveryPrice] = useState("0");
  const [autoDeliveryPricing, setAutoDeliveryPricing] = useState(false);
  const [autoDeliveryChannel, setAutoDeliveryChannel] = useState<"line_man" | "grab" | "shopee">(
    normalizedDeliveryRates[0]?.channel ?? "line_man"
  );
  const [useIngredientRecipe, setUseIngredientRecipe] = useState(false);
  const [ingredientLines, setIngredientLines] = useState<IngredientDraftLine[]>(
    ingredients.map((item) => ({
      ingredientId: item.id,
      selected: false,
      quantity: "",
      quantityUnit: "gram"
    }))
  );

  const [ingredientName, setIngredientName] = useState(sortedIngredients[0]?.name ?? "");
  const [purchaseQuantity, setPurchaseQuantity] = useState("1");
  const [purchaseUnit, setPurchaseUnit] = useState<PurchaseUnit>("gram");
  const [weightPerBagInGrams, setWeightPerBagInGrams] = useState("1000");
  const [receivedTotalCost, setReceivedTotalCost] = useState("");
  const [reason, setReason] = useState("");

  const [bulkProductCsvText, setBulkProductCsvText] = useState("");
  const [bulkIngredientCsvText, setBulkIngredientCsvText] = useState("");

  const selectedIngredient = useMemo(() => {
    const normalizedName = ingredientName.trim().toLowerCase();
    if (!normalizedName) return null;
    return sortedIngredients.find((item) => item.name.trim().toLowerCase() === normalizedName) ?? null;
  }, [ingredientName, sortedIngredients]);
  const selectedIngredientId = selectedIngredient?.id ?? "";
  const selectedIsPiece = isPieceBaseUnit(selectedIngredient?.baseUnit ?? "");

  useEffect(() => {
    setLocalCategories(mergeCategoryItems(categories, readStoredCategoryNames(branchId), th ? "th" : "en"));
  }, [branchId, categories, th]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onCategoriesUpdated(event: Event) {
      const detail = (event as CustomEvent<{ branchId?: string; names?: string[] }>).detail;
      if (detail?.branchId !== branchId) return;
      setLocalCategories(mergeCategoryItems(categories, detail.names ?? readStoredCategoryNames(branchId), th ? "th" : "en"));
    }
    window.addEventListener(CATEGORY_FALLBACK_EVENT, onCategoriesUpdated);
    return () => window.removeEventListener(CATEGORY_FALLBACK_EVENT, onCategoriesUpdated);
  }, [branchId, categories, th]);

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
    setActiveTab("product");
    window.requestAnimationFrame(() => setVisible(true));
  }

  function closePopup() {
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setSaving(false);
      setErrorText("");
      setNoticeOpen(false);
      setNoticeMessage("");
    }, 180);
  }

  function showNotice(message: string) {
    setNoticeMessage(message);
    setNoticeOpen(true);
  }

  function resetProductFormAfterSuccess() {
    setProductName("");
    setStockQuantity("0");
    setStorePrice("0");
    setDeliveryPrice("0");
    setAutoDeliveryPricing(false);
    setAutoDeliveryChannel(normalizedDeliveryRates[0]?.channel ?? "line_man");
    setUseIngredientRecipe(false);
    setCategoryCustomMode(false);
    setCategoryCustomName("");
    setIngredientLines((prev) =>
      prev.map((line) => ({
        ...line,
        selected: false,
        quantity: "",
        quantityUnit: "gram"
      }))
    );
  }

  function resetIngredientRestockFormAfterSuccess() {
    setPurchaseQuantity("1");
    setPurchaseUnit(selectedIsPiece ? "piece" : "gram");
    setWeightPerBagInGrams("1000");
    setReceivedTotalCost("");
    setReason("");
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
    setIngredientLines((prev) =>
      prev.map((line) =>
        line.ingredientId === ingredientId
          ? {
              ...line,
              quantity: nextValue
            }
          : line
      )
    );
  }

  function updateIngredientUnit(ingredientId: string, unit: "gram" | "khid" | "kg" | "piece") {
    setIngredientLines((prev) =>
      prev.map((line) =>
        line.ingredientId === ingredientId
          ? {
              ...line,
              quantityUnit: unit
            }
          : line
      )
    );
  }

  async function createCategoryFromProductForm() {
    const value = categoryCustomName.trim();
    if (!value) {
      setErrorText(th ? "กรุณากรอกชื่อหมวดหมู่" : "Please enter category name.");
      return;
    }
    const duplicated = localCategories.some((item) => item.name.trim().toLowerCase() === value.toLowerCase());
    if (duplicated) {
      setCategoryName(localCategories.find((item) => item.name.trim().toLowerCase() === value.toLowerCase())?.name ?? value);
      setCategoryCustomMode(false);
      setCategoryCustomName("");
      setErrorText("");
      return;
    }

    setCategoryCreating(true);
    setErrorText("");
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_category",
          name: value
        })
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ category?: { name: string; productCount?: number } }> | null;
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? "Create category failed.");
      }
      const nextCategory = body?.data?.category?.name?.trim() || value;
      writeStoredCategoryNames(branchId, [...readStoredCategoryNames(branchId), nextCategory]);
      setLocalCategories((prev) =>
        prev.some((item) => item.name.trim().toLowerCase() === nextCategory.toLowerCase())
          ? prev
          : [...prev, { name: nextCategory, productCount: Number(body?.data?.category?.productCount ?? 0) }].sort((a, b) =>
              a.name.localeCompare(b.name, th ? "th" : "en")
            )
      );
      setCategoryName(nextCategory);
      setCategoryCustomMode(false);
      setCategoryCustomName("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : th ? "เพิ่มหมวดหมู่ไม่สำเร็จ" : "Failed to add category.");
    } finally {
      setCategoryCreating(false);
    }
  }

  async function submitProduct() {
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
    if (!Number.isFinite(resolvedStock) || resolvedStock < 0) {
      setErrorText(th ? "จำนวนสินค้าต้องเป็น 0 หรือมากกว่า" : "Stock quantity must be 0 or greater.");
      return;
    }
    if (!Number.isFinite(resolvedStorePrice) || resolvedStorePrice < 0) {
      setErrorText(th ? "ราคาหน้าร้านต้องเป็น 0 หรือมากกว่า" : "Store price must be 0 or greater.");
      return;
    }
    if (!Number.isFinite(resolvedDeliveryPrice) || resolvedDeliveryPrice < 0) {
      setErrorText(th ? "ราคาเดลิเวอรี่ต้องเป็น 0 หรือมากกว่า" : "Delivery price must be 0 or greater.");
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
      setErrorText(th ? "กรุณาเลือกวัตถุดิบอย่างน้อย 1 รายการ" : "Please select at least one ingredient line.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_product_with_stock_setup",
          name: resolvedName,
          category: resolvedCategory,
          stock_quantity: resolvedStock,
          store_price: resolvedStorePrice,
          delivery_price: resolvedDeliveryPrice,
          delivery_prices_by_channel: deliveryPriceByChannel,
          use_ingredient_recipe: useIngredientRecipe,
          ingredient_lines: selectedIngredientLines
        })
      });

      const body = (await response.json()) as ApiEnvelope<{ product?: { name?: string } }>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Request failed.");
      }

      showNotice(th ? "เพิ่มสินค้าและตั้งค่าการตัดสต๊อกเรียบร้อยแล้ว" : "Product created and stock deduction setup completed.");
      resetProductFormAfterSuccess();
      router.refresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Unknown error.");
    } finally {
      setSaving(false);
    }
  }

  async function submitIngredientRestock() {
    setErrorText("");
    const qty = Number(purchaseQuantity);
    const bagWeight = Number(weightPerBagInGrams);
    const totalCost = receivedTotalCost.trim() === "" ? 0 : Number(receivedTotalCost);
    const unit = selectedIsPiece ? "piece" : purchaseUnit;

    if (!ingredientName.trim()) {
      setErrorText(th ? "กรุณากรอกชื่อวัตถุดิบ" : "Please enter ingredient name.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setErrorText(th ? "จำนวนต้องมากกว่า 0" : "Quantity must be greater than 0.");
      return;
    }
    if (unit === "bag" && (!Number.isFinite(bagWeight) || bagWeight <= 0)) {
      setErrorText(th ? "กรอกน้ำหนักต่อถุง (กรัม) ให้ถูกต้อง" : "Weight per bag must be greater than 0.");
      return;
    }
    if (!Number.isFinite(totalCost) || totalCost < 0) {
      setErrorText(th ? "ต้นทุนรวมต้องเป็น 0 หรือมากกว่า" : "Total cost must be 0 or greater.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_ingredient_stock",
          ingredient_id: selectedIngredientId || undefined,
          ingredient_name: ingredientName.trim(),
          purchase_quantity: qty,
          purchase_unit: unit,
          weight_per_bag_in_grams: unit === "bag" ? bagWeight : undefined,
          received_total_cost: totalCost,
          reason: reason.trim() || (th ? "เติมสต๊อกจากการรับเข้า" : "Purchase restock")
        })
      });

      const body = (await response.json()) as ApiEnvelope<{ id: string }>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Request failed.");
      }

      showNotice(th ? "เติมสต๊อกเรียบร้อยแล้ว" : "Stock restocked successfully.");
      resetIngredientRestockFormAfterSuccess();
      router.refresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Unknown error.");
    } finally {
      setSaving(false);
    }
  }

  async function submitBulkImport() {
    setErrorText("");
    setSaving(true);
    try {
      if (bulkMode === "products") {
        const lines = bulkProductCsvText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length === 0) {
          throw new Error(th ? "กรุณากรอกข้อมูลสินค้าก่อนนำเข้า" : "Please provide product rows before importing.");
        }

        let successCount = 0;
        const failures: string[] = [];
        const defaultCategory = localCategories[0]?.name ?? (th ? "ไม่ระบุหมวดหมู่" : "Uncategorized");

        for (const line of lines) {
          const [name, category, stock, store, delivery] = line.split(",").map((part) => part.trim());
          const resolvedName = name ?? "";
          if (!resolvedName) {
            failures.push(th ? "พบแถวชื่อสินค้าว่าง" : "Found a row with empty product name.");
            continue;
          }
          const resolvedStorePrice = Number(store || 0);
          const resolvedDeliveryPrice = Number(delivery || resolvedStorePrice || 0);
          const resolvedStock = Number(stock || 0);
          const response = await fetch("/api/backoffice/catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "create_product_with_stock_setup",
              name: resolvedName,
              category: category || defaultCategory,
              stock_quantity: Number.isFinite(resolvedStock) ? Math.max(0, resolvedStock) : 0,
              store_price: Number.isFinite(resolvedStorePrice) ? Math.max(0, resolvedStorePrice) : 0,
              delivery_price: Number.isFinite(resolvedDeliveryPrice) ? Math.max(0, resolvedDeliveryPrice) : 0,
              use_ingredient_recipe: false,
              ingredient_lines: []
            })
          });
          const body = (await response.json()) as ApiEnvelope<unknown>;
          if (!response.ok || body.error) {
            failures.push(`${resolvedName}: ${body.error?.message ?? "Failed"}`);
            continue;
          }
          successCount += 1;
        }

        if (successCount > 0) {
          showNotice(
            th
              ? `นำเข้าสินค้าสำเร็จ ${successCount} รายการ${failures.length > 0 ? `, ไม่สำเร็จ ${failures.length}` : ""}`
              : `Imported ${successCount} products${failures.length > 0 ? `, failed ${failures.length}` : ""}.`
          );
          setBulkProductCsvText("");
          router.refresh();
        }
        if (failures.length > 0) {
          setErrorText(failures.slice(0, 5).join("\n"));
        }
      } else {
        const lines = bulkIngredientCsvText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length === 0) {
          throw new Error(th ? "กรุณากรอกข้อมูลวัตถุดิบก่อนนำเข้า" : "Please provide ingredient rows before importing.");
        }

        let successCount = 0;
        const failures: string[] = [];
        for (const line of lines) {
          const [name, unit, qty, reorder] = line.split(",").map((part) => part.trim());
          const resolvedName = name ?? "";
          if (!resolvedName) {
            failures.push(th ? "พบแถวชื่อวัตถุดิบว่าง" : "Found a row with empty ingredient name.");
            continue;
          }
          const response = await fetch("/api/backoffice/catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "upsert_ingredient",
              name: resolvedName,
              base_unit: normalizeIngredientBaseUnit(unit || "gram"),
              quantity_on_hand: Math.max(0, Number(qty || 0)),
              reorder_level: Math.max(0, Number(reorder || 0))
            })
          });
          const body = (await response.json()) as ApiEnvelope<unknown>;
          if (!response.ok || body.error) {
            failures.push(`${resolvedName}: ${body.error?.message ?? "Failed"}`);
            continue;
          }
          successCount += 1;
        }

        if (successCount > 0) {
          showNotice(
            th
              ? `นำเข้าวัตถุดิบสำเร็จ ${successCount} รายการ${failures.length > 0 ? `, ไม่สำเร็จ ${failures.length}` : ""}`
              : `Imported ${successCount} ingredients${failures.length > 0 ? `, failed ${failures.length}` : ""}.`
          );
          setBulkIngredientCsvText("");
          router.refresh();
        }
        if (failures.length > 0) {
          setErrorText(failures.slice(0, 5).join("\n"));
        }
      }
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : (th ? "นำเข้าไม่สำเร็จ" : "Bulk import failed."));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitByTab() {
    if (activeTab === "product") {
      await submitProduct();
      return;
    }
    if (activeTab === "ingredient") {
      await submitIngredientRestock();
      return;
    }
    await submitBulkImport();
  }

  return (
    <>
      <button
        type="button"
        onClick={openPopup}
        disabled={disabled}
        className="inline-flex min-h-10 items-center rounded-xl border border-blue-600 bg-blue-600 px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(37,99,235,0.24)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {buttonLabel ?? (th ? "เพิ่มสินค้า" : "Add Product")}
      </button>

      {open ? (
        <div
          className={`fixed inset-0 z-[140] grid place-items-center p-4 transition-all duration-200 ${
            visible ? "bg-slate-900/55 opacity-100" : "bg-slate-900/0 opacity-0"
          }`}
          onClick={closePopup}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl transition-all duration-200 ${
              visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">{th ? "จัดการสินค้าและสต๊อก" : "Manage Catalog & Stock"}</h3>
                <p className="text-xs text-slate-500">
                  {th ? "สลับแท็บเพื่อเพิ่มสินค้า เพิ่มวัตถุดิบ และนำเข้าหลายรายการในหน้าต่างเดียว" : "Switch tabs to add product, restock ingredients, and bulk import in one popup."}
                </p>
              </div>
              <button
                type="button"
                onClick={closePopup}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ปิด" : "Close"}
              </button>
            </div>

            <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-2">
              <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("product");
                  setErrorText("");
                }}
                className={`inline-flex min-h-10 items-center rounded-xl border px-4 text-sm font-bold transition ${
                  activeTab === "product"
                    ? "border-blue-600 bg-blue-600 text-white shadow-[0_8px_18px_rgba(37,99,235,0.24)]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                }`}
              >
                {th ? "เพิ่มสินค้า" : "Add Product"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("ingredient");
                  setErrorText("");
                }}
                className={`inline-flex min-h-10 items-center rounded-xl border px-4 text-sm font-bold transition ${
                  activeTab === "ingredient"
                    ? "border-sky-600 bg-sky-600 text-white shadow-[0_8px_18px_rgba(2,132,199,0.24)]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                }`}
              >
                {th ? "เพิ่มวัตถุดิบ" : "Add Ingredient"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("bulk");
                  setErrorText("");
                }}
                className={`inline-flex min-h-10 items-center rounded-xl border px-4 text-sm font-bold transition ${
                  activeTab === "bulk"
                    ? "border-indigo-600 bg-indigo-600 text-white shadow-[0_8px_18px_rgba(79,70,229,0.24)]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                }`}
              >
                {th ? "นำเข้าหลายรายการ" : "Bulk Import"}
              </button>
            </div>
            </div>

            {activeTab === "product" && (
              <>
                <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 lg:grid-cols-3">
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>{th ? "1. หมวดหมู่" : "1. Category"}</span>
                    {!categoryCustomMode ? (
                      <select
                        value={categoryName}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "__new__") {
                            setCategoryCustomMode(true);
                            setCategoryCustomName("");
                            setCategoryName("");
                            return;
                          }
                          setCategoryName(value);
                        }}
                        className={PRODUCT_FORM_CONTROL_CLASS}
                      >
                        <option value="">{th ? "เลือกหมวดหมู่" : "Select category"}</option>
                        {localCategories.map((item) => (
                          <option key={item.name} value={item.name}>
                            {item.name} ({item.productCount})
                          </option>
                        ))}
                        <option value="__new__">{th ? "เพิ่มหมวดหมู่ใหม่..." : "Add new category..."}</option>
                      </select>
                    ) : (
                      <div className="grid gap-1">
                        <input
                          value={categoryCustomName}
                          onChange={(event) => setCategoryCustomName(event.target.value)}
                          disabled={categoryCreating}
                          placeholder={th ? "ชื่อหมวดหมู่ใหม่" : "New category name"}
                          className={PRODUCT_FORM_CONTROL_CLASS}
                        />
                        <button
                          type="button"
                          onClick={() => void createCategoryFromProductForm()}
                          disabled={categoryCreating}
                          className="justify-self-start rounded-lg border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {categoryCreating ? "..." : th ? "บันทึกหมวดหมู่" : "Save category"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCategoryCustomMode(false);
                            setCategoryCustomName("");
                          }}
                          className="justify-self-start rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          {th ? "กลับไปเลือกรายการ" : "Back to list"}
                        </button>
                      </div>
                    )}
                  </label>

                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>{th ? "2. ชื่อสินค้า" : "2. Product Name"}</span>
                    <input
                      value={productName}
                      onChange={(event) => setProductName(event.target.value)}
                      placeholder={th ? "เช่น ชาไทยพรีเมียม" : "e.g. Thai Tea Premium"}
                      className={PRODUCT_FORM_CONTROL_CLASS}
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>{th ? "3. จำนวนสินค้า" : "3. Stock Quantity"}</span>
                    <input
                      value={stockQuantity}
                      onChange={(event) => setStockQuantity(event.target.value)}
                      type="number"
                      min={0}
                      step="1"
                      className={PRODUCT_FORM_NUMBER_CLASS}
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>{th ? "4. ราคาหน้าร้าน" : "4. Store Price"}</span>
                    <input
                      value={storePrice}
                      onChange={(event) => setStorePrice(event.target.value)}
                      type="number"
                      min={0}
                      step="0.01"
                      className={PRODUCT_FORM_NUMBER_CLASS}
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>{th ? "5. ราคาเดลิเวอรี่" : "5. Delivery Price"}</span>
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
                        className={`${PRODUCT_FORM_CONTROL_CLASS} border-emerald-300 bg-emerald-50 font-semibold text-emerald-800`}
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
                      className={`${PRODUCT_FORM_NUMBER_CLASS} disabled:cursor-not-allowed disabled:bg-slate-100`}
                    />
                  </label>
                </div>

                <div className="mt-3 rounded-xl border border-slate-200 p-3">
                  <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-800">
                    <input
                      type="checkbox"
                      checked={useIngredientRecipe}
                      onChange={(event) => setUseIngredientRecipe(event.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span>{th ? "เปิดใส่วัตถุดิบ (ตั้งสูตรตัดสต๊อก)" : "Enable ingredient recipe mode"}</span>
                  </label>

                  {useIngredientRecipe ? (
                    <div className="mt-3 max-h-[34vh] overflow-y-auto rounded-xl border border-slate-200">
                      <table className="w-full min-w-[620px] border-collapse">
                        <thead>
                          <tr className="bg-slate-50">
                            <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "เลือก" : "Select"}</th>
                            <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "วัตถุดิบ" : "Ingredient"}</th>
                            <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "คงเหลือ" : "On Hand"}</th>
                            <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "จำนวนต่อ 1 ชิ้น" : "Qty per item"}</th>
                            <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "หน่วย" : "Unit"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ingredientLines.map((line) => {
                            const ingredient = ingredientMap.get(line.ingredientId);
                            if (!ingredient) return null;
                            return (
                              <tr key={line.ingredientId}>
                                <td className="border-b border-slate-100 px-3 py-2">
                                  <input
                                    type="checkbox"
                                    title="Select ingredient"
                                    checked={line.selected}
                                    onChange={() => toggleIngredient(line.ingredientId)}
                                    className="h-4 w-4 rounded border-slate-300"
                                  />
                                </td>
                                <td className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">{ingredient.name}</td>
                                <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-600">
                                  {ingredient.quantityOnHand} {ingredient.baseUnit}
                                </td>
                                <td className="border-b border-slate-100 px-3 py-2">
                                  <input
                                    value={line.quantity}
                                    onChange={(event) => updateIngredientQuantity(line.ingredientId, event.target.value)}
                                    type="number"
                                    title="Ingredient quantity"
                                    placeholder="0"
                                    min={0}
                                    step="0.01"
                                    disabled={!line.selected}
                                    className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                                  />
                                </td>
                                <td className="border-b border-slate-100 px-3 py-2">
                                  <select
                                    title="Unit of measurement"
                                    value={line.quantityUnit}
                                    onChange={(event) =>
                                      updateIngredientUnit(
                                        line.ingredientId,
                                        event.target.value === "khid"
                                          ? "khid"
                                          : event.target.value === "kg"
                                            ? "kg"
                                            : event.target.value === "piece"
                                              ? "piece"
                                              : "gram"
                                      )
                                    }
                                    disabled={!line.selected}
                                    className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                                  >
                                    {(() => {
                                      const item = ingredientMap.get(line.ingredientId);
                                      const baseUnit = String(item?.baseUnit ?? "").toLowerCase();
                                      const isPiece = baseUnit === "piece" || baseUnit === "unit" || baseUnit === "ลูก";
                                      if (isPiece) {
                                        return <option value="piece">{th ? "ลูก/ชิ้น" : "piece"}</option>;
                                      }
                                      return (
                                        <>
                                          <option value="gram">{th ? "กรัม" : "gram"}</option>
                                          <option value="kg">{th ? "กิโลกรัม" : "kg"}</option>
                                          <option value="khid">{th ? "ขีด" : "khid (100g)"}</option>
                                        </>
                                      );
                                    })()}
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      {th ? "ถ้าไม่เปิดใส่วัตถุดิบ ระบบจะตัดสต๊อกแบบชิ้นเท่านั้น" : "Ingredient mode off: system deducts stock by piece only."}
                    </p>
                  )}
                </div>
              </>
            )}

            {activeTab === "ingredient" && (
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label className="grid gap-1 text-xs font-semibold text-slate-700">
                  <span>{th ? "วัตถุดิบ" : "Ingredient"}</span>
                  <input
                    value={ingredientName}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      const normalizedNextName = nextName.trim().toLowerCase();
                      const nextIngredient = sortedIngredients.find((item) => item.name.trim().toLowerCase() === normalizedNextName) ?? null;
                      const nextIsPiece = isPieceBaseUnit(nextIngredient?.baseUnit ?? "");
                      setIngredientName(nextName);
                      setPurchaseUnit(nextIsPiece ? "piece" : "gram");
                    }}
                    list="ingredient-restock-suggestions-inline"
                    placeholder={th ? "เช่น กะหล่ำปลี / ถ้วยน้ำจิ้ม" : "e.g. Cabbage / Sauce cup"}
                    className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                  <datalist id="ingredient-restock-suggestions-inline">
                    {sortedIngredients.map((item) => (
                      <option key={item.id} value={item.name} />
                    ))}
                  </datalist>
                </label>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>{th ? "จำนวนรับเข้า" : "Purchase Quantity"}</span>
                    <input
                      value={purchaseQuantity}
                      onChange={(event) => setPurchaseQuantity(event.target.value)}
                      type="number"
                      min={0}
                      step={selectedIsPiece ? "1" : "0.01"}
                      className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>{th ? "หน่วยรับเข้า" : "Purchase Unit"}</span>
                    <select
                      value={selectedIsPiece ? "piece" : purchaseUnit}
                      onChange={(event) => setPurchaseUnit(event.target.value as PurchaseUnit)}
                      disabled={selectedIsPiece}
                      className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
                    >
                      {selectedIsPiece ? (
                        <option value="piece">{th ? "ลูก/ชิ้น" : "piece"}</option>
                      ) : (
                        <>
                          <option value="gram">{th ? "กรัม" : "gram"}</option>
                          <option value="kg">{th ? "กิโลกรัม" : "kg"}</option>
                          <option value="khid">{th ? "ขีด" : "khid (100g)"}</option>
                          <option value="bag">{th ? "ถุง" : "bag"}</option>
                        </>
                      )}
                    </select>
                  </label>
                </div>

                {!selectedIsPiece && purchaseUnit === "bag" ? (
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>{th ? "น้ำหนักต่อถุง (กรัม)" : "Weight Per Bag (grams)"}</span>
                    <input
                      value={weightPerBagInGrams}
                      onChange={(event) => setWeightPerBagInGrams(event.target.value)}
                      type="number"
                      min={0}
                      step="0.01"
                      className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    />
                  </label>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>{th ? "ต้นทุนรวม (ไม่บังคับ)" : "Total Cost (optional)"}</span>
                    <input
                      value={receivedTotalCost}
                      onChange={(event) => setReceivedTotalCost(event.target.value)}
                      type="number"
                      min={0}
                      step="0.01"
                      className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    />
                  </label>

                  <label className="grid gap-1 text-xs font-semibold text-slate-700">
                    <span>{th ? "หมายเหตุ" : "Reason"}</span>
                    <input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder={th ? "เช่น รับเข้าจากซัพพลายเออร์" : "e.g. Supplier restock"}
                      className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                    />
                  </label>
                </div>
              </div>
            )}

            {activeTab === "bulk" && (
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setBulkMode("products");
                      setErrorText("");
                    }}
                    className={`inline-flex min-h-9 items-center rounded-lg border px-3 text-xs font-bold transition ${
                      bulkMode === "products"
                        ? "border-indigo-600 bg-indigo-600 text-white"
                        : "border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50"
                    }`}
                  >
                    {th ? "นำเข้าสินค้า" : "Import Products"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkMode("ingredients");
                      setErrorText("");
                    }}
                    className={`inline-flex min-h-9 items-center rounded-lg border px-3 text-xs font-bold transition ${
                      bulkMode === "ingredients"
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "border-sky-200 bg-white text-sky-700 hover:bg-sky-50"
                    }`}
                  >
                    {th ? "นำเข้าวัตถุดิบ" : "Import Ingredients"}
                  </button>
                </div>

                {bulkMode === "products" ? (
                  <>
                    <p className="text-xs text-slate-600">
                      {th
                        ? "รูปแบบ: ชื่อสินค้า,หมวดหมู่,สต๊อก,ราคาหน้าร้าน,ราคาเดลิเวอรี่ (1 บรรทัดต่อ 1 รายการ)"
                        : "Format: name,category,stock,store_price,delivery_price (one row per line)."}
                    </p>
                    <textarea
                      value={bulkProductCsvText}
                      onChange={(event) => setBulkProductCsvText(event.target.value)}
                      rows={9}
                      placeholder={
                        th
                          ? "กาแฟเย็น,เครื่องดื่ม,35,45,55\nชาไทย,เครื่องดื่ม,40,50,60"
                          : "Iced Coffee,Drinks,35,45,55\nThai Tea,Drinks,40,50,60"
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </>
                ) : (
                  <>
                    <p className="text-xs text-slate-600">
                      {th
                        ? "รูปแบบ: ชื่อวัตถุดิบ,หน่วย,คงเหลือ,จุดสั่งซื้อ (1 บรรทัดต่อ 1 รายการ)"
                        : "Format: name,base_unit,on_hand,reorder_level (one row per line)."}
                    </p>
                    <textarea
                      value={bulkIngredientCsvText}
                      onChange={(event) => setBulkIngredientCsvText(event.target.value)}
                      rows={9}
                      placeholder={
                        th
                          ? "นมสด,gram,5000,1000\nกาแฟคั่ว,gram,3000,800"
                          : "Fresh Milk,gram,5000,1000\nRoasted Coffee,gram,3000,800"
                      }
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </>
                )}
              </div>
            )}

            {errorText ? <p className="mt-3 whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{errorText}</p> : null}

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
              <button
                type="button"
                onClick={closePopup}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ยกเลิก" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmitByTab()}
                disabled={saving}
                className="inline-flex min-h-10 items-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(37,99,235,0.24)] hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving
                  ? th
                    ? "กำลังบันทึก..."
                    : "Saving..."
                  : activeTab === "product"
                    ? th
                      ? "บันทึกสินค้า"
                      : "Save Product"
                    : activeTab === "ingredient"
                      ? th
                        ? "บันทึกการรับเข้า"
                        : "Save Restock"
                      : th
                        ? "เริ่มนำเข้า"
                        : "Start Import"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
