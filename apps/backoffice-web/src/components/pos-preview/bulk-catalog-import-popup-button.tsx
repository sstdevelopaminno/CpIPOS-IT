"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type CategoryItem = {
  name: string;
  productCount: number;
};

type DeliveryRate = {
  channel: "line_man" | "grab" | "shopee";
  channelLabel: string;
  commissionRatePct: number;
  commissionVatRatePct: number;
};

type ProductDraft = {
  id: string;
  name: string;
  category: string;
  stockQuantity: string;
  storePrice: string;
  deliveryPrice: string;
};

type IngredientDraft = {
  id: string;
  name: string;
  baseUnit: string;
  quantityOnHand: string;
  reorderLevel: string;
};

type ScanPayload = {
  products?: Array<{
    name?: string;
    category?: string;
    price?: number;
    delivery_price?: number;
    stock_quantity?: number;
  }>;
  ingredients?: Array<{
    name?: string;
    base_unit?: string;
    quantity_on_hand?: number;
    reorder_level?: number;
  }>;
};

type Props = {
  th: boolean;
  categories: CategoryItem[];
  deliveryRates: DeliveryRate[];
  branchId: string;
  disabled?: boolean;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

function nextId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function makeEmptyProductDraft(categoryName = ""): ProductDraft {
  return {
    id: nextId("prd"),
    name: "",
    category: categoryName,
    stockQuantity: "0",
    storePrice: "0",
    deliveryPrice: "0"
  };
}

function makeEmptyIngredientDraft(): IngredientDraft {
  return {
    id: nextId("ing"),
    name: "",
    baseUnit: "gram",
    quantityOnHand: "0",
    reorderLevel: "0"
  };
}

function calculateAutoDeliveryPrice(storePrice: number, commissionRatePct: number, commissionVatRatePct: number) {
  const commissionAmount = (storePrice * Math.max(0, commissionRatePct)) / 100;
  const vatAmount = (commissionAmount * Math.max(0, commissionVatRatePct)) / 100;
  return Number((storePrice + commissionAmount + vatAmount).toFixed(2));
}

const SCAN_MAX_LONG_EDGE = 1600;
const SCAN_TARGET_MAX_BYTES = 1_500_000;
const SCAN_JPEG_QUALITY = 0.82;
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
  return "gram";
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

function loadImageFromFile(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to read image."));
    };
    image.src = objectUrl;
  });
}

async function optimizeScanImage(file: File): Promise<{ file: File; optimized: boolean; note: string }> {
  if (!file.type.startsWith("image/")) {
    return { file, optimized: false, note: "" };
  }

  const image = await loadImageFromFile(file);
  const longestEdge = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = longestEdge > SCAN_MAX_LONG_EDGE ? SCAN_MAX_LONG_EDGE / longestEdge : 1;
  const targetWidth = Math.max(1, Math.round(image.naturalWidth * scale));
  const targetHeight = Math.max(1, Math.round(image.naturalHeight * scale));
  const shouldResize = scale < 0.999;
  const shouldCompress = file.size > SCAN_TARGET_MAX_BYTES;

  if (!shouldResize && !shouldCompress) {
    return { file, optimized: false, note: "" };
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { file, optimized: false, note: "" };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

  const blob = await canvasToJpegBlob(canvas, SCAN_JPEG_QUALITY);
  if (!blob || blob.size >= file.size) {
    return { file, optimized: false, note: "" };
  }

  const nameWithoutExt = file.name.replace(/\.[^.]+$/, "");
  const optimizedFile = new File([blob], `${nameWithoutExt}-scan.jpg`, {
    type: "image/jpeg",
    lastModified: Date.now()
  });

  return {
    file: optimizedFile,
    optimized: true,
    note: `Image optimized: ${formatFileSize(file.size)} -> ${formatFileSize(optimizedFile.size)}`
  };
}

function t(th: boolean, thText: string, enText: string) {
  return th ? thText : enText;
}

export function BulkCatalogImportPopupButton({ th, categories, deliveryRates, branchId, disabled = false }: Props) {
  const router = useRouter();
  const closeTimerRef = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<"products" | "ingredients" | "scan">("products");
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState("");
  const [products, setProducts] = useState<ProductDraft[]>([makeEmptyProductDraft(categories[0]?.name ?? "")]);
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([makeEmptyIngredientDraft()]);
  const [productCsvText, setProductCsvText] = useState("");
  const [ingredientCsvText, setIngredientCsvText] = useState("");
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanOptimizationNote, setScanOptimizationNote] = useState("");
  const [scanAutoCategory, setScanAutoCategory] = useState(categories[0]?.name ?? "");
  const rateMap = useMemo(() => new Map(deliveryRates.map((row) => [row.channel, row])), [deliveryRates]);

  function openPopup() {
    if (disabled) return;
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
    window.requestAnimationFrame(() => setVisible(true));
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

  function updateProduct(id: string, key: keyof ProductDraft, value: string) {
    setProducts((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function updateIngredient(id: string, key: keyof IngredientDraft, value: string) {
    setIngredients((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function parseProductCsv() {
    const lines = productCsvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const parsed = lines.map((line) => {
      const [name, category, stock, storePrice, deliveryPrice] = line.split(",").map((part) => part.trim());
      return {
        id: nextId("prd"),
        name: name ?? "",
        category: category || categories[0]?.name || "",
        stockQuantity: stock || "0",
        storePrice: storePrice || "0",
        deliveryPrice: deliveryPrice || storePrice || "0"
      } satisfies ProductDraft;
    });

    setProducts((prev) => [...prev, ...parsed]);
    setProductCsvText("");
  }

  function parseIngredientCsv() {
    const lines = ingredientCsvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const parsed = lines.map((line) => {
      const [name, baseUnit, qty, reorder] = line.split(",").map((part) => part.trim());
      return {
        id: nextId("ing"),
        name: name ?? "",
        baseUnit: normalizeIngredientBaseUnit(baseUnit || "gram"),
        quantityOnHand: qty || "0",
        reorderLevel: reorder || "0"
      } satisfies IngredientDraft;
    });

    setIngredients((prev) => [...prev, ...parsed]);
    setIngredientCsvText("");
  }

  async function submitProducts() {
    setSaving(true);
    setErrorText("");
    try {
      const rows = products.filter((row) => row.name.trim() && row.category.trim());
      if (rows.length === 0) {
        throw new Error(t(th, "ยังไม่มีรายการสินค้าที่พร้อมบันทึก", "No valid product rows to save."));
      }

      let successCount = 0;
      const failures: string[] = [];

      for (const row of rows) {
        const resolvedStock = Number(row.stockQuantity || 0);
        const resolvedStorePrice = Number(row.storePrice || 0);
        const fallbackRate = rateMap.get("line_man");
        const deliveryFallback =
          Number.isFinite(Number(row.deliveryPrice))
            ? Number(row.deliveryPrice)
            : fallbackRate
              ? calculateAutoDeliveryPrice(resolvedStorePrice, fallbackRate.commissionRatePct, fallbackRate.commissionVatRatePct)
              : resolvedStorePrice;

        const response = await fetch("/api/backoffice/catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_product_with_stock_setup",
            branch_id: branchId,
            name: row.name.trim(),
            category: row.category.trim(),
            stock_quantity: Number.isFinite(resolvedStock) ? Math.max(0, resolvedStock) : 0,
            store_price: Number.isFinite(resolvedStorePrice) ? Math.max(0, resolvedStorePrice) : 0,
            delivery_price: Number.isFinite(deliveryFallback) ? Math.max(0, deliveryFallback) : 0,
            use_ingredient_recipe: false,
            ingredient_lines: []
          })
        });

        const body = (await response.json()) as ApiEnvelope<unknown>;
        if (!response.ok || body.error) {
          failures.push(`${row.name}: ${body.error?.message ?? "Failed"}`);
          continue;
        }
        successCount += 1;
      }

      const msg = t(
        th,
        `นำเข้าสินค้าสำเร็จ ${successCount} รายการ${failures.length > 0 ? `, ไม่สำเร็จ ${failures.length}` : ""}`,
        `Imported ${successCount} products${failures.length > 0 ? `, failed ${failures.length}` : ""}.`
      );

      if (successCount > 0) {
        showNotice(msg);
        setProducts([makeEmptyProductDraft(categories[0]?.name ?? "")]);
        setProductCsvText("");
      }
      if (failures.length > 0) {
        setErrorText(failures.slice(0, 5).join("\n"));
      }
      router.refresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t(th, "บันทึกสินค้าไม่สำเร็จ", "Failed to save products."));
    } finally {
      setSaving(false);
    }
  }

  async function submitIngredients() {
    setSaving(true);
    setErrorText("");
    try {
      const rows = ingredients.filter((row) => row.name.trim());
      if (rows.length === 0) {
        throw new Error(t(th, "ยังไม่มีรายการวัตถุดิบที่พร้อมบันทึก", "No valid ingredient rows to save."));
      }

      let successCount = 0;
      const failures: string[] = [];

      for (const row of rows) {
        const response = await fetch("/api/backoffice/catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upsert_ingredient",
            branch_id: branchId,
            name: row.name.trim(),
            base_unit: normalizeIngredientBaseUnit(row.baseUnit || "gram"),
            quantity_on_hand: Math.max(0, Number(row.quantityOnHand || 0)),
            reorder_level: Math.max(0, Number(row.reorderLevel || 0))
          })
        });

        const body = (await response.json()) as ApiEnvelope<unknown>;
        if (!response.ok || body.error) {
          failures.push(`${row.name}: ${body.error?.message ?? "Failed"}`);
          continue;
        }
        successCount += 1;
      }

      const msg = t(
        th,
        `นำเข้าวัตถุดิบสำเร็จ ${successCount} รายการ${failures.length > 0 ? `, ไม่สำเร็จ ${failures.length}` : ""}`,
        `Imported ${successCount} ingredients${failures.length > 0 ? `, failed ${failures.length}` : ""}.`
      );

      if (successCount > 0) {
        showNotice(msg);
        setIngredients([makeEmptyIngredientDraft()]);
        setIngredientCsvText("");
      }
      if (failures.length > 0) {
        setErrorText(failures.slice(0, 5).join("\n"));
      }
      router.refresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t(th, "บันทึกวัตถุดิบไม่สำเร็จ", "Failed to save ingredients."));
    } finally {
      setSaving(false);
    }
  }

  async function scanFromMenuImage() {
    if (!scanFile) {
      setErrorText(t(th, "กรุณาเลือกรูปเมนู", "Please choose menu image."));
      return;
    }

    setScanning(true);
    setErrorText("");
    setScanOptimizationNote("");

    try {
      const preparedImage = await optimizeScanImage(scanFile);
      if (preparedImage.note) {
        setScanOptimizationNote(preparedImage.note);
      }

      const formData = new FormData();
      formData.append("menu_image", preparedImage.file);
      formData.append("language", th ? "th" : "en");

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 65_000);

      const response = await fetch("/api/backoffice/catalog/scan-menu", {
        method: "POST",
        body: formData,
        signal: controller.signal
      }).finally(() => window.clearTimeout(timeout));

      const contentType = response.headers.get("content-type") ?? "";
      const rawText = await response.text();

      let body: ApiEnvelope<ScanPayload> | null = null;
      try {
        body = JSON.parse(rawText) as ApiEnvelope<ScanPayload>;
      } catch {
        body = null;
      }

      if (!body) {
        const htmlResponse = rawText.trim().startsWith("<");
        const hint = htmlResponse
          ? t(th, "API ตอบกลับเป็นหน้า HTML (ไม่ใช่ JSON) กรุณารีสตาร์ท dev server แล้วลองใหม่", "API returned HTML (not JSON). Restart dev server and try again.")
          : t(th, "API ตอบกลับไม่ถูกต้อง", "Invalid API response.");
        throw new Error(`${hint} [status ${response.status}] ${contentType || "unknown content-type"}`);
      }

      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Scan failed.");
      }

      const scannedProducts = (body.data?.products ?? []).map((item) => ({
        id: nextId("prd"),
        name: String(item.name ?? "").trim(),
        category: String(item.category ?? "").trim() || scanAutoCategory || categories[0]?.name || "",
        stockQuantity: String(Math.max(0, Number(item.stock_quantity ?? 0))),
        storePrice: String(Math.max(0, Number(item.price ?? 0))),
        deliveryPrice: String(Math.max(0, Number(item.delivery_price ?? item.price ?? 0)))
      }));

      const scannedIngredients = (body.data?.ingredients ?? []).map((item) => ({
        id: nextId("ing"),
        name: String(item.name ?? "").trim(),
        baseUnit: normalizeIngredientBaseUnit(String(item.base_unit ?? "gram")),
        quantityOnHand: String(Math.max(0, Number(item.quantity_on_hand ?? 0))),
        reorderLevel: String(Math.max(0, Number(item.reorder_level ?? 0)))
      }));

      if (scannedProducts.length > 0) {
        setProducts((prev) => [...prev, ...scannedProducts.filter((row) => row.name.length > 0)]);
      }
      if (scannedIngredients.length > 0) {
        setIngredients((prev) => [...prev, ...scannedIngredients.filter((row) => row.name.length > 0)]);
      }

      showNotice(
        t(
          th,
          `สแกนสำเร็จ: สินค้า ${scannedProducts.length} รายการ, วัตถุดิบ ${scannedIngredients.length} รายการ`,
          `Scan complete: ${scannedProducts.length} products, ${scannedIngredients.length} ingredients.`
        )
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setErrorText(t(th, "สแกนใช้เวลานานเกินไป กรุณาลองรูปที่เล็กลงหรือชัดขึ้น", "Scan timed out. Please try a smaller or clearer image."));
      } else {
        setErrorText(error instanceof Error ? error.message : t(th, "สแกนไม่สำเร็จ", "Scan failed."));
      }
    } finally {
      setScanning(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPopup}
        disabled={disabled}
        className="inline-flex min-h-10 items-center rounded-xl border border-indigo-200 bg-white px-4 text-sm font-bold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {t(th, "นำเข้าหลายรายการ", "Bulk Import")}
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
                <h3 className="text-lg font-extrabold text-slate-900">{t(th, "นำเข้ารายการสินค้าและวัตถุดิบ", "Bulk Product & Ingredient Import")}</h3>
                <p className="text-xs text-slate-500">
                  {t(th, "เพิ่มหลายรายการในครั้งเดียว หรือสแกนภาพเมนูเพื่อดึงข้อมูลอัตโนมัติ", "Add many rows at once, or scan menu image for auto extraction.")}
                </p>
              </div>
              <button
                type="button"
                onClick={closePopup}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {t(th, "ปิด", "Close")}
              </button>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setTab("products")} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${tab === "products" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{t(th, "สินค้า (หลายรายการ)", "Products")}</button>
              <button type="button" onClick={() => setTab("ingredients")} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${tab === "ingredients" ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{t(th, "วัตถุดิบ (หลายรายการ)", "Ingredients")}</button>
              <button type="button" onClick={() => setTab("scan")} className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${tab === "scan" ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>{t(th, "สแกนจากภาพเมนู", "Scan Menu Image")}</button>
            </div>

            {tab === "products" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-semibold text-slate-700">{t(th, "วางข้อมูลสินค้า (บรรทัดละ 1 รายการ): ชื่อสินค้า,หมวดหมู่,สต็อก,ราคาหน้าร้าน,ราคาเดลิเวอรี่", "Paste products CSV lines: name,category,stock,store_price,delivery_price")}</p>
                  <div className="grid gap-2 md:grid-cols-[1fr_132px]">
                    <textarea
                      value={productCsvText}
                      onChange={(event) => setProductCsvText(event.target.value)}
                      rows={3}
                      className="min-h-20 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={parseProductCsv}
                      className="inline-flex min-h-20 items-center justify-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700"
                    >
                      {t(th, "เพิ่มจากข้อความ", "Append Parsed Rows")}
                    </button>
                  </div>
                </div>
                <div className="max-h-[44vh] overflow-y-auto rounded-xl border border-slate-200">
                  <table className="min-w-[900px] w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "สินค้า", "Name")}</th>
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "หมวดหมู่", "Category")}</th>
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "สต็อก", "Stock")}</th>
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "ราคาหน้าร้าน", "Store Price")}</th>
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "ราคาเดลิเวอรี่", "Delivery Price")}</th>
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "ลบ", "Remove")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((row) => (
                        <tr key={row.id}>
                          <td className="border-b border-slate-100 px-2 py-2"><input value={row.name} onChange={(event) => updateProduct(row.id, "name", event.target.value)} className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" /></td>
                          <td className="border-b border-slate-100 px-2 py-2"><input value={row.category} onChange={(event) => updateProduct(row.id, "category", event.target.value)} className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" /></td>
                          <td className="border-b border-slate-100 px-2 py-2"><input value={row.stockQuantity} onChange={(event) => updateProduct(row.id, "stockQuantity", event.target.value)} type="number" min={0} className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" /></td>
                          <td className="border-b border-slate-100 px-2 py-2"><input value={row.storePrice} onChange={(event) => updateProduct(row.id, "storePrice", event.target.value)} type="number" min={0} step="0.01" className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" /></td>
                          <td className="border-b border-slate-100 px-2 py-2"><input value={row.deliveryPrice} onChange={(event) => updateProduct(row.id, "deliveryPrice", event.target.value)} type="number" min={0} step="0.01" className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" /></td>
                          <td className="border-b border-slate-100 px-2 py-2"><button type="button" onClick={() => setProducts((prev) => prev.filter((item) => item.id !== row.id))} className="rounded-lg border border-red-200 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50">{t(th, "ลบ", "Remove")}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <button type="button" onClick={() => setProducts((prev) => [...prev, makeEmptyProductDraft(categories[0]?.name ?? "")])} className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">{t(th, "+ เพิ่มแถวสินค้า", "+ Add Product Row")}</button>
                  <button type="button" onClick={() => void submitProducts()} disabled={saving} className="inline-flex min-h-10 items-center rounded-lg border border-blue-600 bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">{saving ? t(th, "กำลังบันทึก...", "Saving...") : t(th, "บันทึกสินค้าทั้งหมด", "Save All Products")}</button>
                </div>
              </div>
            ) : null}

            {tab === "ingredients" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="mb-1 text-xs font-semibold text-slate-700">{t(th, "วางข้อมูลวัตถุดิบ (บรรทัดละ 1 รายการ): ชื่อวัตถุดิบ,หน่วย,คงเหลือ,จุดสั่งซื้อ", "Paste ingredients CSV lines: name,unit,on_hand,reorder_level")}</p>
                  <div className="grid gap-2 md:grid-cols-[1fr_132px]">
                    <textarea
                      value={ingredientCsvText}
                      onChange={(event) => setIngredientCsvText(event.target.value)}
                      rows={3}
                      className="min-h-20 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={parseIngredientCsv}
                      className="inline-flex min-h-20 items-center justify-center rounded-lg border border-emerald-600 bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
                    >
                      {t(th, "เพิ่มจากข้อความ", "Append Parsed Rows")}
                    </button>
                  </div>
                </div>
                <div className="max-h-[44vh] overflow-y-auto rounded-xl border border-slate-200">
                  <table className="min-w-[820px] w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "วัตถุดิบ", "Name")}</th>
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "หน่วย", "Unit")}</th>
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "คงเหลือ", "On Hand")}</th>
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "จุดสั่งซื้อ", "Reorder Level")}</th>
                        <th className="border-b border-slate-200 px-2 py-2 text-left text-xs font-bold text-slate-600">{t(th, "ลบ", "Remove")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ingredients.map((row) => (
                        <tr key={row.id}>
                          <td className="border-b border-slate-100 px-2 py-2"><input value={row.name} onChange={(event) => updateIngredient(row.id, "name", event.target.value)} className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" /></td>
                          <td className="border-b border-slate-100 px-2 py-2">
                            <select
                              value={normalizeIngredientBaseUnit(row.baseUnit)}
                              onChange={(event) => updateIngredient(row.id, "baseUnit", event.target.value)}
                              className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900"
                            >
                              {INGREDIENT_BASE_UNIT_OPTIONS.map((unit) => (
                                <option key={unit.value} value={unit.value}>
                                  {th ? unit.thLabel : unit.enLabel}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="border-b border-slate-100 px-2 py-2"><input value={row.quantityOnHand} onChange={(event) => updateIngredient(row.id, "quantityOnHand", event.target.value)} type="number" min={0} step="0.01" className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" /></td>
                          <td className="border-b border-slate-100 px-2 py-2"><input value={row.reorderLevel} onChange={(event) => updateIngredient(row.id, "reorderLevel", event.target.value)} type="number" min={0} step="0.01" className="min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900" /></td>
                          <td className="border-b border-slate-100 px-2 py-2"><button type="button" onClick={() => setIngredients((prev) => prev.filter((item) => item.id !== row.id))} className="rounded-lg border border-red-200 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50">{t(th, "ลบ", "Remove")}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <button type="button" onClick={() => setIngredients((prev) => [...prev, makeEmptyIngredientDraft()])} className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">{t(th, "+ เพิ่มแถววัตถุดิบ", "+ Add Ingredient Row")}</button>
                  <button type="button" onClick={() => void submitIngredients()} disabled={saving} className="inline-flex min-h-10 items-center rounded-lg border border-emerald-600 bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60">{saving ? t(th, "กำลังบันทึก...", "Saving...") : t(th, "บันทึกวัตถุดิบทั้งหมด", "Save All Ingredients")}</button>
                </div>
              </div>
            ) : null}

            {tab === "scan" ? (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-800">{t(th, "อัปโหลดภาพเมนูเพื่ออ่านรายการสินค้าและวัตถุดิบอัตโนมัติ", "Upload menu image to auto-extract products and ingredients.")}</p>
                <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <input type="file" accept="image/*" onChange={(event) => setScanFile(event.target.files?.[0] ?? null)} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" />
                  <select value={scanAutoCategory} onChange={(event) => setScanAutoCategory(event.target.value)} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900">
                    <option value="">{t(th, "หมวดหมู่เริ่มต้น", "Default Category")}</option>
                    {categories.map((item) => (
                      <option key={item.name} value={item.name}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={() => void scanFromMenuImage()} disabled={scanning} className="inline-flex min-h-10 items-center rounded-lg border border-indigo-600 bg-indigo-600 px-4 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">
                    {scanning ? t(th, "กำลังสแกน...", "Scanning...") : t(th, "สแกนภาพเมนู", "Scan Menu Image")}
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  {t(th, "หลังสแกนเสร็จ รายการจะถูกเติมเข้าแท็บสินค้า/วัตถุดิบ เพื่อแก้ไขก่อนกดบันทึกได้", "After scan, rows are appended into Products/Ingredients tabs for review before saving.")}
                </p>
                {scanOptimizationNote ? <p className="text-xs font-semibold text-indigo-600">{scanOptimizationNote}</p> : null}
              </div>
            ) : null}

            {errorText ? <p className="mt-3 whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{errorText}</p> : null}
            {noticeOpen ? (
              <div className="fixed inset-0 z-[170] grid place-items-center bg-slate-900/35 p-4" onClick={() => setNoticeOpen(false)}>
                <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <h4 className="text-base font-extrabold text-emerald-700">{t(th, "ดำเนินการสำเร็จ", "Completed Successfully")}</h4>
                  <p className="mt-2 text-sm font-semibold text-slate-700">{noticeMessage}</p>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setNoticeOpen(false)}
                      className="inline-flex min-h-10 items-center rounded-lg border border-emerald-600 bg-emerald-600 px-4 text-sm font-bold text-white hover:bg-emerald-700"
                    >
                      {t(th, "ตกลง", "OK")}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
