"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BestSellersPopupButton } from "@/components/pos-preview/best-sellers-popup-button";
import { CategoryManagePopupButton } from "@/components/pos-preview/category-manage-popup-button";
import { EditProductPopupButton } from "@/components/pos-preview/edit-product-popup-button";
import { StockSettingsPopupButton } from "@/components/pos-preview/stock-settings-popup-button";
import { StockRowActionIcons } from "@/components/pos-preview/stock-row-action-icons";
import { StockSkuReveal } from "@/components/pos-preview/stock-sku-reveal";
import { UnitStockPopupButton } from "@/components/pos-preview/unit-stock-popup-button";

type CategoryItem = {
  name: string;
  productCount: number;
};

type IngredientItem = {
  id: string;
  name: string;
  baseUnit: string;
  quantityOnHand: number;
  reorderLevel: number;
};

type UnitStockItem = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  stockOnHand: number;
};

type BranchOption = {
  id: string;
  name: string;
  code: string | null;
};

type ProductRow = {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  price: number;
  is_active: boolean;
  delivery_price_preview?: number;
  stock_on_hand_units?: number | null;
  stock_on_hand_note?: string;
  has_ingredient_recipe?: boolean;
  stock_deduction_mode?: "unit_only" | "recipe_deduction" | null;
};

type SellableStockStatus = {
  label: string;
  className: string;
};

type Props = {
  th: boolean;
  products: ProductRow[];
  categoryList: CategoryItem[];
  ingredientList: IngredientItem[];
  deliveryRates: Array<{
    channel: "line_man" | "grab" | "shopee";
    channelLabel: string;
    commissionRatePct: number;
    commissionVatRatePct: number;
  }>;
  unitStockList: UnitStockItem[];
  allowNegativeStock: boolean;
  inventorySettingsReady: boolean;
  inventorySettingsMessage?: string;
  branchId: string;
  branchOptions: BranchOption[];
  canManageCatalog: boolean;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

const INGREDIENT_BASE_UNIT_OPTIONS = [
  { value: "gram", thLabel: "กรัม", enLabel: "gram" },
  { value: "kg", thLabel: "กิโลกรัม", enLabel: "kg" },
  { value: "khid", thLabel: "ขีด", enLabel: "khid" },
  { value: "bag", thLabel: "ถุง", enLabel: "bag" },
  { value: "ลูก", thLabel: "ลูก", enLabel: "piece (round)" },
  { value: "ชิ้น", thLabel: "ชิ้น", enLabel: "piece" }
] as const;

function normalizeIngredientBaseUnit(value: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["gram", "g", "กรัม"].includes(normalized)) return "gram";
  if (["kg", "กิโลกรัม"].includes(normalized)) return "kg";
  if (["khid", "ขีด"].includes(normalized)) return "khid";
  if (["bag", "ถุง"].includes(normalized)) return "bag";
  if (normalized === "ลูก") return "ลูก";
  if (["piece", "unit", "ชิ้น"].includes(normalized)) return "ชิ้น";
  return String(value ?? "").trim();
}

// Tune ingredient stock status thresholds by unit group here.
const INGREDIENT_STATUS_THRESHOLDS = {
  gram: { nearOut: 500, lowStock: 2000 },
  ml: { nearOut: 500, lowStock: 2000 },
  piece: { nearOut: 10, lowStock: 30 },
  default: { nearOut: 20, lowStock: 60 }
} as const;

function getIngredientUnitGroup(baseUnit: string): keyof typeof INGREDIENT_STATUS_THRESHOLDS {
  const normalized = String(baseUnit ?? "").trim().toLowerCase();
  if (["gram", "g", "กรัม", "ขีด", "khid", "kg", "กิโลกรัม"].includes(normalized)) return "gram";
  if (["ml", "มล.", "มล", "cc", "ซีซี", "ลิตร", "l", "liter"].includes(normalized)) return "ml";
  if (["piece", "unit", "ลูก", "ชิ้น"].includes(normalized)) return "piece";
  return "default";
}

function formatMoney(value: number) {
  return Number(value).toFixed(2);
}

function getSellableStockStatus(stockUnits: number | null | undefined, isActive: boolean, th: boolean): SellableStockStatus {
  if (!isActive) {
    return {
      label: th ? "ปิดการขาย" : "Inactive",
      className: "border-slate-300 bg-slate-100 text-slate-700"
    };
  }

  if (stockUnits === null || stockUnits === undefined) {
    return {
      label: th ? "ไม่มีสูตร" : "No recipe",
      className: "border-slate-300 bg-slate-100 text-slate-700"
    };
  }

  if (stockUnits === 0) {
    return {
      label: th ? "หมด" : "Out of stock",
      className: "border-red-300 bg-red-100 text-red-800"
    };
  }

  if (stockUnits < 30) {
    return {
      label: th ? "ใกล้หมด" : "Nearly out",
      className: "border-yellow-300 bg-yellow-100 text-yellow-800"
    };
  }

  if (stockUnits < 100) {
    return {
      label: th ? "สต๊อกต่ำ" : "Low stock",
      className: "border-orange-300 bg-orange-100 text-orange-800"
    };
  }

  return {
    label: th ? "พร้อมขาย" : "Ready",
    className: "border-emerald-300 bg-emerald-50 text-emerald-800"
  };
}

export function StockProductsTable({
  th,
  products,
  categoryList,
  ingredientList,
  deliveryRates,
  unitStockList,
  allowNegativeStock,
  inventorySettingsReady,
  inventorySettingsMessage = "",
  branchId,
  branchOptions,
  canManageCatalog
}: Props) {
  const PAGE_SIZE = 5;
  const router = useRouter();
  const [modeFilter, setModeFilter] = useState<"all" | "unit_only" | "ingredients">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [deactivatingProduct, setDeactivatingProduct] = useState<ProductRow | null>(null);
  const [deactivatingProductError, setDeactivatingProductError] = useState("");
  const [busyIngredientId, setBusyIngredientId] = useState<string | null>(null);
  const [editingIngredient, setEditingIngredient] = useState<IngredientItem | null>(null);
  const [editingIngredientName, setEditingIngredientName] = useState("");
  const [editingIngredientQty, setEditingIngredientQty] = useState("");
  const [editingIngredientUnit, setEditingIngredientUnit] = useState("");
  const [editingIngredientError, setEditingIngredientError] = useState("");
  const [deletingIngredient, setDeletingIngredient] = useState<IngredientItem | null>(null);
  const [deletingIngredientError, setDeletingIngredientError] = useState("");
  const [ingredientStockPopup, setIngredientStockPopup] = useState<IngredientItem | null>(null);
  const [ingredientStockPopupMode, setIngredientStockPopupMode] = useState<"add" | "subtract" | null>(null);
  const [ingredientStockPopupQty, setIngredientStockPopupQty] = useState("");
  const [ingredientStockPopupError, setIngredientStockPopupError] = useState("");
  const [stockPopupProduct, setStockPopupProduct] = useState<ProductRow | null>(null);
  const [stockPopupMode, setStockPopupMode] = useState<"add" | "subtract" | null>(null);
  const [stockPopupQty, setStockPopupQty] = useState("");
  const [stockPopupError, setStockPopupError] = useState("");
  const [notice, setNotice] = useState<string>("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [productSearchText, setProductSearchText] = useState("");
  const [productCategoryFilter, setProductCategoryFilter] = useState("all");
  const [ingredientSearchText, setIngredientSearchText] = useState("");
  const [ingredientUnitFilter, setIngredientUnitFilter] = useState("all");
  const [filterPopupOpen, setFilterPopupOpen] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [selectedIngredientIds, setSelectedIngredientIds] = useState<string[]>([]);
  const [bulkDeletePopupMode, setBulkDeletePopupMode] = useState<"products" | "ingredients" | null>(null);
  const [bulkDeleteScope, setBulkDeleteScope] = useState<"all" | "selected">("all");
  const [bulkDeleteBusy, setBulkDeleteBusy] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState("");
  const [bulkUnlinkScope, setBulkUnlinkScope] = useState<"all" | "selected" | null>(null);
  const [bulkUnlinkBusy, setBulkUnlinkBusy] = useState(false);
  const [bulkUnlinkError, setBulkUnlinkError] = useState("");

  const baseProductsByMode = useMemo(() => {
    if (modeFilter === "ingredients" || modeFilter === "all") return products;
    return products.filter((item) => item.stock_deduction_mode === modeFilter);
  }, [modeFilter, products]);

  const unitCount = useMemo(() => products.filter((item) => item.stock_deduction_mode === "unit_only").length, [products]);
  const ingredientsSorted = useMemo(
    () =>
      [...ingredientList].sort((a, b) =>
        a.name.localeCompare(b.name, th ? "th" : "en", {
          sensitivity: "base"
        })
      ),
    [ingredientList, th]
  );
  const productCategoryOptions = useMemo(() => {
    const options = Array.from(
      new Set([
        ...categoryList.map((item) => item.name.trim()).filter((category) => category.length > 0),
        ...baseProductsByMode.map((item) => String(item.category ?? "").trim()).filter((category) => category.length > 0)
      ])
    );
    return options.sort((a, b) => a.localeCompare(b, th ? "th" : "en"));
  }, [baseProductsByMode, categoryList, th]);

  const filteredProducts = useMemo(() => {
    const keyword = productSearchText.trim().toLowerCase();
    return baseProductsByMode.filter((item) => {
      if (productCategoryFilter !== "all") {
        const categoryName = String(item.category ?? "").trim();
        if (categoryName !== productCategoryFilter) return false;
      }
      if (!keyword) return true;
      const haystack = `${item.name} ${item.sku ?? ""} ${item.category ?? ""}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [baseProductsByMode, productCategoryFilter, productSearchText]);

  const filteredIngredients = useMemo(() => {
    const keyword = ingredientSearchText.trim().toLowerCase();
    return ingredientsSorted.filter((item) => {
      const normalizedUnit = normalizeIngredientBaseUnit(item.baseUnit);
      if (ingredientUnitFilter !== "all" && normalizedUnit !== ingredientUnitFilter) return false;
      if (!keyword) return true;
      const haystack = `${item.name} ${item.baseUnit}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [ingredientSearchText, ingredientUnitFilter, ingredientsSorted]);
  const selectedFilteredProductIds = useMemo(
    () => filteredProducts.map((item) => item.id).filter((id) => selectedProductIds.includes(id)),
    [filteredProducts, selectedProductIds]
  );
  const selectedFilteredIngredientIds = useMemo(
    () => filteredIngredients.map((item) => item.id).filter((id) => selectedIngredientIds.includes(id)),
    [filteredIngredients, selectedIngredientIds]
  );

  useEffect(() => {
    if (notice) {
      setNoticeOpen(true);
    }
  }, [notice]);

  function closeNoticePopup() {
    setNoticeOpen(false);
    setNotice("");
  }

  const totalItems = modeFilter === "ingredients" ? filteredIngredients.length : filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const activeFilterCount =
    (modeFilter === "ingredients" ? Number(ingredientSearchText.trim().length > 0) + Number(ingredientUnitFilter !== "all") : Number(productSearchText.trim().length > 0) + Number(productCategoryFilter !== "all")) +
    Number(modeFilter !== "all");

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (productCategoryFilter !== "all" && !productCategoryOptions.includes(productCategoryFilter)) {
      setProductCategoryFilter("all");
    }
  }, [productCategoryFilter, productCategoryOptions]);

  useEffect(() => {
    setSelectedProductIds((prev) => prev.filter((id) => products.some((item) => item.id === id)));
  }, [products]);

  useEffect(() => {
    setSelectedIngredientIds((prev) => prev.filter((id) => ingredientList.some((item) => item.id === id)));
  }, [ingredientList]);

  const pagedProducts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredProducts]);

  const pagedIngredients = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredIngredients.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredIngredients]);

  function selectMode(nextMode: "all" | "unit_only" | "ingredients") {
    setModeFilter(nextMode);
    setCurrentPage(1);
  }

  function toggleProductSelection(productId: string) {
    setSelectedProductIds((prev) => (prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]));
  }

  function toggleIngredientSelection(ingredientId: string) {
    setSelectedIngredientIds((prev) => (prev.includes(ingredientId) ? prev.filter((id) => id !== ingredientId) : [...prev, ingredientId]));
  }

  function toggleSelectAllFilteredProducts() {
    const allIds = filteredProducts.map((item) => item.id);
    if (allIds.length === 0) return;
    const isAllSelected = allIds.every((id) => selectedProductIds.includes(id));
    setSelectedProductIds((prev) => {
      if (isAllSelected) {
        return prev.filter((id) => !allIds.includes(id));
      }
      return Array.from(new Set([...prev, ...allIds]));
    });
  }

  function toggleSelectAllFilteredIngredients() {
    const allIds = filteredIngredients.map((item) => item.id);
    if (allIds.length === 0) return;
    const isAllSelected = allIds.every((id) => selectedIngredientIds.includes(id));
    setSelectedIngredientIds((prev) => {
      if (isAllSelected) {
        return prev.filter((id) => !allIds.includes(id));
      }
      return Array.from(new Set([...prev, ...allIds]));
    });
  }

  function openBulkDeletePopup(scope: "all" | "selected") {
    const isIngredientsMode = modeFilter === "ingredients";
    const targetIds =
      isIngredientsMode
        ? scope === "all"
          ? filteredIngredients.map((item) => item.id)
          : selectedFilteredIngredientIds
        : scope === "all"
          ? filteredProducts.map((item) => item.id)
          : selectedFilteredProductIds;
    setFilterPopupOpen(false);
    if (targetIds.length === 0) {
      setNotice(th ? "ไม่มีรายการตามตัวกรองให้ลบ" : "No filtered items available for bulk delete.");
      return;
    }
    setBulkDeleteScope(scope);
    setBulkDeleteError("");
    setBulkDeletePopupMode(isIngredientsMode ? "ingredients" : "products");
  }

  function closeBulkDeletePopup() {
    if (bulkDeleteBusy) return;
    setBulkDeletePopupMode(null);
    setBulkDeleteError("");
  }

  function openBulkUnlinkPopup(scope: "all" | "selected") {
    const ids = scope === "all" ? filteredProducts.map((item) => item.id) : selectedFilteredProductIds;
    setFilterPopupOpen(false);
    if (ids.length === 0) {
      setNotice(th ? "ไม่มีสินค้าตามตัวกรองให้ยกเลิกผูกวัตถุดิบ" : "No filtered products available to unlink recipes.");
      return;
    }
    setBulkUnlinkScope(scope);
    setBulkUnlinkError("");
  }

  function closeBulkUnlinkPopup() {
    if (bulkUnlinkBusy) return;
    setBulkUnlinkScope(null);
    setBulkUnlinkError("");
  }

  async function submitBulkUnlinkRecipes() {
    if (!canManageCatalog) {
      setBulkUnlinkError(th ? "สิทธิ์ไม่เพียงพอสำหรับแก้ไขสูตรวัตถุดิบ" : "You do not have permission to update recipes.");
      return;
    }
    if (!bulkUnlinkScope) return;
    const ids = bulkUnlinkScope === "all" ? filteredProducts.map((item) => item.id) : selectedFilteredProductIds;
    if (ids.length === 0) {
      setBulkUnlinkError(th ? "ไม่มีรายการให้บันทึก" : "No rows to save.");
      return;
    }

    setBulkUnlinkBusy(true);
    setBulkUnlinkError("");
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_unlink_product_recipes",
          branch_id: branchId,
          product_ids: ids,
          stock_quantity: 0
        })
      });
      const body = (await response.json()) as ApiEnvelope<{ updated_count?: number; failed_count?: number }>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Bulk unlink failed.");
      }

      const updatedCount = Number(body.data?.updated_count ?? 0);
      const failedCount = Number(body.data?.failed_count ?? 0);
      setNotice(
        th
          ? `ยกเลิกผูกวัตถุดิบแล้ว ${updatedCount} รายการ${failedCount > 0 ? `, ไม่สำเร็จ ${failedCount}` : ""}`
          : `Unlinked recipes for ${updatedCount} products${failedCount > 0 ? `, ${failedCount} failed` : ""}.`
      );
      setSelectedProductIds((prev) => prev.filter((id) => !ids.includes(id)));
      setBulkUnlinkScope(null);
      setBulkUnlinkError("");
      router.refresh();
    } catch (error) {
      setBulkUnlinkError(error instanceof Error ? error.message : th ? "ยกเลิกผูกวัตถุดิบไม่สำเร็จ" : "Bulk unlink failed.");
    } finally {
      setBulkUnlinkBusy(false);
    }
  }

  async function submitBulkDelete() {
    if (!canManageCatalog) {
      setBulkDeleteError(th ? "สิทธิ์ไม่เพียงพอสำหรับลบ/ปิดการขาย" : "You do not have permission to modify catalog.");
      return;
    }
    if (!bulkDeletePopupMode) return;

    const isIngredientsMode = bulkDeletePopupMode === "ingredients";
    const ids =
      isIngredientsMode
        ? bulkDeleteScope === "all"
          ? filteredIngredients.map((item) => item.id)
          : selectedFilteredIngredientIds
        : bulkDeleteScope === "all"
          ? filteredProducts.map((item) => item.id)
          : selectedFilteredProductIds;
    if (ids.length === 0) {
      setBulkDeleteError(th ? "ไม่มีรายการให้ลบ" : "No rows to delete.");
      return;
    }

    setBulkDeleteBusy(true);
    setBulkDeleteError("");
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isIngredientsMode
            ? {
                action: "bulk_delete_ingredients",
                branch_id: branchId,
                ingredient_ids: ids
              }
            : {
                action: "bulk_deactivate_products",
                branch_id: branchId,
                product_ids: ids
              }
        )
      });
      const body = (await response.json()) as ApiEnvelope<{ updated_count?: number; deleted_count?: number; archived_count?: number }>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Bulk action failed.");
      }

      if (isIngredientsMode) {
        const deletedCount = Number(body.data?.deleted_count ?? ids.length);
        const archivedCount = Number(body.data?.archived_count ?? 0);
        setNotice(
          th
            ? `ลบวัตถุดิบแล้ว ${deletedCount} รายการ${archivedCount > 0 ? ` (archive ${archivedCount})` : ""}`
            : `Deleted ${deletedCount} ingredients${archivedCount > 0 ? ` (${archivedCount} archived)` : ""}.`
        );
        setSelectedIngredientIds((prev) => prev.filter((id) => !ids.includes(id)));
      } else {
        const updatedCount = Number(body.data?.updated_count ?? ids.length);
        setNotice(th ? `ปิดการขายสินค้าแล้ว ${updatedCount} รายการ` : `Deactivated ${updatedCount} products.`);
        setSelectedProductIds((prev) => prev.filter((id) => !ids.includes(id)));
      }
      setBulkDeletePopupMode(null);
      router.refresh();
    } catch (error) {
      setBulkDeleteError(error instanceof Error ? error.message : th ? "ลบรายการจำนวนมากไม่สำเร็จ" : "Bulk delete failed.");
    } finally {
      setBulkDeleteBusy(false);
    }
  }

  async function updateProductPrice(item: ProductRow) {
    if (!canManageCatalog) {
      setNotice(th ? "สิทธิ์ไม่เพียงพอสำหรับแก้ไขสินค้า" : "You do not have permission to edit products.");
      return;
    }
    const input = window.prompt(th ? "กรอกราคาหน้าร้านใหม่" : "Enter new store price", String(item.price));
    if (input === null) return;
    const nextPrice = Number(input);
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      setNotice(th ? "ราคาต้องเป็น 0 หรือมากกว่า" : "Price must be 0 or greater.");
      return;
    }

    setBusyProductId(item.id);
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_product",
          branch_id: branchId,
          id: item.id,
          sku: item.sku ?? Date.now().toString(),
          name: item.name,
          category: item.category ?? (th ? "ไม่ระบุหมวดหมู่" : "Uncategorized"),
          price: nextPrice,
          stock_deduction_mode: item.stock_deduction_mode ?? "unit_only",
          is_active: item.is_active
        })
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Update failed");
      }
      setNotice(th ? "ปรับราคาสำเร็จ" : "Price updated.");
      router.refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : th ? "อัปเดตไม่สำเร็จ" : "Update failed.");
    } finally {
      setBusyProductId(null);
    }
  }

  function openStockPopup(item: ProductRow) {
    if (!canManageCatalog) {
      setNotice(th ? "สิทธิ์ไม่เพียงพอสำหรับปรับสต๊อก" : "You do not have permission to adjust stock.");
      return;
    }
    if (item.stock_deduction_mode !== "unit_only") {
      setNotice(th ? "สินค้าแบบสูตรวัตถุดิบให้ปรับผ่านปุ่มแก้ไขสินค้า" : "For recipe mode, adjust stock from Edit Product.");
      return;
    }
    setStockPopupProduct(item);
    setStockPopupMode(null);
    setStockPopupQty("");
    setStockPopupError("");
  }

  function closeStockPopup() {
    setStockPopupProduct(null);
    setStockPopupMode(null);
    setStockPopupQty("");
    setStockPopupError("");
  }

  async function submitStockPopup() {
    if (!canManageCatalog) {
      setStockPopupError(th ? "สิทธิ์ไม่เพียงพอสำหรับปรับสต๊อก" : "You do not have permission to adjust stock.");
      return;
    }
    if (!stockPopupProduct) return;

    const currentStock = Math.max(0, Number(stockPopupProduct.stock_on_hand_units ?? 0));
    if (!stockPopupMode) {
      setStockPopupError(th ? "กรุณาเลือกโหมดเพิ่มหรือตัดสต๊อก" : "Please choose add or subtract mode.");
      return;
    }
    const qty = Number(stockPopupQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setStockPopupError(th ? "จำนวนต้องมากกว่า 0" : "Quantity must be greater than 0.");
      return;
    }

    const delta = Math.floor(qty);
    if (delta <= 0) {
      setStockPopupError(th ? "จำนวนต้องเป็นเลขจำนวนเต็มมากกว่า 0" : "Quantity must be a whole number greater than 0.");
      return;
    }
    const nextStock = stockPopupMode === "add" ? currentStock + delta : currentStock - delta;
    if (nextStock < 0) {
      setStockPopupError(th ? "ตัดสต๊อกเกินจำนวนคงเหลือไม่ได้" : "Cannot subtract more than available stock.");
      return;
    }

    setStockPopupError("");
    setBusyProductId(stockPopupProduct.id);
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_product_with_stock_setup",
          branch_id: branchId,
          product_id: stockPopupProduct.id,
          name: stockPopupProduct.name,
          category: stockPopupProduct.category ?? (th ? "ไม่ระบุหมวดหมู่" : "Uncategorized"),
          stock_quantity: nextStock,
          store_price: Number(stockPopupProduct.price ?? 0),
          delivery_price: Number(stockPopupProduct.delivery_price_preview ?? stockPopupProduct.price ?? 0),
          use_ingredient_recipe: false,
          ingredient_lines: []
        })
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Update failed");
      }
      setNotice(th ? "ปรับสต๊อกสำเร็จ" : "Stock updated.");
      closeStockPopup();
      router.refresh();
    } catch (error) {
      setStockPopupError(error instanceof Error ? error.message : th ? "อัปเดตสต๊อกไม่สำเร็จ" : "Stock update failed.");
    } finally {
      setBusyProductId(null);
    }
  }

  function openDeactivateProductPopup(item: ProductRow) {
    if (!canManageCatalog) {
      setNotice(th ? "สิทธิ์ไม่เพียงพอสำหรับปิดการขายสินค้า" : "You do not have permission to deactivate products.");
      return;
    }
    setDeactivatingProduct(item);
    setDeactivatingProductError("");
  }

  function closeDeactivateProductPopup() {
    setDeactivatingProduct(null);
    setDeactivatingProductError("");
  }

  async function submitDeactivateProduct() {
    if (!canManageCatalog) {
      setDeactivatingProductError(th ? "สิทธิ์ไม่เพียงพอสำหรับปิดการขายสินค้า" : "You do not have permission to deactivate products.");
      return;
    }
    if (!deactivatingProduct) return;
    setDeactivatingProductError("");
    setBusyProductId(deactivatingProduct.id);
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "deactivate_product",
          branch_id: branchId,
          product_id: deactivatingProduct.id
        })
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Delete failed");
      }
      setNotice(th ? "ปิดการขายสินค้าแล้ว" : "Product deactivated.");
      closeDeactivateProductPopup();
      router.refresh();
    } catch (error) {
      setDeactivatingProductError(error instanceof Error ? error.message : th ? "ปิดการขายไม่สำเร็จ" : "Deactivate failed.");
    } finally {
      setBusyProductId(null);
    }
  }

  function formatIngredientQty(item: IngredientItem) {
    const unit = String(item.baseUnit ?? "").toLowerCase();
    const qty = Number(item.quantityOnHand ?? 0);
    if (unit === "piece" || unit === "unit" || unit === "ลูก") {
      return String(Math.max(0, Math.floor(qty)));
    }
    return Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
  }

  function getIngredientStatus(item: IngredientItem): SellableStockStatus {
    const qty = Number(item.quantityOnHand ?? 0);
    const reorderLevel = Math.max(0, Number(item.reorderLevel ?? 0));
    const unitGroup = getIngredientUnitGroup(item.baseUnit);
    const unitThreshold = INGREDIENT_STATUS_THRESHOLDS[unitGroup];
    const nearOutThreshold = reorderLevel > 0 ? reorderLevel : unitThreshold.nearOut;
    const lowStockThreshold = reorderLevel > 0 ? Math.max(reorderLevel * 2, nearOutThreshold + 1) : unitThreshold.lowStock;

    if (qty <= 0) {
      return {
        label: th ? "หมด" : "Out",
        className: "border-red-300 bg-red-100 text-red-800"
      };
    }
    if (qty <= nearOutThreshold) {
      return {
        label: th ? "ใกล้หมด" : "Nearly out",
        className: "border-yellow-300 bg-yellow-100 text-yellow-800"
      };
    }
    if (qty <= lowStockThreshold) {
      return {
        label: th ? "สต๊อกต่ำ" : "Low stock",
        className: "border-orange-300 bg-orange-100 text-orange-800"
      };
    }
    return {
      label: th ? "พร้อมใช้" : "Ready",
      className: "border-emerald-300 bg-emerald-50 text-emerald-800"
    };
  }

  function openEditIngredientPopup(item: IngredientItem) {
    setEditingIngredient(item);
    setEditingIngredientName(item.name);
    setEditingIngredientQty(String(item.quantityOnHand));
    setEditingIngredientUnit(normalizeIngredientBaseUnit(item.baseUnit));
    setEditingIngredientError("");
  }

  function closeEditIngredientPopup() {
    setEditingIngredient(null);
    setEditingIngredientName("");
    setEditingIngredientQty("");
    setEditingIngredientUnit("");
    setEditingIngredientError("");
  }

  async function submitEditIngredient() {
    if (!canManageCatalog) {
      setEditingIngredientError(th ? "สิทธิ์ไม่เพียงพอสำหรับแก้ไขวัตถุดิบ" : "You do not have permission to edit ingredients.");
      return;
    }
    if (!editingIngredient) return;

    const nextName = editingIngredientName.trim();
    if (!nextName) {
      setEditingIngredientError(th ? "ชื่อวัตถุดิบห้ามว่าง" : "Ingredient name cannot be empty.");
      return;
    }

    const nextQty = Number(editingIngredientQty);
    if (!Number.isFinite(nextQty) || nextQty < 0) {
      setEditingIngredientError(th ? "จำนวนคงเหลือต้องเป็น 0 หรือมากกว่า" : "Quantity on hand must be 0 or greater.");
      return;
    }

    const nextBaseUnit = editingIngredientUnit.trim();
    if (!nextBaseUnit) {
      setEditingIngredientError(th ? "หน่วยวัตถุดิบห้ามว่าง" : "Base unit cannot be empty.");
      return;
    }

    setEditingIngredientError("");
    setBusyIngredientId(editingIngredient.id);
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_ingredient",
          branch_id: branchId,
          id: editingIngredient.id,
          name: nextName,
          base_unit: nextBaseUnit,
          quantity_on_hand: nextQty,
          reorder_level: Number(editingIngredient.reorderLevel ?? 0)
        })
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Update failed.");
      }
      setNotice(th ? "แก้ไขวัตถุดิบสำเร็จ" : "Ingredient updated.");
      closeEditIngredientPopup();
      router.refresh();
    } catch (error) {
      setEditingIngredientError(error instanceof Error ? error.message : th ? "แก้ไขวัตถุดิบไม่สำเร็จ" : "Failed to update ingredient.");
    } finally {
      setBusyIngredientId(null);
    }
  }

  function openDeleteIngredientPopup(item: IngredientItem) {
    setDeletingIngredient(item);
    setDeletingIngredientError("");
  }

  function closeDeleteIngredientPopup() {
    setDeletingIngredient(null);
    setDeletingIngredientError("");
  }

  async function submitDeleteIngredient() {
    if (!canManageCatalog) {
      setDeletingIngredientError(th ? "สิทธิ์ไม่เพียงพอสำหรับลบวัตถุดิบ" : "You do not have permission to delete ingredients.");
      return;
    }
    if (!deletingIngredient) return;

    setDeletingIngredientError("");
    setBusyIngredientId(deletingIngredient.id);
    try {
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete_ingredient",
          branch_id: branchId,
          ingredient_id: deletingIngredient.id
        })
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Delete failed.");
      }
      setNotice(th ? "ลบวัตถุดิบสำเร็จ" : "Ingredient deleted.");
      closeDeleteIngredientPopup();
      router.refresh();
    } catch (error) {
      setDeletingIngredientError(error instanceof Error ? error.message : th ? "ลบวัตถุดิบไม่สำเร็จ" : "Failed to delete ingredient.");
    } finally {
      setBusyIngredientId(null);
    }
  }

  function openIngredientStockPopup(item: IngredientItem) {
    if (!canManageCatalog) {
      setNotice(th ? "สิทธิ์ไม่เพียงพอสำหรับปรับสต๊อกวัตถุดิบ" : "You do not have permission to adjust ingredient stock.");
      return;
    }
    setIngredientStockPopup(item);
    setIngredientStockPopupMode(null);
    setIngredientStockPopupQty("");
    setIngredientStockPopupError("");
  }

  function closeIngredientStockPopup() {
    setIngredientStockPopup(null);
    setIngredientStockPopupMode(null);
    setIngredientStockPopupQty("");
    setIngredientStockPopupError("");
  }

  async function submitIngredientStockPopup() {
    if (!canManageCatalog) {
      setIngredientStockPopupError(th ? "สิทธิ์ไม่เพียงพอสำหรับปรับสต๊อกวัตถุดิบ" : "You do not have permission to adjust ingredient stock.");
      return;
    }
    if (!ingredientStockPopup) return;
    if (!ingredientStockPopupMode) {
      setIngredientStockPopupError(th ? "กรุณาเลือกโหมดเพิ่มหรือตัดสต๊อก" : "Please choose add or subtract mode.");
      return;
    }
    const qty = Number(ingredientStockPopupQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setIngredientStockPopupError(th ? "จำนวนต้องมากกว่า 0" : "Quantity must be greater than 0.");
      return;
    }
    const delta = Math.floor(qty);
    if (delta <= 0) {
      setIngredientStockPopupError(th ? "จำนวนต้องเป็นเลขจำนวนเต็มมากกว่า 0" : "Quantity must be a whole number greater than 0.");
      return;
    }

    const currentQty = Number(ingredientStockPopup.quantityOnHand ?? 0);
    if (ingredientStockPopupMode === "subtract" && currentQty - delta < 0) {
      setIngredientStockPopupError(th ? "ตัดสต๊อกเกินจำนวนคงเหลือไม่ได้" : "Cannot subtract more than available stock.");
      return;
    }

    setBusyIngredientId(ingredientStockPopup.id);
    setIngredientStockPopupError("");
    try {
      const nextQty = ingredientStockPopupMode === "add" ? currentQty + delta : Math.max(0, currentQty - delta);
      const response = await fetch("/api/backoffice/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_ingredient",
          branch_id: branchId,
          id: ingredientStockPopup.id,
          name: ingredientStockPopup.name,
          base_unit: ingredientStockPopup.baseUnit,
          quantity_on_hand: nextQty,
          reorder_level: Number(ingredientStockPopup.reorderLevel ?? 0)
        })
      });
      const body = (await response.json()) as ApiEnvelope<unknown>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Update failed.");
      }

      setNotice(th ? "ปรับสต๊อกวัตถุดิบสำเร็จ" : "Ingredient stock updated.");
      closeIngredientStockPopup();
      router.refresh();
    } catch (error) {
      setIngredientStockPopupError(error instanceof Error ? error.message : th ? "อัปเดตไม่สำเร็จ" : "Update failed.");
    } finally {
      setBusyIngredientId(null);
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-extrabold text-slate-900 lg:text-lg">{th ? "รายการสินค้า" : "Product List"}</h3>
        <div className="flex flex-wrap gap-2">
          <BestSellersPopupButton
            th={th}
            branchId={branchId}
            branchOptions={branchOptions}
            canViewAllBranches={canManageCatalog && branchOptions.length > 1}
          />
          <button
            type="button"
            onClick={() => setFilterPopupOpen(true)}
            className="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            {th ? `ค้นหา/กรอง${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}` : `Search/Filter${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`}
          </button>
          <div className={canManageCatalog ? "" : "pointer-events-none opacity-60"}>
            <CategoryManagePopupButton th={th} categories={categoryList} branchId={branchId} />
          </div>
          <div className={canManageCatalog ? "" : "pointer-events-none opacity-60"}>
            <UnitStockPopupButton th={th} items={unitStockList} />
          </div>
          <div className={canManageCatalog ? "" : "pointer-events-none opacity-60"}>
            <StockSettingsPopupButton
              th={th}
              initialAllowNegativeStock={allowNegativeStock}
              storageReady={inventorySettingsReady}
              initialStorageMessage={inventorySettingsMessage}
            />
          </div>
        </div>
      </div>
      {!canManageCatalog ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
          {th ? "สิทธิ์พนักงาน: ดูข้อมูลได้ แต่เพิ่ม/แก้ไข/ลบสินค้าไม่ได้" : "Staff role: view only. Add/edit/delete is disabled."}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => selectMode("all")} className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${modeFilter === "all" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
          {th ? `ทั้งหมด (${products.length})` : `All (${products.length})`}
        </button>
        <button type="button" onClick={() => selectMode("unit_only")} className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${modeFilter === "unit_only" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
          {th ? `ตัดแบบชิ้น (${unitCount})` : `Unit Only (${unitCount})`}
        </button>
        <button
          type="button"
          onClick={() => selectMode("ingredients")}
          className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
            modeFilter === "ingredients" ? "border-sky-600 bg-sky-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
          }`}
        >
          {th ? `วัตถุดิบ (${ingredientList.length})` : `Ingredients (${ingredientList.length})`}
        </button>
      </div>

      {canManageCatalog && (modeFilter === "ingredients" ? selectedFilteredIngredientIds.length > 0 : selectedFilteredProductIds.length > 0) ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-bold text-slate-600">
            {modeFilter === "ingredients"
              ? th
                ? `เลือกวัตถุดิบแล้ว ${selectedFilteredIngredientIds.length} รายการ`
                : `${selectedFilteredIngredientIds.length} ingredients selected`
              : th
                ? `เลือกสินค้าแล้ว ${selectedFilteredProductIds.length} รายการ`
                : `${selectedFilteredProductIds.length} products selected`}
          </p>
          <div className="flex flex-wrap gap-2">
            {modeFilter !== "ingredients" ? (
              <button
                type="button"
                onClick={() => openBulkUnlinkPopup("selected")}
                className="inline-flex min-h-9 items-center rounded-lg border border-sky-200 bg-white px-3 text-xs font-bold text-sky-700 hover:bg-sky-50"
              >
                {th ? `ยกเลิกผูกวัตถุดิบที่เลือก (${selectedFilteredProductIds.length})` : `Unlink Selected (${selectedFilteredProductIds.length})`}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => openBulkDeletePopup("selected")}
              className="inline-flex min-h-9 items-center rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-700 hover:bg-red-50"
            >
              {modeFilter === "ingredients"
                ? th
                  ? `ลบวัตถุดิบที่เลือก (${selectedFilteredIngredientIds.length})`
                  : `Delete Selected Ingredients (${selectedFilteredIngredientIds.length})`
                : th
                  ? `ลบ/ปิดการขายสินค้าที่เลือก (${selectedFilteredProductIds.length})`
                  : `Delete/Deactivate Selected Products (${selectedFilteredProductIds.length})`}
            </button>
            <button
              type="button"
              onClick={() => openBulkDeletePopup("all")}
              className="inline-flex min-h-9 items-center rounded-lg border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-800 hover:bg-amber-100"
            >
              {modeFilter === "ingredients"
                ? th
                  ? `ลบวัตถุดิบทั้งหมด (${filteredIngredients.length})`
                  : `Delete All Ingredients (${filteredIngredients.length})`
                : th
                  ? `ลบ/ปิดการขายสินค้าทั้งหมด (${filteredProducts.length})`
                  : `Delete/Deactivate All Products (${filteredProducts.length})`}
            </button>
          </div>
        </div>
      ) : null}

      {filterPopupOpen ? (
        <div className="fixed inset-0 z-[165] grid place-items-center bg-slate-900/35 p-4" onClick={() => setFilterPopupOpen(false)}>
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-base font-extrabold text-slate-900">{th ? "ค้นหาและกรองรายการ" : "Search and Filter"}</h4>
                <p className="text-xs text-slate-500">{th ? "ตัวกรองจะมีผลกับรายการในตารางทันที" : "Filters apply to the table immediately."}</p>
              </div>
              <button type="button" onClick={() => setFilterPopupOpen(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
                {th ? "ปิด" : "Close"}
              </button>
            </div>

            {modeFilter === "ingredients" ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  <span>{th ? "ค้นหาวัตถุดิบ" : "Search Ingredients"}</span>
                  <input
                    value={ingredientSearchText}
                    onChange={(event) => {
                      setIngredientSearchText(event.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder={th ? "พิมพ์ชื่อวัตถุดิบหรือหน่วย..." : "Type ingredient name or unit..."}
                    className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  <span>{th ? "กรองหน่วย" : "Unit Filter"}</span>
                  <select
                    value={ingredientUnitFilter}
                    onChange={(event) => {
                      setIngredientUnitFilter(event.target.value);
                      setCurrentPage(1);
                    }}
                    className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    <option value="all">{th ? "ทุกหน่วย" : "All units"}</option>
                    {INGREDIENT_BASE_UNIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {th ? option.thLabel : option.enLabel}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  <span>{th ? "ค้นหาสินค้า" : "Search Products"}</span>
                  <input
                    value={productSearchText}
                    onChange={(event) => {
                      setProductSearchText(event.target.value);
                      setCurrentPage(1);
                    }}
                    placeholder={th ? "พิมพ์ชื่อสินค้า SKU หรือหมวดหมู่..." : "Type product name, SKU, or category..."}
                    className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-600">
                  <span>{th ? "กรองหมวดหมู่" : "Category Filter"}</span>
                  <select
                    value={productCategoryFilter}
                    onChange={(event) => {
                      setProductCategoryFilter(event.target.value);
                      setCurrentPage(1);
                    }}
                    className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    <option value="all">{th ? "ทุกหมวดหมู่" : "All categories"}</option>
                    {productCategoryOptions.map((categoryName) => (
                      <option key={categoryName} value={categoryName}>
                        {categoryName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap gap-2">
                {modeFilter !== "ingredients" ? (
                  <button
                    type="button"
                    onClick={() => openBulkUnlinkPopup(selectedFilteredProductIds.length > 0 ? "selected" : "all")}
                    disabled={filteredProducts.length === 0}
                    className="inline-flex min-h-9 items-center rounded-lg border border-sky-200 bg-sky-50 px-3 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {th
                      ? selectedFilteredProductIds.length > 0
                        ? `ยกเลิกผูกวัตถุดิบที่เลือก (${selectedFilteredProductIds.length})`
                        : `ยกเลิกผูกวัตถุดิบทั้งหมด (${filteredProducts.length})`
                      : selectedFilteredProductIds.length > 0
                        ? `Unlink Selected Recipes (${selectedFilteredProductIds.length})`
                        : `Unlink All Recipes (${filteredProducts.length})`}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => openBulkDeletePopup("selected")}
                  disabled={modeFilter === "ingredients" ? selectedFilteredIngredientIds.length === 0 : selectedFilteredProductIds.length === 0}
                  className="inline-flex min-h-9 items-center rounded-lg border border-amber-500 bg-amber-500 px-3 text-xs font-bold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {modeFilter === "ingredients"
                    ? th
                      ? `ลบที่เลือก (${selectedFilteredIngredientIds.length})`
                      : `Delete Selected (${selectedFilteredIngredientIds.length})`
                    : th
                      ? `ปิดการขายที่เลือก (${selectedFilteredProductIds.length})`
                      : `Deactivate Selected (${selectedFilteredProductIds.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => openBulkDeletePopup("all")}
                  disabled={modeFilter === "ingredients" ? filteredIngredients.length === 0 : filteredProducts.length === 0}
                  className="inline-flex min-h-9 items-center rounded-lg border border-amber-200 bg-white px-3 text-xs font-bold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {modeFilter === "ingredients"
                    ? th
                      ? `ลบทั้งหมด (${filteredIngredients.length})`
                      : `Delete All (${filteredIngredients.length})`
                    : th
                      ? `ปิดการขายทั้งหมด (${filteredProducts.length})`
                      : `Deactivate All (${filteredProducts.length})`}
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setProductSearchText("");
                  setProductCategoryFilter("all");
                  setIngredientSearchText("");
                  setIngredientUnitFilter("all");
                  setCurrentPage(1);
                }}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ล้างตัวกรอง" : "Clear Filters"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {noticeOpen ? (
        <div className="fixed inset-0 z-[170] grid place-items-center bg-slate-900/35 p-4" onClick={closeNoticePopup}>
          <div className="w-full max-w-md rounded-2xl border border-sky-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h4 className="text-base font-extrabold text-sky-700">{th ? "แจ้งเตือนการบันทึก" : "Save Notification"}</h4>
            <p className="mt-2 text-sm font-semibold text-slate-700">{notice}</p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={closeNoticePopup}
                className="inline-flex min-h-10 items-center rounded-lg border border-sky-600 bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-700"
              >
                {th ? "ตกลง" : "OK"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modeFilter === "ingredients" ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[820px] w-full border-collapse">
            <thead>
              <tr className="bg-slate-50">
                <th className="border-b border-slate-200 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={filteredIngredients.length > 0 && selectedFilteredIngredientIds.length === filteredIngredients.length}
                    onChange={toggleSelectAllFilteredIngredients}
                    aria-label={th ? "เลือกวัตถุดิบทั้งหมดตามตัวกรอง" : "Select all filtered ingredients"}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">{th ? "วัตถุดิบ" : "Ingredient"}</th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">{th ? "คงเหลือ" : "On Hand"}</th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">{th ? "หน่วย" : "Unit"}</th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">{th ? "สถานะ" : "Status"}</th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">{th ? "จัดการ" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {filteredIngredients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                    {th ? "ไม่พบรายการวัตถุดิบตามตัวกรองนี้" : "No ingredients match this filter."}
                  </td>
                </tr>
              ) : (
                pagedIngredients.map((item) => (
                  <tr key={item.id}>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIngredientIds.includes(item.id)}
                        onChange={() => toggleIngredientSelection(item.id)}
                        aria-label={th ? `เลือกรายการวัตถุดิบ ${item.name}` : `Select ingredient ${item.name}`}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3 text-sm font-semibold text-slate-900">{item.name}</td>
                    <td className="border-b border-slate-100 px-3 py-3 text-sm text-slate-800">{formatIngredientQty(item)}</td>
                    <td className="border-b border-slate-100 px-3 py-3 text-sm text-slate-600">{item.baseUnit}</td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      {(() => {
                        const status = getIngredientStatus(item);
                        return <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-bold ${status.className}`}>{status.label}</span>;
                      })()}
                    </td>
                    <td className="border-b border-slate-100 px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditIngredientPopup(item)}
                          disabled={busyIngredientId === item.id}
                          title={th ? "แก้ไขวัตถุดิบ" : "Edit ingredient"}
                          aria-label={th ? "แก้ไขวัตถุดิบ" : "Edit ingredient"}
                          className="inline-flex min-h-8 items-center justify-center rounded-lg border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => openDeleteIngredientPopup(item)}
                          disabled={busyIngredientId === item.id}
                          title={th ? "ลบวัตถุดิบ" : "Delete ingredient"}
                          aria-label={th ? "ลบวัตถุดิบ" : "Delete ingredient"}
                          className="inline-flex min-h-8 items-center justify-center rounded-lg border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6" />
                            <path d="M14 11v6" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => openIngredientStockPopup(item)}
                          disabled={busyIngredientId === item.id}
                          title={th ? "ปรับสต๊อกวัตถุดิบ" : "Adjust ingredient stock"}
                          aria-label={th ? "ปรับสต๊อกวัตถุดิบ" : "Adjust ingredient stock"}
                          className="inline-flex min-h-8 items-center justify-center rounded-lg border border-emerald-200 px-2 py-1 text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M12 5v14" />
                            <path d="M5 12h14" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-[1040px] w-full border-collapse">
            <thead>
              <tr className="bg-slate-50">
                <th className="border-b border-slate-200 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={filteredProducts.length > 0 && selectedFilteredProductIds.length === filteredProducts.length}
                    onChange={toggleSelectAllFilteredProducts}
                    aria-label={th ? "เลือกสินค้าทั้งหมดตามตัวกรอง" : "Select all filtered products"}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">SKU</th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">{th ? "หมวดหมู่" : "Category"}</th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">{th ? "สินค้า" : "Product"}</th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">{th ? "คงเหลือขายได้" : "Sellable Stock"}</th>
                <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-500">{th ? "ราคาหน้าร้าน" : "Store Price"}</th>
                <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-500">{th ? "ราคาเดลิเวอรี่" : "Delivery Price"}</th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">{th ? "สถานะ" : "Status"}</th>
                <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-500">{th ? "จัดการ" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500">
                    {th ? "ไม่พบรายการสินค้าตามตัวกรองนี้" : "No products match this filter."}
                  </td>
                </tr>
              ) : (
                pagedProducts.map((item) => {
                  return (
                    <tr key={item.id}>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(item.id)}
                          onChange={() => toggleProductSelection(item.id)}
                          aria-label={th ? `เลือกรายการสินค้า ${item.name}` : `Select product ${item.name}`}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-sm font-semibold text-slate-700"><StockSkuReveal sku={item.sku} th={th} /></td>
                      <td className="border-b border-slate-100 px-3 py-3 text-sm text-slate-700">{item.category ?? (th ? "ไม่ระบุหมวดหมู่" : "Uncategorized")}</td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <p className="text-sm font-bold text-slate-900">{item.name}</p>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        {item.stock_on_hand_units === null ? (
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-bold text-slate-600">-</p>
                            {item.has_ingredient_recipe ? (
                              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 text-[10px] font-extrabold leading-none text-emerald-700">
                                +
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-bold text-slate-900">{item.stock_on_hand_units}</p>
                            {item.has_ingredient_recipe ? (
                              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-emerald-300 bg-emerald-50 text-[10px] font-extrabold leading-none text-emerald-700">
                                +
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-right text-sm font-bold text-slate-800">{formatMoney(item.price)}</td>
                      <td className="border-b border-slate-100 px-3 py-3 text-right text-sm font-bold text-orange-600">{formatMoney(item.delivery_price_preview ?? item.price)}</td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        {(() => {
                          const status = getSellableStockStatus(item.stock_on_hand_units, item.is_active, th);
                          return <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-xs font-bold ${status.className}`}>{status.label}</span>;
                        })()}
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <EditProductPopupButton
                            th={th}
                            compact
                            product={{
                              id: item.id,
                              name: item.name,
                              category: item.category,
                              price: item.price,
                              deliveryPrice: item.delivery_price_preview ?? item.price
                            }}
                            categories={categoryList}
                            ingredients={ingredientList}
                            deliveryRates={deliveryRates}
                            branchId={branchId}
                            disabled={!canManageCatalog}
                          />
                          <StockRowActionIcons
                            th={th}
                            busy={busyProductId === item.id}
                            onDelete={() => openDeactivateProductPopup(item)}
                            onStock={() => openStockPopup(item)}
                            disabled={!canManageCatalog}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalItems > PAGE_SIZE ? (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            disabled={currentPage <= 1}
            className="inline-flex min-h-8 items-center rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {th ? "ก่อนหน้า" : "Prev"}
          </button>
          {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
            <button
              key={page}
              type="button"
              onClick={() => setCurrentPage(page)}
              className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-xs font-bold transition ${
                page === currentPage ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {page}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={currentPage >= totalPages}
            className="inline-flex min-h-8 items-center rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {th ? "ถัดไป" : "Next"}
          </button>
        </div>
      ) : null}

      {stockPopupProduct ? (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-900/55 p-4" onClick={closeStockPopup}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3">
              <h4 className="text-base font-extrabold text-slate-900">
                {th ? `ปรับสต๊อก: ${stockPopupProduct.name}` : `Adjust Stock: ${stockPopupProduct.name}`}
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                {th ? `สต๊อกปัจจุบัน ${Math.max(0, Number(stockPopupProduct.stock_on_hand_units ?? 0))}` : `Current stock: ${Math.max(0, Number(stockPopupProduct.stock_on_hand_units ?? 0))}`}
              </p>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setStockPopupMode("add");
                  setStockPopupQty((prev) => (prev.trim() ? prev : "1"));
                  setStockPopupError("");
                }}
                className={`inline-flex min-h-10 items-center justify-center rounded-lg border text-sm font-bold transition ${
                  stockPopupMode === "add"
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                }`}
              >
                <span className="inline-flex flex-col items-center leading-none">
                  <span className="text-base font-extrabold">+</span>
                  <span>{th ? "เพิ่มสต๊อก" : "Add Stock"}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStockPopupMode("subtract");
                  setStockPopupQty((prev) => (prev.trim() ? prev : "1"));
                  setStockPopupError("");
                }}
                className={`inline-flex min-h-10 items-center justify-center rounded-lg border text-sm font-bold transition ${
                  stockPopupMode === "subtract"
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                }`}
              >
                <span className="inline-flex flex-col items-center leading-none">
                  <span className="text-base font-extrabold">-</span>
                  <span>{th ? "ตัดสต๊อก" : "Subtract Stock"}</span>
                </span>
              </button>
            </div>

            {stockPopupMode ? (
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                <span>{th ? "จำนวน" : "Quantity"}</span>
                <input
                  value={stockPopupQty}
                  onChange={(event) => setStockPopupQty(event.target.value)}
                  type="number"
                  min={1}
                  step="1"
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                />
              </label>
            ) : (
              <p className="text-xs font-semibold text-slate-500">
                {th ? "เลือกโหมดก่อน แล้วช่องใส่จำนวนจะปรากฏ" : "Select a mode first, then quantity input will appear."}
              </p>
            )}

            {stockPopupError ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{stockPopupError}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeStockPopup}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ยกเลิก" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void submitStockPopup()}
                disabled={busyProductId === stockPopupProduct.id}
                className="inline-flex min-h-10 items-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyProductId === stockPopupProduct.id ? (th ? "กำลังบันทึก..." : "Saving...") : th ? "บันทึก" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkDeletePopupMode ? (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-900/55 p-4" onClick={closeBulkDeletePopup}>
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${
                  bulkDeletePopupMode === "ingredients" ? "border-red-200 bg-red-50 text-red-600" : "border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </div>
              <div>
                <h4 className="text-base font-extrabold text-slate-900">
                  {bulkDeletePopupMode === "ingredients"
                    ? th
                      ? bulkDeleteScope === "selected"
                        ? "ยืนยันลบวัตถุดิบที่เลือก"
                        : "ยืนยันลบวัตถุดิบทั้งหมด"
                      : bulkDeleteScope === "selected"
                        ? "Confirm Delete Selected Ingredients"
                        : "Confirm Delete All Ingredients"
                    : th
                      ? bulkDeleteScope === "selected"
                        ? "ยืนยันปิดการขายสินค้าที่เลือก"
                        : "ยืนยันปิดการขายสินค้าทั้งหมด"
                      : bulkDeleteScope === "selected"
                        ? "Confirm Deactivate Selected Products"
                        : "Confirm Deactivate All Products"}
                </h4>
                <p className="mt-1 text-sm text-slate-600">
                  {bulkDeletePopupMode === "ingredients"
                    ? th
                      ? bulkDeleteScope === "selected"
                        ? `ต้องการลบวัตถุดิบที่เลือก ${selectedFilteredIngredientIds.length} รายการ ใช่หรือไม่`
                        : `ต้องการลบวัตถุดิบตามตัวกรองทั้งหมด ${filteredIngredients.length} รายการ ใช่หรือไม่`
                      : bulkDeleteScope === "selected"
                        ? `Delete ${selectedFilteredIngredientIds.length} selected ingredients?`
                        : `Delete all ${filteredIngredients.length} filtered ingredients?`
                    : th
                      ? bulkDeleteScope === "selected"
                        ? `ต้องการปิดการขายสินค้าที่เลือก ${selectedFilteredProductIds.length} รายการ ใช่หรือไม่`
                        : `ต้องการปิดการขายสินค้าตามตัวกรองทั้งหมด ${filteredProducts.length} รายการ ใช่หรือไม่`
                      : bulkDeleteScope === "selected"
                        ? `Deactivate ${selectedFilteredProductIds.length} selected products?`
                        : `Deactivate all ${filteredProducts.length} filtered products?`}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {bulkDeletePopupMode === "ingredients"
                    ? th
                      ? "รายการที่ยังมีประวัติสต๊อกจะถูก archive อัตโนมัติ"
                      : "Rows with stock history will be archived automatically."
                    : th
                      ? "สินค้าจะถูกปิดการขาย แต่ประวัติเดิมยังคงอยู่"
                      : "Products will be hidden from sales while keeping history."}
                </p>
              </div>
            </div>

            {bulkDeleteError ? (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{bulkDeleteError}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeBulkDeletePopup}
                disabled={bulkDeleteBusy}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {th ? "ยกเลิก" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void submitBulkDelete()}
                disabled={bulkDeleteBusy}
                className={`inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                  bulkDeletePopupMode === "ingredients"
                    ? "border border-red-600 bg-red-600 hover:bg-red-700"
                    : "border border-amber-500 bg-amber-500 hover:bg-amber-600"
                }`}
              >
                {bulkDeleteBusy
                  ? th
                    ? "กำลังดำเนินการ..."
                    : "Processing..."
                  : bulkDeletePopupMode === "ingredients"
                    ? th
                      ? bulkDeleteScope === "selected"
                        ? "ลบที่เลือก"
                        : "ลบทั้งหมด"
                      : bulkDeleteScope === "selected"
                        ? "Delete Selected"
                        : "Delete All"
                    : th
                      ? bulkDeleteScope === "selected"
                        ? "ปิดการขายที่เลือก"
                        : "ปิดการขายทั้งหมด"
                      : bulkDeleteScope === "selected"
                        ? "Deactivate Selected"
                        : "Deactivate All"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {bulkUnlinkScope ? (
        <div className="fixed inset-0 z-[155] grid place-items-center bg-slate-900/55 p-4" onClick={closeBulkUnlinkPopup}>
          <div className="w-full max-w-lg rounded-2xl border border-sky-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h4 className="text-base font-extrabold text-slate-900">{th ? "ยืนยันยกเลิกผูกวัตถุดิบ" : "Confirm Recipe Unlink"}</h4>
            <p className="mt-2 text-sm text-slate-600">
              {th
                ? bulkUnlinkScope === "selected"
                  ? `ระบบจะยกเลิกสูตรวัตถุดิบของสินค้าที่เลือก ${selectedFilteredProductIds.length} รายการ แล้วเปลี่ยนกลับเป็นสต๊อกแบบชิ้น`
                  : `ระบบจะยกเลิกสูตรวัตถุดิบของสินค้าตามตัวกรองทั้งหมด ${filteredProducts.length} รายการ แล้วเปลี่ยนกลับเป็นสต๊อกแบบชิ้น`
                : bulkUnlinkScope === "selected"
                  ? `Unlink ingredient recipes for ${selectedFilteredProductIds.length} selected products and switch them back to unit stock.`
                  : `Unlink ingredient recipes for all ${filteredProducts.length} filtered products and switch them back to unit stock.`}
            </p>
            <p className="mt-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800">
              {th ? "ระบบจะไม่ลบประวัติการขาย ใบเสร็จ หรือรายการปิดกะเดิม" : "Sales history, receipts, and shift reports will not be deleted."}
            </p>
            {bulkUnlinkError ? <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{bulkUnlinkError}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeBulkUnlinkPopup} disabled={bulkUnlinkBusy} className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                {th ? "ยกเลิก" : "Cancel"}
              </button>
              <button type="button" onClick={() => void submitBulkUnlinkRecipes()} disabled={bulkUnlinkBusy} className="inline-flex min-h-10 items-center rounded-lg border border-sky-600 bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-60">
                {bulkUnlinkBusy ? (th ? "กำลังบันทึก..." : "Saving...") : th ? "บันทึกการเปลี่ยนแปลง" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deactivatingProduct ? (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-900/55 p-4" onClick={closeDeactivateProductPopup}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v5" />
                  <path d="M12 16h.01" />
                </svg>
              </div>
              <div>
                <h4 className="text-base font-extrabold text-slate-900">{th ? "ยืนยันปิดการขายสินค้า" : "Confirm Product Deactivation"}</h4>
                <p className="mt-1 text-sm text-slate-600">
                  {th ? `คุณต้องการปิดการขาย "${deactivatingProduct.name}" ใช่หรือไม่` : `Do you want to deactivate "${deactivatingProduct.name}"?`}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {th ? "สินค้าจะไม่แสดงในรายการขาย แต่ประวัติเดิมยังคงอยู่" : "This hides the product from sales while keeping historical records."}
                </p>
              </div>
            </div>

            {deactivatingProductError ? (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{deactivatingProductError}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDeactivateProductPopup}
                disabled={busyProductId === deactivatingProduct.id}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {th ? "ยกเลิก" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void submitDeactivateProduct()}
                disabled={busyProductId === deactivatingProduct.id}
                className="inline-flex min-h-10 items-center rounded-lg border border-amber-500 bg-amber-500 px-4 text-sm font-bold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyProductId === deactivatingProduct.id ? (th ? "กำลังบันทึก..." : "Saving...") : th ? "ปิดการขาย" : "Deactivate"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingIngredient ? (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-900/55 p-4" onClick={closeEditIngredientPopup}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3">
              <h4 className="text-base font-extrabold text-slate-900">
                {th ? `แก้ไขวัตถุดิบ: ${editingIngredient.name}` : `Edit Ingredient: ${editingIngredient.name}`}
              </h4>
            </div>

            <div className="grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                <span>{th ? "ชื่อวัตถุดิบ" : "Ingredient Name"}</span>
                <input
                  value={editingIngredientName}
                  onChange={(event) => setEditingIngredientName(event.target.value)}
                  type="text"
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                <span>{th ? "จำนวนคงเหลือ" : "Quantity on Hand"}</span>
                <input
                  value={editingIngredientQty}
                  onChange={(event) => setEditingIngredientQty(event.target.value)}
                  type="number"
                  min={0}
                  step="0.01"
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                <span>{th ? "หน่วย" : "Unit"}</span>
                <select
                  value={editingIngredientUnit}
                  onChange={(event) => setEditingIngredientUnit(event.target.value)}
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                >
                  {INGREDIENT_BASE_UNIT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {th ? option.thLabel : option.enLabel}
                    </option>
                  ))}
                  {!INGREDIENT_BASE_UNIT_OPTIONS.some((option) => option.value === editingIngredientUnit) && editingIngredientUnit ? (
                    <option value={editingIngredientUnit}>
                      {th ? `ค่าเดิม: ${editingIngredientUnit}` : `Current: ${editingIngredientUnit}`}
                    </option>
                  ) : null}
                </select>
              </label>
            </div>

            {editingIngredientError ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{editingIngredientError}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEditIngredientPopup}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ยกเลิก" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void submitEditIngredient()}
                disabled={busyIngredientId === editingIngredient.id}
                className="inline-flex min-h-10 items-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyIngredientId === editingIngredient.id ? (th ? "กำลังบันทึก..." : "Saving...") : th ? "บันทึก" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deletingIngredient ? (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-900/55 p-4" onClick={closeDeleteIngredientPopup}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-600">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </div>
              <div>
                <h4 className="text-base font-extrabold text-slate-900">{th ? "ยืนยันการลบวัตถุดิบ" : "Confirm Ingredient Delete"}</h4>
                <p className="mt-1 text-sm text-slate-600">
                  {th ? `คุณต้องการลบ "${deletingIngredient.name}" ใช่หรือไม่` : `Do you want to delete "${deletingIngredient.name}"?`}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {th ? "หากวัตถุดิบนี้ถูกใช้งานในข้อมูลอื่น ระบบอาจไม่อนุญาตให้ลบ" : "Delete may be blocked if this ingredient is still referenced."}
                </p>
              </div>
            </div>

            {deletingIngredientError ? (
              <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{deletingIngredientError}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDeleteIngredientPopup}
                disabled={busyIngredientId === deletingIngredient.id}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {th ? "ยกเลิก" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void submitDeleteIngredient()}
                disabled={busyIngredientId === deletingIngredient.id}
                className="inline-flex min-h-10 items-center rounded-lg border border-red-600 bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyIngredientId === deletingIngredient.id ? (th ? "กำลังลบ..." : "Deleting...") : th ? "ลบวัตถุดิบ" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {ingredientStockPopup ? (
        <div className="fixed inset-0 z-[150] grid place-items-center bg-slate-900/55 p-4" onClick={closeIngredientStockPopup}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3">
              <h4 className="text-base font-extrabold text-slate-900">
                {th ? `ปรับสต๊อก: ${ingredientStockPopup.name}` : `Adjust Stock: ${ingredientStockPopup.name}`}
              </h4>
              <p className="mt-1 text-xs text-slate-500">
                {th ? `คงเหลือปัจจุบัน ${formatIngredientQty(ingredientStockPopup)} ${ingredientStockPopup.baseUnit}` : `Current stock: ${formatIngredientQty(ingredientStockPopup)} ${ingredientStockPopup.baseUnit}`}
              </p>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIngredientStockPopupMode("add");
                  setIngredientStockPopupQty((prev) => (prev.trim() ? prev : "1"));
                  setIngredientStockPopupError("");
                }}
                className={`inline-flex min-h-10 items-center justify-center rounded-lg border text-sm font-bold transition ${
                  ingredientStockPopupMode === "add"
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                }`}
              >
                <span className="inline-flex flex-col items-center leading-none">
                  <span className="text-base font-extrabold">+</span>
                  <span>{th ? "เพิ่มสต๊อก" : "Add Stock"}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIngredientStockPopupMode("subtract");
                  setIngredientStockPopupQty((prev) => (prev.trim() ? prev : "1"));
                  setIngredientStockPopupError("");
                }}
                className={`inline-flex min-h-10 items-center justify-center rounded-lg border text-sm font-bold transition ${
                  ingredientStockPopupMode === "subtract"
                    ? "border-red-600 bg-red-600 text-white"
                    : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                }`}
              >
                <span className="inline-flex flex-col items-center leading-none">
                  <span className="text-base font-extrabold">-</span>
                  <span>{th ? "ตัดสต๊อก" : "Subtract Stock"}</span>
                </span>
              </button>
            </div>

            {ingredientStockPopupMode ? (
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                <span>{th ? "จำนวน" : "Quantity"}</span>
                <input
                  value={ingredientStockPopupQty}
                  onChange={(event) => setIngredientStockPopupQty(event.target.value)}
                  type="number"
                  min={1}
                  step="1"
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                />
              </label>
            ) : (
              <p className="text-xs font-semibold text-slate-500">
                {th ? "เลือกโหมดก่อน แล้วช่องใส่จำนวนจะปรากฏ" : "Select a mode first, then quantity input will appear."}
              </p>
            )}

            {ingredientStockPopupError ? (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{ingredientStockPopupError}</p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeIngredientStockPopup}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ยกเลิก" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void submitIngredientStockPopup()}
                disabled={busyIngredientId === ingredientStockPopup.id}
                className="inline-flex min-h-10 items-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyIngredientId === ingredientStockPopup.id ? (th ? "กำลังบันทึก..." : "Saving...") : th ? "บันทึก" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
