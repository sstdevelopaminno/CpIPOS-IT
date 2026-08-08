"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type IngredientItem = {
  id: string;
  name: string;
  baseUnit: string;
  quantityOnHand: number;
};

type Props = {
  th: boolean;
  ingredients: IngredientItem[];
  branchId: string;
  disabled?: boolean;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type PurchaseUnit = "gram" | "kg" | "khid" | "bag" | "piece";

function isPieceBaseUnit(baseUnit: string) {
  const normalized = baseUnit.trim().toLowerCase();
  return normalized === "piece" || normalized === "unit" || normalized === "ลูก";
}

export function IngredientRestockPopupButton({ th, ingredients, branchId, disabled = false }: Props) {
  const router = useRouter();
  const closeTimerRef = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState("");

  const sortedIngredients = useMemo(
    () =>
      [...ingredients].sort((a, b) =>
        a.name.localeCompare(b.name, th ? "th" : "en", {
          sensitivity: "base"
        })
      ),
    [ingredients, th]
  );

  const [ingredientName, setIngredientName] = useState(sortedIngredients[0]?.name ?? "");
  const [purchaseQuantity, setPurchaseQuantity] = useState("1");
  const [purchaseUnit, setPurchaseUnit] = useState<PurchaseUnit>("gram");
  const [weightPerBagInGrams, setWeightPerBagInGrams] = useState("1000");
  const [receivedTotalCost, setReceivedTotalCost] = useState("");
  const [reason, setReason] = useState("");

  const selectedIngredient = useMemo(() => {
    const normalizedName = ingredientName.trim().toLowerCase();
    if (!normalizedName) return null;
    return sortedIngredients.find((item) => item.name.trim().toLowerCase() === normalizedName) ?? null;
  }, [ingredientName, sortedIngredients]);
  const selectedIngredientId = selectedIngredient?.id ?? "";
  const selectedIsPiece = isPieceBaseUnit(selectedIngredient?.baseUnit ?? "");

  function openPopup() {
    if (disabled) return;
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!ingredientName && sortedIngredients[0]?.name) {
      setIngredientName(sortedIngredients[0].name);
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

  function resetFormForNext() {
    setPurchaseQuantity("1");
    setPurchaseUnit(selectedIsPiece ? "piece" : "gram");
    setWeightPerBagInGrams("1000");
    setReceivedTotalCost("");
    setReason("");
  }

  async function submit() {
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
          branch_id: branchId,
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
      resetFormForNext();
      router.refresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Unknown error.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPopup}
        disabled={disabled}
        className="inline-flex min-h-10 items-center rounded-xl border border-sky-200 bg-white px-4 text-sm font-bold text-sky-700 transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {th ? "เพิ่มวัตถุดิบ" : "Add Ingredient"}
      </button>

      {open ? (
        <div
          className={`fixed inset-0 z-[141] grid place-items-center p-4 transition-all duration-200 ${
            visible ? "bg-slate-900/55 opacity-100" : "bg-slate-900/0 opacity-0"
          }`}
          onClick={closePopup}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl transition-all duration-200 ${
              visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">{th ? "เพิ่มวัตถุดิบ" : "Add Ingredient"}</h3>
                <p className="text-xs text-slate-500">
                  {th ? "รองรับหน่วย g, kg, ขีด, ถุง และลูก" : "Supports g, kg, khid, bag, and piece units."}
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

            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-700">
                <span>{th ? "วัตถุดิบ" : "Ingredient"}</span>
                <input
                  value={ingredientName}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    const normalizedNextName = nextName.trim().toLowerCase();
                    const nextIngredient =
                      sortedIngredients.find((item) => item.name.trim().toLowerCase() === normalizedNextName) ?? null;
                    const nextIsPiece = isPieceBaseUnit(nextIngredient?.baseUnit ?? "");
                    setIngredientName(nextName);
                    setPurchaseUnit(nextIsPiece ? "piece" : "gram");
                  }}
                  list="ingredient-restock-suggestions"
                  placeholder={th ? "เช่น กะหล่ำปลี / ถ้วยน้ำจิ้ม" : "e.g. Cabbage / Sauce cup"}
                  className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                />
                <datalist id="ingredient-restock-suggestions">
                  {sortedIngredients.map((item) => (
                    <option key={item.id} value={item.name} />
                  ))}
                </datalist>
                <p className="text-[11px] font-medium text-slate-500">
                  {selectedIngredient
                    ? th
                      ? `พบวัตถุดิบเดิม: ${selectedIngredient.quantityOnHand} ${selectedIngredient.baseUnit}`
                      : `Matched existing ingredient: ${selectedIngredient.quantityOnHand} ${selectedIngredient.baseUnit}`
                    : th
                      ? "ยังไม่พบในรายการเดิม ระบบจะสร้างวัตถุดิบใหม่ให้อัตโนมัติ"
                      : "No exact match found. System will create a new ingredient automatically."}
                </p>
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
              <button
                type="button"
                onClick={closePopup}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ยกเลิก" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={saving || ingredientName.trim().length === 0}
                className="inline-flex min-h-10 items-center rounded-lg border border-sky-600 bg-sky-600 px-4 text-sm font-bold text-white shadow-[0_8px_18px_rgba(2,132,199,0.24)] hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? (th ? "กำลังบันทึก..." : "Saving...") : th ? "บันทึกการรับเข้า" : "Save Restock"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
