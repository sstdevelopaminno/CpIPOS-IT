"use client";

import { useEffect, useRef, useState } from "react";

type DeliveryConfigItem = {
  channelLabel: string;
  rateLabel: string;
  stale: boolean;
};

type Props = {
  th: boolean;
  deliveryConfigs: DeliveryConfigItem[];
};

export function DeliveryQuickPopupButton({ th, deliveryConfigs }: Props) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(() => {
      setVisible(true);
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    []
  );

  function handleOpen() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  }

  function handleClose() {
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, 180);
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex min-h-10 items-center rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-bold text-indigo-700 transition hover:bg-indigo-100"
      >
        {th ? "เดลิเวอรี่" : "Delivery"}
      </button>

      {open ? (
        <div
          className={`fixed inset-0 z-[130] grid place-items-center p-4 transition-opacity duration-200 ${
            visible ? "bg-slate-900/55 opacity-100" : "bg-slate-900/0 opacity-0"
          }`}
          onClick={handleClose}
        >
          <div
            className={`w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl transition-all duration-200 ${
              visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0"
            }`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-extrabold text-slate-900">{th ? "รายละเอียดเดลิเวอรี่" : "Delivery Details"}</h3>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ปิด" : "Close"}
              </button>
            </div>

            <p className="mb-3 text-sm text-slate-600">
              {th
                ? "ข้อมูลนี้ดึงจากการตั้งค่าช่องทางเดลิเวอรี่ของสาขา เพื่อช่วยตรวจสอบเรทคอมมิชชันก่อนขาย"
                : "This data is loaded from branch delivery channel configuration for quick commission checks."}
            </p>

            <div className="grid gap-2">
              {deliveryConfigs.map((config) => (
                <div
                  key={config.channelLabel}
                  className="flex min-h-11 items-center justify-between rounded-xl border border-slate-200 bg-white px-3"
                >
                  <span className="text-sm font-bold text-slate-800">{config.channelLabel}</span>
                  <span className={config.stale ? "text-sm font-bold text-amber-700" : "text-sm font-bold text-emerald-700"}>{config.rateLabel}</span>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-9 items-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-sm font-semibold text-indigo-700"
              >
                {th ? "เมนูนี้พร้อมต่อยอดรายละเอียดเพิ่มเติม" : "This menu can be extended with more details"}
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ปิด" : "Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
