"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  th: boolean;
  initialAllowNegativeStock: boolean;
  storageReady: boolean;
  initialStorageMessage?: string;
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type InventorySettingsData = {
  allow_negative_stock: boolean;
  storage_ready: boolean;
  storage_issue?: "missing_table" | "unavailable" | "fallback_cookie";
  storage_message?: string;
};

export function StockSettingsPopupButton({ th, initialAllowNegativeStock, storageReady, initialStorageMessage = "" }: Props) {
  const router = useRouter();
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [checkingStorage, setCheckingStorage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allowNegativeStock, setAllowNegativeStock] = useState(initialAllowNegativeStock);
  const [storageReadyState, setStorageReadyState] = useState(storageReady);
  const [storageMessage, setStorageMessage] = useState(initialStorageMessage);
  const [errorText, setErrorText] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState("");

  async function refreshStorageState() {
    setCheckingStorage(true);
    try {
      const response = await fetch("/api/backoffice/stock/settings", {
        method: "GET",
        cache: "no-store"
      });
      const body = (await response.json()) as ApiEnvelope<InventorySettingsData>;
      if (!response.ok || body.error || !body.data) {
        throw new Error(body.error?.message ?? "Failed to read current stock settings.");
      }

      setAllowNegativeStock(Boolean(body.data.allow_negative_stock ?? false));
      setStorageReadyState(Boolean(body.data.storage_ready));
      setStorageMessage(String(body.data.storage_message ?? ""));
    } catch (error) {
      setStorageReadyState(false);
      setStorageMessage(error instanceof Error ? error.message : "Failed to load inventory settings.");
    } finally {
      setCheckingStorage(false);
    }
  }

  function openPopup() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setAllowNegativeStock(initialAllowNegativeStock);
    setStorageReadyState(storageReady);
    setStorageMessage(initialStorageMessage);
    setErrorText("");
    setNoticeOpen(false);
    setNoticeMessage("");
    setOpen(true);
    window.requestAnimationFrame(() => setVisible(true));
    void refreshStorageState();
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

  async function saveSettings() {
    if (!storageReadyState) {
      setErrorText(
        storageMessage ||
          (th
            ? "ยังไม่พร้อมบันทึกการตั้งค่านี้ กรุณาตรวจสอบ migration/การเชื่อมต่อฐานข้อมูลก่อน"
            : "Storage is not ready yet. Please check migration/database connectivity first.")
      );
      return;
    }

    setErrorText("");
    setSaving(true);

    try {
      const response = await fetch("/api/backoffice/stock/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allow_negative_stock: allowNegativeStock
        })
      });

      const body = (await response.json()) as ApiEnvelope<InventorySettingsData>;
      if (!response.ok || body.error) {
        throw new Error(body.error?.message ?? "Request failed.");
      }

      showNotice(th ? "บันทึกการตั้งค่าสต๊อกเรียบร้อยแล้ว" : "Inventory settings saved.");
      setStorageReadyState(Boolean(body.data?.storage_ready ?? true));
      setStorageMessage(String(body.data?.storage_message ?? ""));
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
        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
      >
        {th ? "ตั้งค่าสต๊อก" : "Stock Settings"}
      </button>

      {open ? (
        <div
          className={`fixed inset-0 z-[143] grid place-items-center p-4 transition-all duration-200 ${
            visible ? "bg-slate-900/55 opacity-100" : "bg-slate-900/0 opacity-0"
          }`}
          onClick={closePopup}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl transition-all duration-200 ${
              visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">{th ? "ตั้งค่าสต๊อก" : "Stock Settings"}</h3>
                <p className="text-xs text-slate-500">
                  {th
                    ? "กำหนดว่าระบบหน้าขายสามารถตัดสต๊อกติดลบได้หรือไม่ เมื่อวัตถุดิบไม่พอ"
                    : "Control whether POS can continue deduction when stock is insufficient."}
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

            {!storageReadyState ? (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                {storageMessage ||
                  (th
                    ? "ยังไม่พบตารางตั้งค่าสต๊อกในฐานข้อมูล กรุณารัน migration 202605220005"
                    : "Settings table not found. Please run migration 202605220005.")}
              </p>
            ) : null}

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <input
                type="checkbox"
                checked={allowNegativeStock}
                onChange={(event) => setAllowNegativeStock(event.target.checked)}
                disabled={checkingStorage || saving || !storageReadyState}
                className="mt-1 h-4 w-4 rounded border-slate-300"
              />
              <span className="text-sm text-slate-800">
                <strong>{th ? "อนุญาตให้สต๊อกติดลบ" : "Allow negative stock deduction"}</strong>
                <br />
                <span className="text-xs text-slate-500">
                  {th
                    ? "ปิดไว้ = ระบบจะไม่ให้ขายเมื่อวัตถุดิบไม่พอ, เปิดไว้ = ระบบจะให้ขายต่อและจำนวนคงเหลืออาจติดลบ"
                    : "Off = block sale if ingredient is insufficient. On = sale can continue and stock may go negative."}
                </span>
              </span>
            </label>

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
                onClick={() => void saveSettings()}
                disabled={saving || checkingStorage || !storageReadyState}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-700 bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving
                  ? th
                    ? "กำลังบันทึก..."
                    : "Saving..."
                  : checkingStorage
                    ? th
                      ? "กำลังตรวจสอบ..."
                      : "Checking..."
                    : th
                      ? "บันทึกการตั้งค่า"
                      : "Save Settings"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
