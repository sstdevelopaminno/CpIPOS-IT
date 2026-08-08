"use client";

import { useRef, useState } from "react";

type UnitStockItem = {
  productId: string;
  sku: string;
  name: string;
  category: string;
  stockOnHand: number;
};

type Props = {
  th: boolean;
  items: UnitStockItem[];
};

export function UnitStockPopupButton({ th, items }: Props) {
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);

  function openPopup() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
    window.requestAnimationFrame(() => setVisible(true));
  }

  function closePopup() {
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 180);
  }

  return (
    <>
      <button
        type="button"
        onClick={openPopup}
        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
      >
        {th ? `สต๊อกแบบชิ้น (${items.length})` : `Unit Stock (${items.length})`}
      </button>

      {open ? (
        <div
          className={`fixed inset-0 z-[142] grid place-items-center p-4 transition-all duration-200 ${
            visible ? "bg-slate-900/55 opacity-100" : "bg-slate-900/0 opacity-0"
          }`}
          onClick={closePopup}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`w-full max-w-3xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl transition-all duration-200 ${
              visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0"
            }`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">{th ? "สต๊อกสินค้าแบบชิ้น" : "Unit Stock Inventory"}</h3>
                <p className="text-xs text-slate-500">
                  {th ? "รายการนี้แยกจากสูตรวัตถุดิบ ใช้สำหรับสินค้าที่ตัดสต๊อกแบบชิ้น" : "This list is separate from ingredient recipes."}
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

            <div className="max-h-[58vh] overflow-y-auto rounded-xl border border-slate-200">
              {items.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-slate-500">{th ? "ยังไม่มีสินค้าที่ตั้งเป็นสต๊อกแบบชิ้น" : "No unit stock products yet."}</p>
              ) : (
                <table className="w-full min-w-[620px] border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">SKU</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "หมวดหมู่" : "Category"}</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-bold text-slate-600">{th ? "สินค้า" : "Product"}</th>
                      <th className="border-b border-slate-200 px-3 py-2 text-right text-xs font-bold text-slate-600">{th ? "คงเหลือ (ชิ้น)" : "On Hand (unit)"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row) => (
                      <tr key={row.productId}>
                        <td className="border-b border-slate-100 px-3 py-2 text-xs font-bold text-slate-600">{row.sku || "-"}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-sm text-slate-700">{row.category}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-sm font-semibold text-slate-900">{row.name}</td>
                        <td className="border-b border-slate-100 px-3 py-2 text-right text-sm font-bold text-emerald-700">{row.stockOnHand}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
